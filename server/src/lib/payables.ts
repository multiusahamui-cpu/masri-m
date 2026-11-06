import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, goodsReceiptItems, goodsReceipts, supplierInvoices, supplierPayments, suppliers } from '../db/schema.js';
import { HttpError } from './http.js';
import { CURRENCY } from './region.js';
import { wibDate } from './accounting.js';
import type { AuthUser } from '../middleware/auth.js';
import type { Tx } from './stock.js';

/**
 * Hutang pemasok per faktur.
 * - Nilai barang (harga beli × qty) sudah menjadi hutang saat penerimaan barang (Persediaan / Hutang Dagang).
 * - Faktur pemasok dicatat Bookkeeping dari penerimaan barang: selisih harga & pajak masukan dijurnal saat faktur dicatat.
 * - Pembayaran (transfer / tunai / potong klaim) mengurangi hutang per faktur; umur hutang dihitung dari jatuh tempo.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;
export const AP_ROLES = ['finance'];

async function apNo(tx: Tx | typeof db, prefix: 'AP' | 'SPY' | 'CLM') {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('ap_doc_seq')::text as seq`);
  const d = wibDate();
  return `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}-${seq.padStart(5, '0')}`;
}
export { apNo };

export function assertAp(actor: AuthUser) {
  if (!AP_ROLES.includes(actor.roleCode)) throw new HttpError(403, 'Hutang pemasok dikelola Bookkeeping');
}

// ---------------------------------------------------------------------------
// Master pemasok
// ---------------------------------------------------------------------------
export interface SupplierInput {
  code: string; name: string; countryCode: string; taxId?: string | null; phone?: string | null; email?: string | null; address?: string;
  bankName?: string | null; accountNo?: string | null; accountName?: string | null; paymentTermsDays: number; isActive?: boolean;
}
export async function saveSupplier(actor: AuthUser, id: string | null, p: SupplierInput) {
  if (!['finance', 'warehouse', 'super-admin'].includes(actor.roleCode)) throw new HttpError(403, 'Master pemasok dikelola Bookkeeping / Gudang Pusat');
  const code = p.code.trim().toUpperCase();
  const [dup] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.code, code), id ? ne(suppliers.id, id) : undefined)).limit(1);
  if (dup) throw new HttpError(409, `Kode pemasok ${code} sudah dipakai`);
  // Pemisahan tugas: rekening bank pemasok (tujuan pembayaran) hanya diisi / diubah Bookkeeping,
  // agar Gudang tidak bisa membuat pemasok + rekening sendiri lalu menerima barang atas namanya.
  const bank = actor.roleCode === 'finance' ? {} : { bankName: null, accountNo: null, accountName: null };
  const row = { ...p, ...bank, code, address: p.address ?? '', updatedAt: new Date() };
  if (id) {
    const [s] = await db.update(suppliers).set(row).where(eq(suppliers.id, id)).returning();
    if (!s) throw new HttpError(404, 'Pemasok tidak ditemukan');
    return s;
  }
  const [s] = await db.insert(suppliers).values(row).returning();
  return s;
}

// ---------------------------------------------------------------------------
// Faktur
// ---------------------------------------------------------------------------
/** Nilai penerimaan barang (yang sudah menjadi hutang) dan faktur yang sudah ada untuknya. */
export async function receiptValue(receiptId: string, tx: Tx | typeof db = db) {
  const [gr] = await tx.select({ gr: goodsReceipts, country: branches.countryCode }).from(goodsReceipts).innerJoin(branches, eq(branches.id, goodsReceipts.branchId)).where(eq(goodsReceipts.id, receiptId)).limit(1);
  if (!gr) throw new HttpError(404, 'Penerimaan barang tidak ditemukan');
  const items = await tx.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.receiptId, receiptId));
  if (items.some((i) => i.unitCost == null)) throw new HttpError(409, `Harga beli pada ${gr.gr.grNo} belum lengkap — lengkapi dulu agar nilai hutang tepat`);
  const value = r2(items.reduce((s, i) => s + i.qty * (i.unitCost ?? 0), 0));
  return { receipt: gr.gr, country: gr.country, value };
}

export async function createInvoice(actor: AuthUser, p: { supplierId: string; receiptId: string; supplierInvoiceNo: string; invoiceDate: string; dueDate?: string | null; subtotal?: number | null; tax: number; note?: string | null }) {
  assertAp(actor);
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1);
  if (!sup) throw new HttpError(404, 'Pemasok tidak ditemukan');
  const { receipt, country, value } = await receiptValue(p.receiptId);
  if (receipt.supplierId && receipt.supplierId !== sup.id) throw new HttpError(409, `${receipt.grNo} tercatat dari pemasok lain`);
  if (country !== sup.countryCode) throw new HttpError(409, 'Negara pemasok berbeda dengan kantor penerima barang');
  const [used] = await db.select({ id: supplierInvoices.id, no: supplierInvoices.invoiceNo }).from(supplierInvoices)
    .where(and(eq(supplierInvoices.receiptId, receipt.id), ne(supplierInvoices.status, 'cancelled'))).limit(1);
  if (used) throw new HttpError(409, `${receipt.grNo} sudah difakturkan (${used.no})`);
  if (p.invoiceDate > wibDate()) throw new HttpError(400, 'Tanggal faktur tidak boleh di masa depan');
  const subtotal = r2(p.subtotal ?? value);
  if (Math.abs(subtotal - value) > value * 0.2 + 1) throw new HttpError(400, `Nilai faktur ${subtotal.toLocaleString('id-ID')} berbeda jauh (>20%) dari nilai penerimaan ${value.toLocaleString('id-ID')} — periksa harga beli di penerimaan barang`);
  const due = p.dueDate ?? new Date(Date.parse(p.invoiceDate) + sup.paymentTermsDays * 86400_000).toISOString().slice(0, 10);
  if (due < p.invoiceDate) throw new HttpError(400, 'Jatuh tempo sebelum tanggal faktur');
  return db.transaction(async (tx) => {
    const invoiceNo = await apNo(tx, 'AP');
    if (!receipt.supplierId) await tx.update(goodsReceipts).set({ supplierId: sup.id }).where(eq(goodsReceipts.id, receipt.id));
    const [inv] = await tx.insert(supplierInvoices).values({
      invoiceNo, supplierId: sup.id, supplierInvoiceNo: p.supplierInvoiceNo.trim(), branchId: receipt.branchId, receiptId: receipt.id,
      invoiceDate: p.invoiceDate, dueDate: due, currency: CURRENCY[country] ?? 'IDR', receiptValue: value, subtotal, tax: r2(p.tax), total: r2(subtotal + p.tax),
      note: p.note ?? null, createdBy: actor.id,
    }).returning().catch((e) => { if (String(e?.cause?.code ?? e?.code) === '23505') throw new HttpError(409, 'Nomor faktur pemasok ini sudah dicatat'); throw e; });
    return inv;
  });
}

export async function cancelInvoice(actor: AuthUser, id: string, reason: string) {
  assertAp(actor);
  const [inv] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
  if (!inv) throw new HttpError(404, 'Faktur tidak ditemukan');
  if (inv.paidAmount > 0) throw new HttpError(409, 'Faktur yang sudah dibayar tidak bisa dibatalkan');
  const [j] = await db.execute<{ id: string }>(sql`select id from journal_entries where source_type = 'ap_invoice' and source_id = ${id}`).then((r) => r.rows);
  if (j) throw new HttpError(409, 'Faktur sudah dijurnal — koreksi dengan jurnal manual Bookkeeping');
  const [after] = await db.update(supplierInvoices).set({ status: 'cancelled', note: `${inv.note ? `${inv.note} · ` : ''}Dibatalkan: ${reason}`, updatedAt: new Date() }).where(eq(supplierInvoices.id, id)).returning();
  return after;
}

// ---------------------------------------------------------------------------
// Pembayaran
// ---------------------------------------------------------------------------
export async function payInvoice(actor: AuthUser, id: string, p: { amount: number; method: 'transfer' | 'cash' | 'claim_offset'; bankRef?: string | null; paidAt?: string | null; note?: string | null }, tx0?: Tx) {
  if (!tx0) assertAp(actor);
  if (p.method === 'transfer' && !p.bankRef) throw new HttpError(400, 'Isi nomor referensi transfer bank');
  const run = async (tx: Tx) => {
    const [inv] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).for('update').limit(1);
    if (!inv) throw new HttpError(404, 'Faktur tidak ditemukan');
    if (!['open', 'partial'].includes(inv.status)) throw new HttpError(409, 'Faktur sudah lunas / dibatalkan');
    const remaining = r2(inv.total - inv.paidAmount);
    if (p.amount <= 0 || p.amount - remaining > 0.009) throw new HttpError(400, `Nominal antara 1 dan sisa ${remaining.toLocaleString('id-ID')}`);
    const paidAt = p.paidAt ? new Date(`${p.paidAt}T12:00:00+07:00`) : new Date();
    if (paidAt.getTime() > Date.now() + 60_000) throw new HttpError(400, 'Tanggal bayar tidak boleh di masa depan');
    const paymentNo = await apNo(tx, 'SPY');
    const [pay] = await tx.insert(supplierPayments).values({ paymentNo, invoiceId: inv.id, branchId: inv.branchId, amount: r2(p.amount), method: p.method, bankRef: p.bankRef ?? null, paidAt, paidBy: actor.id, note: p.note ?? null }).returning();
    const paid = r2(inv.paidAmount + p.amount);
    await tx.update(supplierInvoices).set({ paidAmount: paid, status: paid >= inv.total - 0.009 ? 'paid' : 'partial', updatedAt: new Date() }).where(eq(supplierInvoices.id, inv.id));
    return pay;
  };
  return tx0 ? run(tx0) : db.transaction(run);
}

// ---------------------------------------------------------------------------
// Umur hutang
// ---------------------------------------------------------------------------
export async function apAging(country: string, asOf = wibDate()) {
  const rows = await db.select({ inv: supplierInvoices, supplier: suppliers.name, code: suppliers.code }).from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId)).innerJoin(branches, eq(branches.id, supplierInvoices.branchId))
    .where(and(inArray(supplierInvoices.status, ['open', 'partial']), eq(branches.countryCode, country))).orderBy(asc(supplierInvoices.dueDate));
  const bucket = (due: string) => { const d = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86400_000); return d <= 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90'; };
  const by = new Map<string, { supplierId: string; supplier: string; code: string; invoices: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90: number; total: number }>();
  for (const r of rows) {
    const rem = r2(r.inv.total - r.inv.paidAmount);
    const s = by.get(r.inv.supplierId) ?? { supplierId: r.inv.supplierId, supplier: r.supplier, code: r.code, invoices: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 };
    s.invoices++; s[bucket(r.inv.dueDate)] = r2(s[bucket(r.inv.dueDate)] + rem); s.total = r2(s.total + rem);
    by.set(r.inv.supplierId, s);
  }
  const list = [...by.values()].sort((a, b) => b.total - a.total);
  const total = list.reduce((t, s) => ({ current: t.current + s.current, d1_30: t.d1_30 + s.d1_30, d31_60: t.d31_60 + s.d31_60, d61_90: t.d61_90 + s.d61_90, d90: t.d90 + s.d90, total: t.total + s.total }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 });
  const dueSoon = rows.filter((r) => r.inv.dueDate <= new Date(Date.parse(asOf) + 7 * 86400_000).toISOString().slice(0, 10))
    .map((r) => ({ id: r.inv.id, invoiceNo: r.inv.invoiceNo, supplier: r.supplier, supplierInvoiceNo: r.inv.supplierInvoiceNo, dueDate: r.inv.dueDate, remaining: r2(r.inv.total - r.inv.paidAmount) }));
  return { asOf, currency: CURRENCY[country] ?? 'IDR', suppliers: list, total, dueSoon };
}
