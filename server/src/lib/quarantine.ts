import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { productReturns, products, quarantineItems, stockLevels, suppliers, supplierInvoices } from '../db/schema.js';
import { HttpError } from './http.js';
import { ACC, unitCost, wibDate } from './accounting.js';
import { applyMovement, type Tx } from './stock.js';
import { apNo, payInvoice } from './payables.js';
import { notifyRole } from './finance.js';
import type { AuthUser } from '../middleware/auth.js';

/**
 * Karantina barang rusak. Barang rusak tidak masuk stok jual; nilainya dipindah ke akun Persediaan Karantina
 * sampai diputuskan: diperbaiki & kembali ke stok, diklaim ke pemasok, atau dihapusbukukan.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;
type Q = typeof quarantineItems.$inferSelect;

async function qNo(tx: Tx | typeof db) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('stock_doc_seq')::text as seq`);
  const d = wibDate();
  return `QRN-${d.slice(2, 4)}${d.slice(5, 7)}-${seq.padStart(5, '0')}`;
}

/** Dipanggil saat barang retur diterima dalam kondisi rusak (kecuali perbaikan garansi milik nasabah). */
export async function quarantineFromReturn(tx: Tx, r: typeof productReturns.$inferSelect, actor: AuthUser, note: string | null) {
  const uc = await unitCost(tx, r.productId, new Date(), r.branchId);
  const creditTo = r.sourceType === 'order' && r.resolution === 'refund' ? ACC.COGS : ACC.WARRANTY;
  const [q] = await tx.insert(quarantineItems).values({ qNo: await qNo(tx), branchId: r.branchId, productId: r.productId, qty: r.qty, unitCost: uc, source: 'return', sourceRef: r.returnNo, sourceId: r.id,
    creditTo, conditionNote: note?.trim() || `Retur ${r.sourceNo} rusak`, createdBy: actor.id }).returning();
  await notifyRole(tx, 'branch-manager', r.branchId, `Barang rusak masuk karantina ${q.qNo}`, 'Putuskan: perbaiki & kembalikan ke stok, klaim ke pemasok, atau hapus buku.');
  return q;
}

/** Barang iqalah yang kembali dalam kondisi rusak: nilai barang dijurnal oleh dokumen iqalah. */
export async function quarantineFromIqalah(tx: Tx, p: { branchId: string; productId: string; qty: number; unitCost: number; iqalahNo: string; iqalahId: string; note: string; actor: AuthUser }) {
  const [q] = await tx.insert(quarantineItems).values({ qNo: await qNo(tx), branchId: p.branchId, productId: p.productId, qty: p.qty, unitCost: p.unitCost, source: 'iqalah', sourceRef: p.iqalahNo, sourceId: p.iqalahId,
    creditTo: null, conditionNote: p.note, createdBy: p.actor.id }).returning();
  return q;
}

const canOperate = (u: AuthUser, branchId: string) => (['warehouse', 'branch-admin'].includes(u.roleCode) && u.branch?.id === branchId);
const canDecide = (u: AuthUser, branchId: string) => (u.roleCode === 'branch-manager' && u.branch?.id === branchId) || u.roleCode === 'biz-mgr' || (u.roleCode === 'warehouse' && u.branch?.id === branchId);

/** Pindahkan stok jual yang ternyata rusak (saat opname / penerimaan) ke karantina. */
export async function moveToQuarantine(actor: AuthUser, p: { productId: string; qty: number; note: string; source?: 'opname' | 'receipt' }) {
  if (!actor.branch || !['warehouse', 'branch-admin'].includes(actor.roleCode)) throw new HttpError(403, 'Dilakukan Gudang Pusat / Admin Cabang');
  const branchId = actor.branch.id;
  const [s] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.productId), eq(stockLevels.branchId, branchId))).limit(1);
  if (!s || s.onHand - s.reserved < p.qty) throw new HttpError(409, 'Stok tersedia tidak cukup (barang yang sudah dipesan tidak bisa dikarantina)');
  return db.transaction(async (tx) => {
    const no = await qNo(tx);
    const uc = await unitCost(tx, p.productId, new Date(), branchId);
    await applyMovement(tx, { productId: p.productId, branchId, type: 'adjustment', qty: -p.qty, refType: 'quarantine', refNo: no, note: `Ke karantina: ${p.note}`, actorId: actor.id });
    const [q] = await tx.insert(quarantineItems).values({ qNo: no, branchId, productId: p.productId, qty: p.qty, unitCost: uc, source: p.source ?? 'opname', sourceRef: no, creditTo: ACC.INVENTORY, conditionNote: p.note, createdBy: actor.id }).returning();
    return q;
  });
}

export async function loadQ(id: string, tx: Tx | typeof db = db) {
  const [q] = await tx.select().from(quarantineItems).where(eq(quarantineItems.id, id)).limit(1);
  if (!q) throw new HttpError(404, 'Data karantina tidak ditemukan');
  return q;
}

/** Keputusan atas barang karantina. */
export async function decideQuarantine(actor: AuthUser, id: string, p: { action: 'restock' | 'write_off' | 'claim'; note: string; supplierId?: string | null; claimAmount?: number | null }) {
  const q = await loadQ(id);
  if (q.status !== 'quarantined') throw new HttpError(409, 'Barang ini sudah diputuskan');
  if (!canDecide(actor, q.branchId)) throw new HttpError(403, 'Keputusan oleh Manager Cabang / Gudang Pusat / Business Manager');
  // Hapus buku = mengurangi aset; tidak boleh diputuskan oleh pihak yang mengelola fisik barang
  if (p.action === 'write_off' && actor.roleCode === 'warehouse') throw new HttpError(403, 'Hapus buku barang karantina diputuskan Manager Cabang / Business Manager');
  const value = r2(q.unitCost * q.qty);
  return db.transaction(async (tx) => {
    const patch: Partial<Q> = { decidedBy: actor.id, decidedAt: new Date(), decisionNote: p.note, updatedAt: new Date() };
    if (p.action === 'restock') {
      await applyMovement(tx, { productId: q.productId, branchId: q.branchId, type: 'return_in', qty: q.qty, refType: 'quarantine', refId: q.id, refNo: q.qNo, note: `Kembali dari karantina: ${p.note}`, actorId: actor.id });
      patch.status = 'restocked';
    } else if (p.action === 'write_off') {
      patch.status = 'written_off';
    } else {
      if (!p.supplierId) throw new HttpError(400, 'Pilih pemasok yang diklaim');
      const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1);
      if (!sup) throw new HttpError(404, 'Pemasok tidak ditemukan');
      const claim = r2(p.claimAmount ?? value);
      if (claim <= 0 || claim > value * 1.5) throw new HttpError(400, `Nilai klaim antara 1 dan ${(value * 1.5).toLocaleString('id-ID')}`);
      Object.assign(patch, { status: 'claimed', supplierId: sup.id, claimNo: await apNo(tx, 'CLM'), claimAmount: claim });
    }
    const [after] = await tx.update(quarantineItems).set(patch).where(and(eq(quarantineItems.id, q.id), eq(quarantineItems.status, 'quarantined'))).returning();
    if (!after) throw new HttpError(409, 'Barang ini sudah diputuskan');
    return after;
  });
}

/** Penyelesaian klaim pemasok: transfer dari pemasok, atau nota kredit yang memotong faktur pemasok. */
export async function settleClaim(actor: AuthUser, id: string, p: { method: 'transfer' | 'credit_note'; amount: number; invoiceId?: string | null; ref?: string | null; note?: string | null }) {
  if (actor.roleCode !== 'finance') throw new HttpError(403, 'Penyelesaian klaim oleh Bookkeeping');
  const q = await loadQ(id);
  if (q.status !== 'claimed') throw new HttpError(409, 'Klaim tidak dalam status menunggu penyelesaian');
  const claim = r2(q.claimAmount ?? 0);
  if (p.amount < 0 || p.amount - claim > 0.009) throw new HttpError(400, `Nominal penggantian antara 0 dan ${claim.toLocaleString('id-ID')}`);
  return db.transaction(async (tx) => {
    if (p.method === 'credit_note' && p.amount > 0) {
      if (!p.invoiceId) throw new HttpError(400, 'Pilih faktur pemasok yang dipotong nota kredit');
      const [inv] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, p.invoiceId)).limit(1);
      if (!inv || inv.supplierId !== q.supplierId) throw new HttpError(400, 'Faktur bukan milik pemasok yang diklaim');
      await payInvoice(actor, inv.id, { amount: p.amount, method: 'claim_offset', bankRef: q.claimNo, note: `Nota kredit klaim ${q.claimNo}${p.ref ? ` (${p.ref})` : ''}` }, tx);
    }
    const [after] = await tx.update(quarantineItems).set({ status: 'claim_settled', settledAmount: r2(p.amount), settledMethod: p.method, settledAt: new Date(),
      decisionNote: [q.decisionNote, p.note, p.ref].filter(Boolean).join(' · '), updatedAt: new Date() }).where(and(eq(quarantineItems.id, q.id), eq(quarantineItems.status, 'claimed'))).returning();
    if (!after) throw new HttpError(409, 'Klaim sudah diselesaikan');
    return after;
  });
}

export { canOperate };
export const productName = async (id: string) => (await db.select({ n: products.name }).from(products).where(eq(products.id, id)).limit(1))[0]?.n ?? '';
