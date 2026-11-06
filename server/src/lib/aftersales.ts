import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, creditApplications, creditEvents, customers, notifications, orderItems, orders, productReturns, products, refunds,
  stockLevels, type ProductReturn, type Refund,
} from '../db/schema.js';
import { HttpError } from './http.js';
import { applyMovement, commitReservedOut, releaseStock, reserveStock, type Tx } from './stock.js';
import { cancelShipmentsFor, createShipment, onShipmentDelivered, shipmentStateFor, type DeliveryMode } from './shipping.js';
import { releaseOrder } from './orders.js';
import { cashShiftFor, financeNo, notifyRole, SHIFT_ROLES } from './finance.js';
import { quarantineFromReturn } from './quarantine.js';
import type { AuthUser } from '../middleware/auth.js';
import { money, notifyCustomer, webUrl } from './notify.js';

const fmt = (v: number) => v.toLocaleString('id-ID');
const HQ_ROLES = ['support', 'biz-mgr', 'super-admin'];
export const REQUEST_ROLES = ['branch-admin', 'cashier', 'branch-manager', 'support', 'ao'];

function assertBranch(u: AuthUser, branchId: string) {
  if (HQ_ROLES.includes(u.roleCode)) return;
  if (u.branch?.id !== branchId) throw new HttpError(403, 'Transaksi ini bukan milik cabang Anda');
}

// ---------------------------------------------------------------------------
// Pencarian dokumen sumber (order / akad)
// ---------------------------------------------------------------------------
export async function lookupSource(actor: AuthUser, noRaw: string) {
  const no = noRaw.trim().toUpperCase();
  if (no.startsWith('ORD-')) {
    const [o] = await db.select().from(orders).where(eq(orders.orderNo, no)).limit(1);
    if (!o) throw new HttpError(404, 'Order tidak ditemukan');
    assertBranch(actor, o.branchId);
    const raw = await db.select({ productId: orderItems.productId, name: orderItems.name, qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).where(eq(orderItems.orderId, o.id));
    // Harga efektif per unit = harga katalog setelah potongan promo + pajak (yang benar-benar dibayar nasabah, tanpa ongkir)
    const factor = o.subtotal > 0 ? (o.subtotal - (o.discount ?? 0) + (o.tax ?? 0)) / o.subtotal : 1;
    const items = raw.map((i) => ({ ...i, unitPrice: Math.round(i.unitPrice * factor * 100) / 100 }));
    const ship = await shipmentStateFor('order', o.id);
    return {
      sourceType: 'order' as const, id: o.id, no: o.orderNo, status: o.status, branchId: o.branchId, currency: o.currency, customerName: o.recipientName, customerPhone: o.recipientPhone,
      paidAmount: ['fulfilling', 'completed'].includes(o.status) ? o.total : 0, items, dispatched: ship.dispatched,
      canRefund: o.status === 'fulfilling' && !ship.dispatched, canReturn: o.status === 'completed',
    };
  }
  const [row] = await db.select({ a: creditApplications, name: customers.fullName, phone: customers.phone, product: products.name }).from(creditApplications)
    .innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
    .where(sql`${creditApplications.contractNo} = ${no} or ${creditApplications.appNo} = ${no}`).limit(1);
  if (!row) throw new HttpError(404, 'Order / akad tidak ditemukan. Gunakan nomor ORD-…, AKD-… atau APP-…');
  const a = row.a;
  assertBranch(actor, a.branchId);
  const ship = await shipmentStateFor('credit', a.id);
  return {
    sourceType: 'credit' as const, id: a.id, no: a.contractNo ?? a.appNo, status: a.status, branchId: a.branchId, currency: a.currency, customerName: row.name, customerPhone: row.phone,
    paidAmount: a.dpPaidAmount ?? 0, items: [{ productId: a.productId, name: row.product, qty: a.qty, unitPrice: Math.round((a.cashPrice / a.qty) * 100) / 100 }], dispatched: ship.dispatched,
    canRefund: a.status === 'contracted' && !ship.dispatched, canReturn: a.status === 'active' || a.status === 'paid_off',
  };
}

// ===========================================================================
// REFUND
// ===========================================================================
async function loadRefund(id: string) {
  const [r] = await db.select().from(refunds).where(eq(refunds.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'Refund tidak ditemukan');
  return r;
}

export interface RefundInput {
  sourceNo: string; amount: number; reason: string; method: 'cash' | 'transfer';
  bankName?: string | null; accountNo?: string | null; accountName?: string | null;
}

function assertPayout(p: Pick<RefundInput, 'method' | 'bankName' | 'accountNo' | 'accountName'>) {
  if (p.method === 'transfer' && !(p.bankName?.trim() && p.accountNo?.trim() && p.accountName?.trim())) throw new HttpError(400, 'Isi bank, nomor rekening, dan nama pemilik rekening');
}

/** Pembatalan order lunas / akad sebelum barang dikirim, disertai pengembalian dana. */
export async function requestRefund(actor: AuthUser, p: RefundInput) {
  if (!REQUEST_ROLES.includes(actor.roleCode)) throw new HttpError(403, 'Tidak berwenang mengajukan refund');
  const src = await lookupSource(actor, p.sourceNo);
  if (!src.canRefund) throw new HttpError(409, src.dispatched ? 'Barang sudah dikirim / diterima — gunakan proses retur' : src.sourceType === 'order' ? 'Hanya order yang sudah dibayar dan belum dikirim yang dapat dibatalkan dengan refund' : 'Pembatalan akad dengan refund hanya untuk akad yang barangnya belum diterima');
  if (p.amount <= 0 || p.amount - src.paidAmount > 0.009) throw new HttpError(400, `Nominal refund maksimal ${fmt(src.paidAmount)}`);
  assertPayout(p);
  const [dup] = await db.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.sourceId, src.id), inArray(refunds.status, ['requested', 'approved']))).limit(1);
  if (dup) throw new HttpError(409, 'Sudah ada refund berjalan untuk transaksi ini');
  return db.transaction(async (tx) => {
    const refundNo = await financeNo(tx, 'RFD');
    const [r] = await tx.insert(refunds).values({
      refundNo, sourceType: src.sourceType, sourceId: src.id, sourceNo: src.no, branchId: src.branchId, customerName: src.customerName, customerPhone: src.customerPhone,
      amount: p.amount, reason: p.reason, method: p.method, bankName: p.bankName ?? null, accountNo: p.accountNo ?? null, accountName: p.accountName ?? null, requestedBy: actor.id,
    }).returning();
    if (src.sourceType === 'order') await notifyRole(tx, 'branch-manager', src.branchId, `Permintaan refund ${refundNo}`, `${src.no} · ${src.customerName} · ${fmt(p.amount)}`);
    else await notifyRole(tx, 'biz-mgr', null, `Pembatalan akad + refund ${refundNo}`, `${src.no} · ${src.customerName} · ${fmt(p.amount)}`);
    return r;
  });
}

export async function decideRefund(actor: AuthUser, id: string, decision: 'approve' | 'reject', note: string | null) {
  const r = await loadRefund(id);
  if (r.status !== 'requested') throw new HttpError(409, 'Refund sudah diproses');
  if (r.requestedBy === actor.id) throw new HttpError(403, 'Refund tidak boleh disetujui oleh pengajunya sendiri (pemisahan tugas)');
  const okMc = actor.roleCode === 'branch-manager' && actor.branch?.id === r.branchId && r.sourceType === 'order';
  if (!(okMc || actor.roleCode === 'biz-mgr')) throw new HttpError(403, r.sourceType === 'credit' ? 'Pembatalan akad disetujui Business Manager' : 'Refund disetujui Manager Cabang');
  if (decision === 'reject' && !note?.trim()) throw new HttpError(400, 'Isi alasan penolakan');
  return db.transaction(async (tx) => {
    if (decision === 'approve') {
      const why = `Dibatalkan dengan refund ${r.refundNo}: ${r.reason}`;
      if (r.sourceType === 'order') {
        const [o] = await tx.select().from(orders).where(eq(orders.id, r.sourceId)).limit(1);
        if (!o || o.status !== 'fulfilling') throw new HttpError(409, 'Status order sudah berubah');
        await cancelShipmentsFor(tx, 'order', o.id, why, actor);
        await releaseOrder(tx, o);
        await tx.update(orders).set({ status: 'cancelled', cancelReason: why, updatedAt: new Date() }).where(eq(orders.id, o.id));
      } else if (r.sourceType === 'credit') {
        const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, r.sourceId)).limit(1);
        if (!a || a.status !== 'contracted') throw new HttpError(409, 'Status akad sudah berubah');
        await cancelShipmentsFor(tx, 'credit', a.id, why, actor);
        if (a.fulfillBranchId) await releaseStock(tx, a.productId, a.fulfillBranchId, a.qty, { refType: 'credit', refId: a.id, refNo: a.contractNo ?? a.appNo }, actor.id);
        await tx.update(creditApplications).set({ status: 'cancelled', closedReason: why, updatedAt: new Date() }).where(eq(creditApplications.id, a.id));
        await tx.insert(creditEvents).values({ applicationId: a.id, type: 'cancelled', actorId: actor.id, actorName: actor.fullName, actorRole: actor.roleCode, message: why, fromStatus: 'contracted', toStatus: 'cancelled' });
      }
      await notifyRole(tx, 'cashier', r.branchId, `Refund ${r.refundNo} siap dibayarkan`, `${r.customerName} · ${fmt(r.amount)} (${r.method === 'cash' ? 'tunai' : 'transfer'})`);
    }
    const [after] = await tx.update(refunds).set({ status: decision === 'approve' ? 'approved' : 'rejected', approvedBy: actor.id, approvedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(and(eq(refunds.id, r.id), eq(refunds.status, 'requested'))).returning();
    if (!after) throw new HttpError(409, 'Refund sudah diproses');
    await tx.insert(notifications).values({ userId: r.requestedBy, title: `Refund ${r.refundNo} ${decision === 'approve' ? 'disetujui' : 'ditolak'}`, body: note ?? r.reason });
    return after;
  });
}

export async function payRefund(actor: AuthUser, id: string, paidRef: string | null) {
  const r = await loadRefund(id);
  if (!SHIFT_ROLES.includes(actor.roleCode) || actor.branch?.id !== r.branchId) throw new HttpError(403, 'Refund dibayarkan Kasir / Admin Cabang');
  if (r.status !== 'approved') throw new HttpError(409, 'Refund belum disetujui atau sudah dibayar');
  if (r.method === 'transfer' && !paidRef?.trim()) throw new HttpError(400, 'Isi nomor referensi transfer');
  return db.transaction(async (tx) => {
    const shiftId = r.method === 'cash' ? await cashShiftFor(actor, tx) : null;
    const [after] = await tx.update(refunds).set({ status: 'paid', paidBy: actor.id, paidAt: new Date(), paidRef, shiftId, updatedAt: new Date() })
      .where(and(eq(refunds.id, r.id), eq(refunds.status, 'approved'))).returning();
    if (!after) throw new HttpError(409, 'Refund sudah dibayar');
    await notifyCustomer(tx, { phone: r.customerPhone }, 'refund_paid', { name: r.customerName, amount: money(r.amount), refundNo: r.refundNo, ref: r.sourceNo,
      method: r.method === 'cash' ? 'secara tunai di kasir' : `via transfer ke ${r.bankName} ${r.accountNo}`, link: webUrl() }, { type: 'refund', id: r.id, dedupe: `refund:${r.id}` });
    if (r.sourceType === 'return') await completeReturnTx(tx, r.sourceId, `Refund ${r.refundNo} dibayarkan`);
    return after;
  });
}

// ===========================================================================
// RETUR BARANG
// ===========================================================================
export const RETURN_REASONS: Record<string, string> = { damaged: 'Rusak saat diterima', wrong_item: 'Barang tidak sesuai pesanan', defect: 'Cacat / tidak berfungsi (garansi)', other: 'Lainnya' };

async function loadReturn(id: string, tx: Tx | typeof db = db) {
  const [r] = await tx.select().from(productReturns).where(eq(productReturns.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'Retur tidak ditemukan');
  return r;
}

export async function requestReturn(actor: AuthUser, p: { sourceNo: string; productId: string; qty: number; reason: string; description: string; resolution: 'replace' | 'refund' | 'repair' }) {
  if (!REQUEST_ROLES.includes(actor.roleCode)) throw new HttpError(403, 'Tidak berwenang mengajukan retur');
  if (!RETURN_REASONS[p.reason]) throw new HttpError(400, 'Alasan retur tidak dikenal');
  const src = await lookupSource(actor, p.sourceNo);
  if (!src.canReturn) throw new HttpError(409, 'Retur hanya untuk barang yang sudah diterima nasabah');
  if (src.sourceType === 'credit' && p.resolution === 'refund') throw new HttpError(400, 'Barang kredit diretur dengan penggantian atau perbaikan, bukan refund');
  const item = src.items.find((i) => i.productId === p.productId);
  if (!item) throw new HttpError(400, 'Produk tidak ada pada transaksi ini');
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${productReturns.qty}), 0)::int` }).from(productReturns)
    .where(and(eq(productReturns.sourceId, src.id), eq(productReturns.productId, p.productId), ne(productReturns.status, 'rejected')));
  if (p.qty > item.qty - Number(used)) throw new HttpError(400, `Jumlah retur maksimal ${item.qty - Number(used)}`);
  return db.transaction(async (tx) => {
    const returnNo = await financeNo(tx, 'RTR');
    const [r] = await tx.insert(productReturns).values({
      returnNo, sourceType: src.sourceType, sourceId: src.id, sourceNo: src.no, branchId: src.branchId, productId: p.productId, qty: p.qty, unitPrice: item.unitPrice,
      customerName: src.customerName, customerPhone: src.customerPhone, reason: p.reason, description: p.description, resolution: p.resolution, requestedBy: actor.id,
    }).returning();
    await notifyRole(tx, 'branch-manager', src.branchId, `Permintaan retur ${returnNo}`, `${src.no} · ${item.name} × ${p.qty} · ${RETURN_REASONS[p.reason]}`);
    return r;
  });
}

export async function decideReturn(actor: AuthUser, id: string, decision: 'approve' | 'reject', note: string | null) {
  const r = await loadReturn(id);
  if (r.status !== 'requested') throw new HttpError(409, 'Retur sudah diproses');
  if (!((actor.roleCode === 'branch-manager' && actor.branch?.id === r.branchId) || actor.roleCode === 'biz-mgr')) throw new HttpError(403, 'Retur disetujui Manager Cabang');
  if (decision === 'reject' && !note?.trim()) throw new HttpError(400, 'Isi alasan penolakan');
  return db.transaction(async (tx) => {
    const [after] = await tx.update(productReturns).set({ status: decision === 'approve' ? 'approved' : 'rejected', approvedBy: actor.id, approvedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(and(eq(productReturns.id, r.id), eq(productReturns.status, 'requested'))).returning();
    if (!after) throw new HttpError(409, 'Retur sudah diproses');
    await tx.insert(notifications).values({ userId: r.requestedBy, title: `Retur ${r.returnNo} ${decision === 'approve' ? 'disetujui — terima barang dari nasabah' : 'ditolak'}`, body: note ?? r.description });
    if (decision === 'approve') await notifyRole(tx, 'branch-admin', r.branchId, `Retur ${r.returnNo} disetujui`, 'Terima barang retur dari nasabah lalu proses penyelesaiannya.');
    return after;
  });
}

export interface ReceiveInput {
  condition: 'good' | 'damaged'; note?: string | null;
  // penggantian
  deliveryMode?: 'pickup' | 'internal'; address?: string | null; city?: string | null;
  // refund (order tunai)
  refundMethod?: 'cash' | 'transfer'; bankName?: string | null; accountNo?: string | null; accountName?: string | null;
}

/** Admin Cabang menerima barang retur, lalu penyelesaian otomatis: kirim pengganti / refund / perbaikan. */
export async function receiveReturn(actor: AuthUser, id: string, p: ReceiveInput) {
  const r = await loadReturn(id);
  if (actor.roleCode !== 'branch-admin' || actor.branch?.id !== r.branchId) throw new HttpError(403, 'Barang retur diterima Admin Cabang');
  if (r.status !== 'approved') throw new HttpError(409, 'Retur belum disetujui atau sudah diterima');
  if (r.resolution === 'refund') assertPayout({ method: p.refundMethod ?? 'cash', bankName: p.bankName, accountNo: p.accountNo, accountName: p.accountName });
  if (r.resolution === 'replace' && (p.deliveryMode ?? 'pickup') === 'internal' && !(p.address?.trim() && p.city?.trim())) throw new HttpError(400, 'Isi alamat & kota pengiriman barang pengganti');
  const [prod] = await db.select().from(products).where(eq(products.id, r.productId)).limit(1);

  return db.transaction(async (tx) => {
    const ref = { refType: 'return', refId: r.id, refNo: r.returnNo };
    // Barang milik nasabah yang diperbaiki tidak masuk stok; barang retur kondisi baik kembali ke stok cabang
    if (p.condition === 'good' && r.resolution !== 'repair') await applyMovement(tx, { productId: r.productId, branchId: r.branchId, type: 'return_in', qty: r.qty, ...ref, note: `Retur ${r.sourceNo} (kondisi baik)`, actorId: actor.id });
    // Barang rusak tidak masuk stok jual: dicatat di karantina sampai diputuskan (perbaiki / klaim pemasok / hapus buku)
    if (p.condition === 'damaged' && r.resolution !== 'repair') await quarantineFromReturn(tx, r, actor, p.note ?? null);
    const patch: Partial<ProductReturn> = { status: 'received', condition: p.condition, receivedBy: actor.id, receivedAt: new Date(), completionNote: p.note ?? null, updatedAt: new Date() };

    if (r.resolution === 'replace') {
      // Barang pengganti: stok cabang dulu, lalu Gudang Pusat
      const loc = await stockLocation(tx, r.productId, r.qty, r.branchId);
      if (!loc) throw new HttpError(409, `Stok pengganti ${prod.name} belum tersedia di cabang maupun Gudang Pusat`);
      await reserveStock(tx, r.productId, loc, r.qty, ref, actor.id);
      const mode: DeliveryMode = p.deliveryMode ?? 'pickup';
      const s = await createShipment(tx, {
        sourceType: 'return', sourceId: r.id, sourceNo: r.returnNo, branchId: r.branchId, fromBranchId: loc, mode,
        recipientName: r.customerName, recipientPhone: r.customerPhone ?? '', address: p.address ?? '', city: p.city ?? '',
        itemsSummary: `${prod.name} × ${r.qty} (pengganti retur ${r.sourceNo})`, weightKg: prod.weightKg * r.qty, isBulky: prod.isBulky,
        needsInstallation: prod.requiresInstallation, shippingFee: 0,
      });
      patch.replacementShipmentId = s.id;
    } else if (r.resolution === 'refund') {
      const refundNo = await financeNo(tx, 'RFD');
      const [rf] = await tx.insert(refunds).values({
        refundNo, sourceType: 'return', sourceId: r.id, sourceNo: r.returnNo, branchId: r.branchId, customerName: r.customerName, customerPhone: r.customerPhone,
        amount: Math.round(r.unitPrice * r.qty * 100) / 100, reason: `Retur ${r.sourceNo}: ${RETURN_REASONS[r.reason]}`, method: p.refundMethod ?? 'cash',
        bankName: p.bankName ?? null, accountNo: p.accountNo ?? null, accountName: p.accountName ?? null, status: 'approved',
        requestedBy: actor.id, approvedBy: r.approvedBy, approvedAt: r.approvedAt,
      }).returning();
      patch.refundId = rf.id;
      await notifyRole(tx, 'cashier', r.branchId, `Refund retur ${refundNo} siap dibayarkan`, `${r.customerName} · ${fmt(rf.amount)}`);
    }
    const [after] = await tx.update(productReturns).set(patch).where(and(eq(productReturns.id, r.id), eq(productReturns.status, 'approved'))).returning();
    if (!after) throw new HttpError(409, 'Barang retur sudah diterima');
    return after;
  });
}

async function stockLocation(tx: Tx, productId: string, qty: number, branchId: string) {
  const [ho] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.type, 'head_office')).limit(1);
  for (const loc of [branchId, ho?.id].filter(Boolean) as string[]) {
    const [s] = await tx.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.branchId, loc))).limit(1);
    if (s && s.onHand - s.reserved >= qty) return loc;
  }
  return null;
}

async function completeReturnTx(tx: Tx, id: string, note: string) {
  await tx.update(productReturns).set({ status: 'completed', completedAt: new Date(), completionNote: sql`concat_ws(' · ', ${productReturns.completionNote}, ${note}::text)`, updatedAt: new Date() })
    .where(and(eq(productReturns.id, id), eq(productReturns.status, 'received')));
}

/** Perbaikan garansi selesai & barang dikembalikan ke nasabah. */
export async function completeRepair(actor: AuthUser, id: string, note: string) {
  const r = await loadReturn(id);
  if (actor.roleCode !== 'branch-admin' || actor.branch?.id !== r.branchId) throw new HttpError(403, 'Diselesaikan Admin Cabang');
  if (r.resolution !== 'repair' || r.status !== 'received') throw new HttpError(409, 'Retur ini tidak menunggu penyelesaian perbaikan');
  return db.transaction(async (tx) => { await completeReturnTx(tx, r.id, `Perbaikan selesai: ${note}`); return loadReturn(r.id, tx); });
}

// Barang pengganti diterima nasabah -> stok keluar, retur selesai
onShipmentDelivered('return', async (tx, s, actor) => {
  const r = await loadReturn(s.sourceId, tx);
  await commitReservedOut(tx, r.productId, s.fromBranchId, r.qty, { refType: 'return', refId: r.id, refNo: r.returnNo }, actor?.id);
  await completeReturnTx(tx, r.id, `Barang pengganti diterima (${s.shipmentNo})`);
});

export type { Refund, ProductReturn };
