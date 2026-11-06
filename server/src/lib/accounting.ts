import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  accountingPeriods, bankAccounts, bankLines, branchExpenses, branches, cashierShifts, charityDisbursements, coaAccounts, creditApplications, goodsReceiptItems,
  iqalahRequests, journalEntries, journalLines, orders, payments, postingErrors, productPrices, productReturns, quarantineItems, refunds, stockMovements, stockTransfers,
  supplierInvoices, supplierPayments, suppliers,
} from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import type { Tx } from './stock.js';
import { branchCountry, localDate } from './region.js';

/**
 * Akuntansi syariah — posting otomatis dari transaksi operasional ke jurnal (PSAK 102 Murabahah).
 *
 * Prinsip:
 * - Setiap dokumen operasional (mutasi stok, pembayaran, refund, biaya, shift, penyaluran dana kebajikan) menghasilkan
 *   tepat satu jurnal (indeks unik source_type + source_id + event) sehingga posting aman diulang.
 * - Penjualan Murabahah diakui saat barang diserahterimakan (kepemilikan berpindah, sesuai klausul akad):
 *   piutang = sisa harga jual; margin (harga jual + uang muka − harga perolehan) ditangguhkan lalu diakui
 *   secara proporsional terhadap kas yang diterima (uang muka & tiap angsuran).
 * - Ibra' (potongan pelunasan) mengurangi margin ditangguhkan, bukan beban.
 * - Ta'zir (denda keterlambatan) dicatat sebagai kewajiban Dana Kebajikan, bukan pendapatan.
 * - Setiap jurnal seimbang per kantor; selisih antar kantor otomatis dicatat ke Rekening Antar Kantor (RAK).
 */
type Db = Tx | typeof db;
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString('id-ID');
export const wibDate = (d: Date = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

// ---------------------------------------------------------------------------
// Bagan akun standar
// ---------------------------------------------------------------------------
export const ACC = {
  CASH: '1101', BANK: '1102', GATEWAY: '1103', AR_MURABAHAH: '1201', DEFERRED_MARGIN: '1202', SUPPLIER_CLAIM: '1203', INVENTORY: '1301', IN_TRANSIT: '1302', QUARANTINE: '1303',
  VAT_IN: '1401', RAK: '1901',
  AP: '2101', DP_MURABAHAH: '2201', ORDER_ADVANCE: '2202', IQALAH_PAYABLE: '2203', CHARITY: '2301', VAT_OUT: '2401',
  CAPITAL: '3101', RETAINED: '3201',
  SALES: '4101', SALES_RETURN: '4102', MARGIN_INCOME: '4201', SHIPPING_INCOME: '4301', OTHER_INCOME: '4901',
  COGS: '5101', WARRANTY: '5102', INV_VARIANCE: '5103', CASH_VARIANCE: '5104', BANK_FEE: '6110',
} as const;

export const EXPENSE_ACCOUNT: Record<string, string> = {
  transport: '6101', utilities: '6102', rent: '6103', office: '6104', maintenance: '6105', meals: '6106', courier: '6107',
  casual_labor: '6108', marketing: '6109', other: '6199',
};

type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
const COA: [string, string, AccType, 'debit' | 'credit', string, string?][] = [
  ['1101', 'Kas Cabang', 'asset', 'debit', 'Kas & Setara Kas'],
  ['1102', 'Bank', 'asset', 'debit', 'Kas & Setara Kas'],
  ['1103', 'Dana di Payment Gateway (kliring)', 'asset', 'debit', 'Kas & Setara Kas', 'Penerimaan VA/QRIS yang belum dicairkan gateway ke rekening bank'],
  ['1201', 'Piutang Murabahah', 'asset', 'debit', 'Piutang Murabahah', 'Sisa harga jual Murabahah yang belum diangsur'],
  ['1202', 'Margin Murabahah Ditangguhkan', 'asset', 'credit', 'Piutang Murabahah', 'Akun kontra piutang (PSAK 102): margin yang belum diakui'],
  ['1203', 'Piutang Klaim Pemasok', 'asset', 'debit', 'Piutang Lain-lain', 'Nilai barang rusak yang diklaim ke pemasok'],
  ['1301', 'Persediaan Barang Dagang', 'asset', 'debit', 'Persediaan'],
  ['1302', 'Persediaan dalam Perjalanan', 'asset', 'debit', 'Persediaan', 'Barang transfer antar kantor yang sudah dikirim, belum diterima'],
  ['1303', 'Persediaan Karantina (Rusak)', 'asset', 'debit', 'Persediaan', 'Barang rusak / retur menunggu keputusan: perbaiki, klaim pemasok, atau dihapus'],
  ['1401', 'PPN / SST Masukan', 'asset', 'debit', 'Pajak Dibayar di Muka', 'Pajak atas faktur pemasok yang dapat dikreditkan'],
  ['1901', 'Rekening Antar Kantor (RAK)', 'asset', 'debit', 'Antar Kantor', 'Saldo antar Pusat & cabang; bernilai nol saat konsolidasi'],
  ['2101', 'Hutang Dagang (Pemasok)', 'liability', 'credit', 'Kewajiban Lancar'],
  ['2201', 'Uang Muka Murabahah', 'liability', 'credit', 'Kewajiban Lancar', 'Uang muka + ongkir yang diterima saat akad, sebelum barang diserahkan'],
  ['2202', 'Uang Muka Penjualan Tunai', 'liability', 'credit', 'Kewajiban Lancar', 'Order tunai yang sudah dibayar tetapi barang belum dikirim / diambil'],
  ['2203', 'Hutang Pengembalian Dana Iqalah', 'liability', 'credit', 'Kewajiban Lancar', 'Dana nasabah yang wajib dikembalikan atas pembatalan akad (iqalah)'],
  ['2301', 'Dana Kebajikan (Ta\'zir)', 'liability', 'credit', 'Dana Kebajikan', 'Denda keterlambatan — wajib disalurkan untuk kegiatan sosial, bukan pendapatan'],
  ['2401', 'Pajak Keluaran (PPN / SST)', 'liability', 'credit', 'Kewajiban Pajak'],
  ['3101', 'Modal Disetor', 'equity', 'credit', 'Ekuitas'],
  ['3201', 'Laba Ditahan', 'equity', 'credit', 'Ekuitas'],
  ['4101', 'Penjualan Tunai', 'income', 'credit', 'Pendapatan Usaha'],
  ['4102', 'Retur & Pembatalan Penjualan', 'income', 'debit', 'Pendapatan Usaha', 'Akun kontra pendapatan'],
  ['4201', 'Pendapatan Margin Murabahah', 'income', 'credit', 'Pendapatan Usaha'],
  ['4301', 'Pendapatan Ongkos Kirim', 'income', 'credit', 'Pendapatan Usaha'],
  ['4901', 'Pendapatan Lain-lain', 'income', 'credit', 'Pendapatan Lain-lain'],
  ['5101', 'Harga Pokok Penjualan', 'expense', 'debit', 'Harga Pokok'],
  ['5102', 'Beban Garansi & Penggantian Barang', 'expense', 'debit', 'Harga Pokok'],
  ['5103', 'Selisih Persediaan', 'expense', 'debit', 'Harga Pokok', 'Hasil stock opname, barang rusak / hilang'],
  ['5104', 'Selisih Kas', 'expense', 'debit', 'Beban Lain-lain'],
  ['6101', 'Beban Transportasi & BBM', 'expense', 'debit', 'Beban Operasional'],
  ['6102', 'Beban Listrik, Air & Internet', 'expense', 'debit', 'Beban Operasional'],
  ['6103', 'Beban Sewa', 'expense', 'debit', 'Beban Operasional'],
  ['6104', 'Beban ATK & Perlengkapan', 'expense', 'debit', 'Beban Operasional'],
  ['6105', 'Beban Perawatan Gedung / Kendaraan', 'expense', 'debit', 'Beban Operasional'],
  ['6106', 'Beban Konsumsi & Jamuan', 'expense', 'debit', 'Beban Operasional'],
  ['6107', 'Beban Kurir & Ongkir Tambahan', 'expense', 'debit', 'Beban Operasional'],
  ['6108', 'Beban Tenaga Harian / Bongkar Muat', 'expense', 'debit', 'Beban Operasional'],
  ['6109', 'Beban Promosi Lokal', 'expense', 'debit', 'Beban Operasional'],
  ['6110', 'Beban Administrasi Bank & Payment Gateway', 'expense', 'debit', 'Beban Operasional', 'Biaya transfer, administrasi rekening, dan potongan MDR gateway'],
  ['6199', 'Beban Operasional Lain-lain', 'expense', 'debit', 'Beban Operasional'],
];

let coaReady = false;
export async function ensureCoa(tx: Db = db) {
  if (coaReady) return;
  await tx.insert(coaAccounts).values(COA.map(([code, name, type, normal, groupName, description]) => ({ code, name, type, normal, groupName, description: description ?? null, isSystem: true })))
    .onConflictDoNothing();
  coaReady = true;
}

export const cashAccount = (method: string) => (method === 'cash' ? ACC.CASH : method === 'transfer' ? ACC.BANK : ACC.GATEWAY);

// ---------------------------------------------------------------------------
// Penulisan jurnal
// ---------------------------------------------------------------------------
export interface Line { account: string; branchId: string; debit?: number; credit?: number; memo?: string; subType?: string; subId?: string }
export interface Draft {
  date: string; sourceType: string; sourceId: string; event?: string; sourceNo?: string | null; memo: string; lines: Line[];
  meta?: Record<string, unknown>; createdBy?: string | null; manual?: boolean; reversalOf?: string;
}

export async function isClosed(tx: Db, date: string) {
  const [p] = await tx.select({ period: accountingPeriods.period }).from(accountingPeriods).where(eq(accountingPeriods.period, date.slice(0, 7))).limit(1);
  return !!p;
}

/** Tambahkan baris RAK agar setiap kantor seimbang. */
function balanceBranches(lines: Line[]) {
  const diff = new Map<string, number>();
  for (const l of lines) diff.set(l.branchId, r2((diff.get(l.branchId) ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)));
  const out = [...lines];
  for (const [branchId, d] of diff) {
    if (Math.abs(d) < 0.005) continue;
    out.push(d > 0 ? { account: ACC.RAK, branchId, credit: d, memo: 'Antar kantor' } : { account: ACC.RAK, branchId, debit: -d, memo: 'Antar kantor' });
  }
  return out;
}

/** Simpan jurnal (idempoten). Mengembalikan null bila sumber yang sama sudah pernah dijurnal. */
export async function writeEntry(tx: Db, d: Draft) {
  let lines = d.lines.map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .filter((l) => l.debit > 0.004 || l.credit > 0.004 || l.debit < -0.004 || l.credit < -0.004);
  // Nilai negatif dipindah ke sisi sebaliknya
  lines = lines.map((l) => (l.debit < 0 || l.credit < 0 ? { ...l, debit: Math.max(0, l.debit) + Math.max(0, -l.credit), credit: Math.max(0, l.credit) + Math.max(0, -l.debit) } : l));
  const dr = r2(lines.reduce((s, l) => s + l.debit, 0)), cr = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) throw new HttpError(400, `Jurnal tidak seimbang: debit ${fmt(dr)} ≠ kredit ${fmt(cr)}`);
  lines = balanceBranches(lines).map((l) => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 }));
  let date = d.date, memo = d.memo;
  if (await isClosed(tx, date)) {
    if (d.manual) throw new HttpError(409, `Periode ${date.slice(0, 7)} sudah ditutup`);
    const today = wibDate();
    memo = `${memo} (periode ${date.slice(0, 7)} ditutup — dibukukan ${today})`;
    date = today;
  }
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('journal_seq')::text as seq`);
  const entryNo = `${d.manual ? 'JM' : d.reversalOf ? 'JB' : 'JU'}-${date.slice(2, 4)}${date.slice(5, 7)}-${seq.padStart(6, '0')}`;
  const [e] = await tx.insert(journalEntries).values({
    entryNo, date, sourceType: d.sourceType, sourceId: d.sourceId, event: d.event ?? 'main', sourceNo: d.sourceNo ?? null, memo,
    meta: d.meta ?? null, createdBy: d.createdBy ?? null, reversalOf: d.reversalOf ?? null,
  }).onConflictDoNothing().returning();
  if (!e) return null;
  if (lines.length) {
    await tx.insert(journalLines).values(lines.map((l, i) => ({
      entryId: e.id, lineNo: i + 1, accountCode: l.account, branchId: l.branchId, debit: l.debit ?? 0, credit: l.credit ?? 0,
      memo: l.memo ?? null, subType: l.subType ?? null, subId: l.subId ?? null,
    })));
  }
  return e;
}

// ---------------------------------------------------------------------------
// Harga perolehan (rata-rata tertimbang kumulatif dari penerimaan barang)
// ---------------------------------------------------------------------------
async function fallbackCost(tx: Db, productId: string, country: string) {
  const [p] = await tx.select({ price: productPrices.cashPrice }).from(productPrices).where(and(eq(productPrices.productId, productId), eq(productPrices.countryCode, country))).limit(1);
  const pct = Number(await getConfig<number>('finance.fallback_cost_pct', country)) || 80;
  return r2((p?.price ?? 0) * pct / 100);
}

/** Harga perolehan rata-rata dari penerimaan barang di negara yang sama (mata uang sama) dengan kantor `branchId`. */
export async function unitCost(tx: Db, productId: string, at: Date, branchId: string) {
  const country = await branchCountry(branchId);
  const { rows: [c] } = await tx.execute<{ v: string | null }>(sql`
    select sum(i.qty * i.unit_cost) / nullif(sum(i.qty), 0) as v
    from goods_receipt_items i join goods_receipts g on g.id = i.receipt_id join branches b on b.id = g.branch_id
    where i.product_id = ${productId} and i.unit_cost is not null and g.created_at <= ${at.toISOString()} and b.country_code = ${country}`);
  return c?.v != null ? r2(Number(c.v)) : fallbackCost(tx, productId, country);
}

/** Saldo buku pembantu pembiayaan (debit − kredit) per akun. */
async function subBalance(tx: Db, account: string, creditId: string) {
  const { rows: [b] } = await tx.execute<{ v: string | null }>(sql`
    select sum(debit - credit) as v from journal_lines where account_code = ${account} and sub_type = 'credit' and sub_id = ${creditId}`);
  return r2(Number(b?.v ?? 0));
}

async function saleEntryOf(tx: Db, creditId: string) {
  const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.event, 'murabahah'), sql`${journalEntries.meta}->>'creditId' = ${creditId}`)).limit(1);
  return e ?? null;
}

// ---------------------------------------------------------------------------
// Penanganan per jenis sumber
// ---------------------------------------------------------------------------
async function postStock(tx: Db, id: string) {
  const [m] = await tx.select().from(stockMovements).where(eq(stockMovements.id, Number(id))).limit(1);
  if (!m) throw new Error('Mutasi stok tidak ditemukan');
  const date = wibDate(m.createdAt), qty = Math.abs(m.qty);
  const base = { date, sourceType: 'stock', sourceId: id, sourceNo: m.refNo };

  // Harus diperiksa paling awal: mutasi karantina / iqalah bertipe 'adjustment' / 'return_in', tetapi nilainya
  // dijurnal oleh dokumen karantina / iqalah — tanpa ini persediaan terkredit dua kali.
  if (m.refType === 'quarantine' || m.refType === 'iqalah') {
    // Nilai barang dijurnal oleh dokumen karantina / iqalah; mutasi stok cukup ditandai sudah diproses
    return writeEntry(tx, { ...base, memo: `Mutasi stok ${m.refNo} (${m.qty > 0 ? '+' : ''}${m.qty} unit) — dijurnal pada dokumen ${m.refType === 'iqalah' ? 'iqalah' : 'karantina'}`, lines: [] });
  }

  if (m.type === 'receipt') {
    const [gi] = await tx.select({ unitCost: goodsReceiptItems.unitCost }).from(goodsReceiptItems)
      .where(and(eq(goodsReceiptItems.receiptId, m.refId!), eq(goodsReceiptItems.productId, m.productId))).limit(1);
    const uc = gi?.unitCost ?? await fallbackCost(tx, m.productId, await branchCountry(m.branchId));
    const v = r2(uc * qty);
    return writeEntry(tx, { ...base, memo: `Penerimaan barang ${m.refNo} (${qty} unit × ${fmt(uc)})${gi?.unitCost == null ? ' — harga beli estimasi' : ''}`, meta: { unitCost: uc, productId: m.productId },
      lines: [{ account: ACC.INVENTORY, branchId: m.branchId, debit: v }, { account: ACC.AP, branchId: m.branchId, credit: v, memo: m.note ?? undefined }] });
  }
  if (m.type === 'transfer_out') {
    const uc = await unitCost(tx, m.productId, m.createdAt, m.branchId), v = r2(uc * qty);
    return writeEntry(tx, { ...base, memo: `Transfer stok keluar ${m.refNo} (${qty} unit)`, meta: { unitCost: uc, productId: m.productId, transferId: m.refId },
      lines: [{ account: ACC.IN_TRANSIT, branchId: m.branchId, debit: v, memo: 'Barang dikirim ke kantor lain' }, { account: ACC.INVENTORY, branchId: m.branchId, credit: v }] });
  }
  if (m.type === 'transfer_in') {
    // Pakai harga yang sama dengan saat barang keluar agar RAK saling menghapus
    const { rows: [o] } = await tx.execute<{ uc: string | null; branch_id: string | null }>(sql`
      select e.meta->>'unitCost' as uc, s.branch_id from journal_entries e join stock_movements s on e.source_type = 'stock' and e.source_id = s.id::text
      where s.type = 'transfer_out' and s.ref_id = ${m.refId} and s.product_id = ${m.productId} limit 1`);
    const [t] = await tx.select({ from: stockTransfers.fromBranchId }).from(stockTransfers).where(eq(stockTransfers.id, m.refId!)).limit(1);
    const uc = o?.uc != null ? Number(o.uc) : await unitCost(tx, m.productId, m.createdAt, m.branchId), v = r2(uc * qty);
    return writeEntry(tx, { ...base, memo: `Transfer stok masuk ${m.refNo} (${qty} unit)`, meta: { unitCost: uc, productId: m.productId },
      lines: [{ account: ACC.INVENTORY, branchId: m.branchId, debit: v }, { account: ACC.IN_TRANSIT, branchId: o?.branch_id ?? t?.from ?? m.branchId, credit: v, memo: 'Barang diterima dari kantor lain' }] });
  }
  if (m.type === 'adjustment') {
    const uc = await unitCost(tx, m.productId, m.createdAt, m.branchId), v = r2(uc * qty);
    const lines: Line[] = m.qty > 0
      ? [{ account: ACC.INVENTORY, branchId: m.branchId, debit: v }, { account: ACC.INV_VARIANCE, branchId: m.branchId, credit: v }]
      : [{ account: ACC.INV_VARIANCE, branchId: m.branchId, debit: v }, { account: ACC.INVENTORY, branchId: m.branchId, credit: v }];
    return writeEntry(tx, { ...base, memo: `Penyesuaian stok ${m.refNo} (${m.qty > 0 ? '+' : ''}${m.qty} unit)${m.note ? ` — ${m.note}` : ''}`, meta: { unitCost: uc }, lines });
  }
  if (m.type === 'sale_out' && m.refType === 'order') {
    const [o] = await tx.select().from(orders).where(eq(orders.id, m.refId!)).limit(1);
    if (o) await recognizeOrderRevenue(tx, o, date);
    const uc = await unitCost(tx, m.productId, m.createdAt, m.branchId), v = r2(uc * qty);
    return writeEntry(tx, { ...base, memo: `HPP order ${m.refNo} (${qty} unit × ${fmt(uc)})`, meta: { unitCost: uc },
      lines: [{ account: ACC.COGS, branchId: o?.branchId ?? m.branchId, debit: v }, { account: ACC.INVENTORY, branchId: m.branchId, credit: v }] });
  }
  if (m.type === 'sale_out' && m.refType === 'credit') return postMurabahahSale(tx, m, base);
  if (m.refType === 'return') {
    const [rt] = await tx.select().from(productReturns).where(eq(productReturns.id, m.refId!)).limit(1);
    const uc = await unitCost(tx, m.productId, m.createdAt, m.branchId), v = r2(uc * qty);
    const branchId = rt?.branchId ?? m.branchId;
    if (m.type === 'return_in') {
      const against = rt?.sourceType === 'order' && rt.resolution === 'refund' ? ACC.COGS : ACC.WARRANTY;
      return writeEntry(tx, { ...base, memo: `Barang retur ${m.refNo} kembali ke stok (${qty} unit)`, meta: { unitCost: uc },
        lines: [{ account: ACC.INVENTORY, branchId: m.branchId, debit: v }, { account: against, branchId, credit: v }] });
    }
    return writeEntry(tx, { ...base, memo: `Barang pengganti retur ${m.refNo} (${qty} unit)`, meta: { unitCost: uc },
      lines: [{ account: ACC.WARRANTY, branchId, debit: v }, { account: ACC.INVENTORY, branchId: m.branchId, credit: v }] });
  }
  throw new Error(`Mutasi ${m.type}/${m.refType} belum punya aturan posting`);
}

/** Pendapatan order tunai diakui saat barang keluar (dikirim / diambil), bukan saat dibayar. */
async function recognizeOrderRevenue(tx: Db, o: typeof orders.$inferSelect, date: string) {
  const { rows: [adv] } = await tx.execute<{ v: string | null }>(sql`
    select sum(l.credit - l.debit) v from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.account_code = ${ACC.ORDER_ADVANCE} and l.sub_type = 'order' and l.sub_id = ${o.id}`);
  const received = r2(Number(adv?.v ?? 0));
  if (received <= 0.004) return null; // belum dibayar / sudah dikembalikan
  const tax = r2(o.tax), ship = r2(o.shippingFee), sales = r2(received - tax - ship);
  return writeEntry(tx, { date, sourceType: 'order', sourceId: o.id, event: 'revenue', sourceNo: o.orderNo, memo: `Pengakuan penjualan tunai ${o.orderNo} (barang dikirim / diambil)`, lines: [
    { account: ACC.ORDER_ADVANCE, branchId: o.branchId, debit: received, subType: 'order', subId: o.id },
    { account: ACC.SALES, branchId: o.branchId, credit: sales },
    { account: ACC.VAT_OUT, branchId: o.branchId, credit: tax },
    { account: ACC.SHIPPING_INCOME, branchId: o.branchId, credit: ship },
  ] });
}

/** Penjualan Murabahah saat serah terima barang (PSAK 102). */
async function postMurabahahSale(tx: Db, m: typeof stockMovements.$inferSelect, base: { date: string; sourceType: string; sourceId: string; sourceNo: string | null }) {
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, m.refId!)).limit(1);
  if (!a || a.salePrice == null) throw new Error('Data akad tidak lengkap');
  const qty = Math.abs(m.qty);
  const uc = await unitCost(tx, m.productId, m.createdAt, m.branchId);
  const cost = r2(uc * qty);
  const sale = r2(a.salePrice);                      // sisa harga jual yang diangsur
  const fee = r2(a.shippingFee ?? 0);
  const dpCash = r2(a.dpPaidAmount ?? (a.downPayment ?? 0) + fee); // uang muka + ongkir yang diterima saat akad
  const dp = r2(dpCash - fee);
  const totalSale = r2(sale + dp);                   // harga jual Murabahah keseluruhan
  const margin = r2(totalSale - cost);               // keuntungan Murabahah (diakui bertahap)
  const ratio = totalSale > 0 ? margin / totalSale : 0;
  const dpMargin = r2(dp * ratio);
  const sub = { subType: 'credit', subId: a.id };
  return writeEntry(tx, {
    ...base, event: 'murabahah', sourceNo: a.contractNo,
    memo: `Penjualan Murabahah ${a.contractNo}: harga jual ${fmt(totalSale)}, harga perolehan ${fmt(cost)}, margin ${fmt(margin)} (${(ratio * 100).toFixed(2)}%)`,
    meta: { creditId: a.id, cost, totalSale, margin, ratio, unitCost: uc },
    lines: [
      { account: ACC.AR_MURABAHAH, branchId: a.branchId, debit: sale, memo: 'Sisa harga jual (angsuran)', ...sub },
      { account: ACC.DP_MURABAHAH, branchId: a.branchId, debit: dpCash, memo: 'Uang muka & ongkir diterapkan', ...sub },
      { account: ACC.INVENTORY, branchId: m.branchId, credit: cost, memo: `Barang diserahkan (${qty} unit)` },
      { account: ACC.SHIPPING_INCOME, branchId: a.branchId, credit: fee },
      { account: ACC.DEFERRED_MARGIN, branchId: a.branchId, credit: margin, memo: 'Margin ditangguhkan', ...sub },
      { account: ACC.DEFERRED_MARGIN, branchId: a.branchId, debit: dpMargin, memo: 'Margin atas uang muka diakui', ...sub },
      { account: ACC.MARGIN_INCOME, branchId: a.branchId, credit: dpMargin, ...sub },
    ],
  });
}

async function postPayment(tx: Db, id: string) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!p || p.status !== 'paid' || !p.paidAt) throw new Error('Pembayaran belum lunas');
  const date = wibDate(p.paidAt), cash = cashAccount(p.method);
  const base = { date, sourceType: 'payment', sourceId: id, sourceNo: p.paymentNo };
  const via = p.method === 'cash' ? 'tunai' : p.method === 'transfer' ? 'transfer' : p.method.toUpperCase();

  if (p.kind === 'order') {
    return writeEntry(tx, { ...base, memo: `Pembayaran order tunai ${p.refNo} (${via}) — uang muka sampai barang dikirim`, lines: [
      { account: cash, branchId: p.branchId, debit: p.amount },
      { account: ACC.ORDER_ADVANCE, branchId: p.branchId, credit: p.amount, subType: 'order', subId: p.refId },
    ] });
  }
  const sub = { subType: 'credit', subId: p.refId };
  if (p.kind === 'down_payment') {
    return writeEntry(tx, { ...base, memo: `Uang muka & ongkir akad ${p.refNo} (${via})`, lines: [
      { account: cash, branchId: p.branchId, debit: p.amount }, { account: ACC.DP_MURABAHAH, branchId: p.branchId, credit: p.amount, ...sub },
    ] });
  }
  if (p.kind === 'installment') {
    const sale = await saleEntryOf(tx, p.refId);
    if (!sale) throw new Error(`Jurnal penjualan Murabahah ${p.refNo} belum ada (barang belum diserahkan?)`);
    const ratio = Number((sale.meta as { ratio?: number })?.ratio ?? 0);
    const amount = r2(p.amount), ibra = r2(p.ibraAmount), tazir = r2(p.tazirAmount);
    const arBefore = await subBalance(tx, ACC.AR_MURABAHAH, p.refId);
    const defBefore = -(await subBalance(tx, ACC.DEFERRED_MARGIN, p.refId)); // saldo kredit
    let recognize = r2(amount * ratio);
    const settles = arBefore - amount - ibra <= 0.005;
    const avail = r2(defBefore - ibra);
    if (settles || recognize > avail) recognize = Math.max(0, avail); // angsuran terakhir: sisa margin diakui seluruhnya
    const lines: Line[] = [
      { account: cash, branchId: p.branchId, debit: r2(amount + tazir) },
      { account: ACC.AR_MURABAHAH, branchId: p.branchId, credit: r2(amount + ibra), ...sub },
      { account: ACC.DEFERRED_MARGIN, branchId: p.branchId, debit: ibra, memo: "Ibra' (potongan pelunasan)", ...sub },
      { account: ACC.CHARITY, branchId: p.branchId, credit: tazir, memo: "Ta'zir keterlambatan", ...sub },
      { account: ACC.DEFERRED_MARGIN, branchId: p.branchId, debit: recognize, memo: 'Margin diakui', ...sub },
      { account: ACC.MARGIN_INCOME, branchId: p.branchId, credit: recognize, ...sub },
    ];
    return writeEntry(tx, { ...base, memo: `${ibra ? 'Pelunasan dipercepat' : 'Angsuran'} ${p.refNo} (${via})${ibra ? `, ibra' ${fmt(ibra)}` : ''}${tazir ? `, ta'zir ${fmt(tazir)}` : ''}`, lines, meta: { creditId: p.refId } });
  }
  throw new Error(`Jenis pembayaran ${p.kind} belum punya aturan posting`);
}

async function postRefund(tx: Db, id: string) {
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, id)).limit(1);
  if (!r || r.status !== 'paid' || !r.paidAt) throw new Error('Refund belum dibayar');
  const base = { date: wibDate(r.paidAt), sourceType: 'refund', sourceId: id, sourceNo: r.refundNo };
  const cash = { account: cashAccount(r.method), branchId: r.branchId, credit: r.amount };
  if (r.sourceType === 'iqalah') {
    return writeEntry(tx, { ...base, memo: `Pengembalian dana iqalah ${r.sourceNo}`, lines: [
      { account: ACC.IQALAH_PAYABLE, branchId: r.branchId, debit: r.amount }, cash] });
  }
  if (r.sourceType === 'credit') {
    return writeEntry(tx, { ...base, memo: `Refund uang muka pembatalan akad ${r.sourceNo}`, lines: [
      { account: ACC.DP_MURABAHAH, branchId: r.branchId, debit: r.amount, subType: 'credit', subId: r.sourceId }, cash] });
  }
  let orderId = r.sourceType === 'order' ? r.sourceId : null;
  if (r.sourceType === 'return') {
    const [rt] = await tx.select().from(productReturns).where(eq(productReturns.id, r.sourceId)).limit(1);
    if (rt?.sourceType === 'order') orderId = rt.sourceId;
  }
  const [o] = orderId ? await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1) : [];
  const [rev] = o ? await tx.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.sourceType, 'order'), eq(journalEntries.sourceId, o.id), eq(journalEntries.event, 'revenue'))).limit(1) : [];
  if (o && !rev) {
    // Barang belum dikirim: kembalikan uang muka penjualan
    return writeEntry(tx, { ...base, memo: `Refund ${r.sourceNo} sebelum barang dikirim — ${r.reason}`, lines: [
      { account: ACC.ORDER_ADVANCE, branchId: r.branchId, debit: r.amount, subType: 'order', subId: o.id }, cash] });
  }
  const taxShare = o && o.total > 0 ? r2(r.amount * o.tax / o.total) : 0;
  return writeEntry(tx, { ...base, memo: `Refund ${r.sourceNo} — ${r.reason}`, lines: [
    { account: ACC.SALES_RETURN, branchId: r.branchId, debit: r2(r.amount - taxShare) }, { account: ACC.VAT_OUT, branchId: r.branchId, debit: taxShare }, cash] });
}

async function postExpense(tx: Db, id: string) {
  const [e] = await tx.select().from(branchExpenses).where(eq(branchExpenses.id, id)).limit(1);
  if (!e || e.status !== 'paid' || !e.paidAt) throw new Error('Biaya belum dibayar');
  return writeEntry(tx, { date: wibDate(e.paidAt), sourceType: 'expense', sourceId: id, sourceNo: e.expenseNo, memo: `${e.description}${e.vendor ? ` — ${e.vendor}` : ''}`, lines: [
    { account: EXPENSE_ACCOUNT[e.category] ?? EXPENSE_ACCOUNT.other, branchId: e.branchId, debit: e.amount },
    { account: cashAccount(e.method), branchId: e.branchId, credit: e.amount },
  ] });
}

async function postShift(tx: Db, id: string) {
  const [s] = await tx.select().from(cashierShifts).where(eq(cashierShifts.id, id)).limit(1);
  if (!s || !s.closedAt) throw new Error('Shift belum ditutup');
  const dep = r2(s.depositAmount ?? 0), v = r2(s.variance ?? 0);
  const lines: Line[] = [
    { account: ACC.BANK, branchId: s.branchId, debit: dep, memo: s.depositRef ? `Setoran ${s.depositRef}` : undefined }, { account: ACC.CASH, branchId: s.branchId, credit: dep },
    ...(v > 0 ? [{ account: ACC.CASH, branchId: s.branchId, debit: v }, { account: ACC.CASH_VARIANCE, branchId: s.branchId, credit: v, memo: 'Kelebihan kas' }]
      : v < 0 ? [{ account: ACC.CASH_VARIANCE, branchId: s.branchId, debit: -v, memo: 'Kekurangan kas' }, { account: ACC.CASH, branchId: s.branchId, credit: -v }] : []),
  ];
  return writeEntry(tx, { date: wibDate(s.closedAt), sourceType: 'shift', sourceId: id, sourceNo: s.shiftNo, memo: `Tutup shift ${s.shiftNo}: setor bank ${fmt(dep)}, selisih kas ${fmt(v)}`, lines });
}

async function postCharity(tx: Db, id: string) {
  const [c] = await tx.select().from(charityDisbursements).where(eq(charityDisbursements.id, id)).limit(1);
  if (!c) throw new Error('Penyaluran tidak ditemukan');
  return writeEntry(tx, { date: c.date, sourceType: 'charity', sourceId: id, sourceNo: c.disbNo, memo: `Penyaluran dana kebajikan: ${c.recipient} — ${c.description}`, createdBy: c.createdBy, lines: [
    { account: ACC.CHARITY, branchId: c.branchId, debit: c.amount }, { account: cashAccount(c.method), branchId: c.branchId, credit: c.amount, memo: c.ref ?? undefined }] });
}

// ---------------------------------------------------------------------------
// Hutang pemasok
// ---------------------------------------------------------------------------
async function postApInvoice(tx: Db, id: string) {
  const [i] = await tx.select({ i: supplierInvoices, supplier: suppliers.name }).from(supplierInvoices).innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId)).where(eq(supplierInvoices.id, id)).limit(1);
  if (!i) throw new Error('Faktur pemasok tidak ditemukan');
  const inv = i.i, diff = r2(inv.subtotal - inv.receiptValue);
  return writeEntry(tx, { date: inv.invoiceDate, sourceType: 'ap_invoice', sourceId: id, sourceNo: inv.invoiceNo,
    memo: `Faktur ${i.supplier} ${inv.supplierInvoiceNo}${diff ? ` — selisih harga ${fmt(diff)} terhadap penerimaan barang` : ''}${inv.tax ? `, pajak masukan ${fmt(inv.tax)}` : ''}`,
    lines: [
      ...(diff > 0 ? [{ account: ACC.INVENTORY, branchId: inv.branchId, debit: diff, memo: 'Selisih harga faktur' }] : diff < 0 ? [{ account: ACC.INVENTORY, branchId: inv.branchId, credit: -diff, memo: 'Selisih harga faktur' }] : []),
      { account: ACC.VAT_IN, branchId: inv.branchId, debit: inv.tax },
      { account: ACC.AP, branchId: inv.branchId, credit: r2(diff + inv.tax), subType: 'supplier', subId: inv.supplierId },
    ] });
}

async function postApPayment(tx: Db, id: string) {
  const [p] = await tx.select({ p: supplierPayments, inv: supplierInvoices }).from(supplierPayments).innerJoin(supplierInvoices, eq(supplierInvoices.id, supplierPayments.invoiceId)).where(eq(supplierPayments.id, id)).limit(1);
  if (!p) throw new Error('Pembayaran pemasok tidak ditemukan');
  const credit = p.p.method === 'claim_offset' ? ACC.SUPPLIER_CLAIM : cashAccount(p.p.method);
  return writeEntry(tx, { date: wibDate(p.p.paidAt), sourceType: 'ap_payment', sourceId: id, sourceNo: p.p.paymentNo,
    memo: `Pembayaran faktur ${p.inv.supplierInvoiceNo} (${p.inv.invoiceNo})${p.p.bankRef ? ` — ${p.p.bankRef}` : ''}`,
    lines: [{ account: ACC.AP, branchId: p.inv.branchId, debit: p.p.amount, subType: 'supplier', subId: p.inv.supplierId }, { account: credit, branchId: p.p.branchId, credit: p.p.amount }] });
}

// ---------------------------------------------------------------------------
// Rekening koran: pencairan gateway, biaya bank, pendapatan lain
// ---------------------------------------------------------------------------
async function postBankLine(tx: Db, id: string) {
  const [l] = await tx.select({ l: bankLines, acc: bankAccounts }).from(bankLines).innerJoin(bankAccounts, eq(bankAccounts.id, bankLines.accountId)).where(eq(bankLines.id, id)).limit(1);
  if (!l) throw new Error('Mutasi bank tidak ditemukan');
  const { l: line, acc } = l, b = acc.branchId;
  const amt = line.credit > 0 ? line.credit : line.debit;
  const base = { date: line.txDate, sourceType: 'bank', sourceId: id, sourceNo: line.reference ?? null };
  if (line.matchType === 'gateway_settlement') {
    const gross = r2(Number((line.matchRefs ?? [])[0]?.amount ?? amt));
    return writeEntry(tx, { ...base, memo: `Pencairan payment gateway ${fmt(gross)} diterima ${fmt(amt)} di ${acc.bankName} ${acc.accountNo}`, lines: [
      { account: ACC.BANK, branchId: b, debit: amt }, { account: ACC.BANK_FEE, branchId: b, debit: r2(gross - amt), memo: 'Potongan MDR / biaya gateway' }, { account: ACC.GATEWAY, branchId: b, credit: gross }] });
  }
  if (line.matchType === 'bank_fee') return writeEntry(tx, { ...base, memo: `Biaya bank: ${line.description}`, lines: [{ account: ACC.BANK_FEE, branchId: b, debit: amt }, { account: ACC.BANK, branchId: b, credit: amt }] });
  if (line.matchType === 'other_income') return writeEntry(tx, { ...base, memo: `Pendapatan lain (rekening koran): ${line.description}`, lines: [{ account: ACC.BANK, branchId: b, debit: amt }, { account: ACC.OTHER_INCOME, branchId: b, credit: amt }] });
  throw new Error(`Mutasi bank jenis ${line.matchType} tidak dijurnal`);
}

// ---------------------------------------------------------------------------
// Karantina barang rusak & klaim pemasok
// ---------------------------------------------------------------------------
async function postQuarantine(tx: Db, sid: string) {
  const [id, ev] = sid.split(':');
  const [q] = await tx.select().from(quarantineItems).where(eq(quarantineItems.id, id)).limit(1);
  if (!q) throw new Error('Data karantina tidak ditemukan');
  const v = r2(q.unitCost * q.qty), b = q.branchId;
  const base = { sourceType: 'quarantine', sourceId: sid, event: 'main', sourceNo: q.qNo };
  // Barang iqalah yang rusak: nilainya sudah didebit ke Persediaan Karantina oleh jurnal iqalah
  if (ev === 'in' && q.source === 'iqalah') return writeEntry(tx, { ...base, date: wibDate(q.createdAt), memo: `Barang iqalah rusak masuk karantina ${q.qNo} — nilai dijurnal pada dokumen iqalah ${q.sourceRef ?? ''}`, lines: [] });
  if (ev === 'in') return writeEntry(tx, { ...base, date: wibDate(q.createdAt), memo: `Barang rusak masuk karantina ${q.qNo} (${q.qty} unit × ${fmt(q.unitCost)}) — ${q.conditionNote}`,
    lines: [{ account: ACC.QUARANTINE, branchId: b, debit: v }, { account: q.creditTo ?? ACC.WARRANTY, branchId: b, credit: v }] });
  if (ev === 'out') {
    const to = q.status === 'restocked' ? ACC.INVENTORY : q.status === 'written_off' ? ACC.INV_VARIANCE : ACC.SUPPLIER_CLAIM;
    const what = q.status === 'restocked' ? 'diperbaiki & kembali ke stok' : q.status === 'written_off' ? 'dihapusbukukan' : `diklaim ke pemasok (${q.claimNo})`;
    const claim = to === ACC.SUPPLIER_CLAIM ? r2(q.claimAmount ?? v) : v;
    return writeEntry(tx, { ...base, date: wibDate(q.decidedAt ?? new Date()), memo: `Karantina ${q.qNo} ${what}${q.decisionNote ? ` — ${q.decisionNote}` : ''}`, lines: [
      { account: to, branchId: b, debit: claim }, { account: ACC.QUARANTINE, branchId: b, credit: v },
      ...(claim !== v ? [{ account: ACC.INV_VARIANCE, branchId: b, debit: r2(v - claim), memo: 'Selisih nilai klaim' }] : []),
    ] });
  }
  if (ev === 'settle') {
    const claim = r2(q.claimAmount ?? v), got = r2(q.settledAmount ?? 0);
    // Nota kredit: bagian yang diganti sudah dijurnal oleh pembayaran faktur "potong klaim" (Hutang / Piutang Klaim)
    const viaCredit = q.settledMethod === 'credit_note';
    return writeEntry(tx, { ...base, date: wibDate(q.settledAt ?? new Date()), memo: `Penyelesaian klaim ${q.claimNo}: ${viaCredit ? 'nota kredit pemasok (potong faktur)' : 'transfer dari pemasok'} ${fmt(got)}${claim - got > 0.004 ? `, tidak diganti ${fmt(r2(claim - got))}` : ''}`, lines: [
      ...(viaCredit ? [] : [{ account: ACC.BANK, branchId: b, debit: got }]),
      { account: ACC.INV_VARIANCE, branchId: b, debit: r2(claim - got), memo: 'Klaim tidak diganti penuh' },
      { account: ACC.SUPPLIER_CLAIM, branchId: b, credit: viaCredit ? r2(claim - got) : claim }] });
  }
  throw new Error(`Event karantina ${ev} tidak dikenal`);
}

// ---------------------------------------------------------------------------
// Iqalah: pembatalan Murabahah setelah serah terima (PSAK 102 — penjualan dibalik)
// ---------------------------------------------------------------------------
async function postIqalah(tx: Db, id: string) {
  const [q] = await tx.select().from(iqalahRequests).where(eq(iqalahRequests.id, id)).limit(1);
  if (!q || q.status !== 'completed') throw new Error('Iqalah belum selesai');
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, q.applicationId)).limit(1);
  const sale = await saleEntryOf(tx, a.id);
  if (!sale) throw new Error(`Jurnal penjualan Murabahah ${a.contractNo} tidak ditemukan`);
  const meta = sale.meta as { cost: number; margin: number };
  const ar = await subBalance(tx, ACC.AR_MURABAHAH, a.id);
  const deferred = -(await subBalance(tx, ACC.DEFERRED_MARGIN, a.id));
  const recognized = r2(meta.margin - deferred);
  const goods = r2(meta.cost - q.depreciation);
  const sub = { subType: 'credit', subId: a.id };
  return writeEntry(tx, { date: wibDate(q.receivedAt ?? new Date()), sourceType: 'iqalah', sourceId: id, sourceNo: q.iqalahNo,
    memo: `Iqalah akad ${a.contractNo}: penjualan dibatalkan, barang kembali (nilai ${fmt(goods)} setelah penurunan ${fmt(q.depreciation)}), dana dikembalikan ${fmt(q.refundAmount)}`,
    meta: { creditId: a.id, cost: meta.cost, depreciation: q.depreciation, recognized },
    lines: [
      { account: q.goodsCondition === 'damaged' ? ACC.QUARANTINE : ACC.INVENTORY, branchId: q.branchId, debit: goods, memo: 'Barang kembali' },
      { account: ACC.DEFERRED_MARGIN, branchId: a.branchId, debit: deferred, memo: 'Margin ditangguhkan dihapus', ...sub },
      { account: ACC.MARGIN_INCOME, branchId: a.branchId, debit: recognized, memo: 'Margin yang sudah diakui dibalik', ...sub },
      { account: ACC.AR_MURABAHAH, branchId: a.branchId, credit: ar, memo: 'Sisa piutang dihapus', ...sub },
      { account: ACC.IQALAH_PAYABLE, branchId: a.branchId, credit: q.refundAmount, memo: 'Dana dikembalikan ke nasabah' },
    ] });
}

const HANDLERS: Record<string, (tx: Db, id: string) => Promise<unknown>> = {
  stock: postStock, payment: postPayment, refund: postRefund, expense: postExpense, shift: postShift, charity: postCharity,
  ap_invoice: postApInvoice, ap_payment: postApPayment, bank: postBankLine, quarantine: postQuarantine, iqalah: postIqalah,
};

/** Dokumen operasional yang belum dijurnal (urut waktu kejadian). */
const pendingSql = (limit: number) => sql`
  with ev as (
    select 'stock' st, m.id::text sid, m.created_at at, 1 pri from stock_movements m
      where m.qty <> 0 and m.type in ('receipt','transfer_out','transfer_in','adjustment','sale_out','return_in')
    union all select 'payment', p.id::text, p.paid_at, 2 from payments p where p.status = 'paid' and p.paid_at is not null
    union all select 'refund', r.id::text, r.paid_at, 3 from refunds r where r.status = 'paid' and r.paid_at is not null
    union all select 'expense', e.id::text, e.paid_at, 3 from branch_expenses e where e.status = 'paid' and e.paid_at is not null
    union all select 'shift', s.id::text, s.closed_at, 4 from cashier_shifts s where s.closed_at is not null
    union all select 'charity', c.id::text, c.created_at, 4 from charity_disbursements c
    union all select 'ap_invoice', i.id::text, i.created_at, 2 from supplier_invoices i where i.status <> 'cancelled'
    union all select 'ap_payment', p.id::text, p.paid_at, 3 from supplier_payments p
    union all select 'bank', l.id::text, l.matched_at, 4 from bank_lines l where l.status = 'posted'
    union all select 'quarantine', q.id::text || ':in', q.created_at, 2 from quarantine_items q
    union all select 'quarantine', q.id::text || ':out', q.decided_at, 3 from quarantine_items q where q.status in ('restocked','written_off','claimed','claim_settled') and q.decided_at is not null
    union all select 'quarantine', q.id::text || ':settle', q.settled_at, 4 from quarantine_items q where q.status = 'claim_settled' and q.settled_at is not null
    union all select 'iqalah', q.id::text, q.received_at, 3 from iqalah_requests q where q.status = 'completed'
  )
  select ev.st, ev.sid from ev
  where not exists (select 1 from journal_entries j where j.source_type = ev.st and j.source_id = ev.sid)
    and not exists (select 1 from posting_errors pe where pe.source_type = ev.st and pe.source_id = ev.sid and pe.last_at > now() - interval '10 minutes')
  order by ev.at, ev.pri
  limit ${limit}`;

export async function pendingCount() {
  const { rows: [r] } = await db.execute<{ n: string }>(sql`select count(*)::text n from (${pendingSql(100000)}) x`);
  return Number(r.n);
}

let syncing: Promise<{ posted: number; failed: number }> | null = null;
/** Posting otomatis semua dokumen yang belum dijurnal. Aman dipanggil berulang / bersamaan. */
export function syncJournals(opts: { retryErrors?: boolean } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    await ensureCoa();
    if (opts.retryErrors) await db.delete(postingErrors);
    let posted = 0, failed = 0;
    for (;;) {
      const { rows } = await db.execute<{ st: string; sid: string }>(pendingSql(200));
      if (!rows.length) break;
      let progress = 0;
      for (const ev of rows) {
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`journal:${ev.st}:${ev.sid}`}))`);
            const e = await HANDLERS[ev.st](tx, ev.sid);
            await tx.delete(postingErrors).where(and(eq(postingErrors.sourceType, ev.st), eq(postingErrors.sourceId, ev.sid)));
            if (e) posted++;
          });
          progress++;
        } catch (err) {
          failed++;
          const message = (err as Error).message.slice(0, 500);
          await db.insert(postingErrors).values({ sourceType: ev.st, sourceId: ev.sid, message })
            .onConflictDoUpdate({ target: [postingErrors.sourceType, postingErrors.sourceId], set: { message, attempts: sql`${postingErrors.attempts} + 1`, lastAt: new Date() } });
        }
      }
      if (!progress) break;
    }
    if (posted || failed) console.log(`[akuntansi] jurnal otomatis: ${posted} diposting${failed ? `, ${failed} gagal` : ''}`);
    return { posted, failed };
  })().finally(() => { syncing = null; });
  return syncing;
}

// ---------------------------------------------------------------------------
// Jurnal manual & pembalik
// ---------------------------------------------------------------------------
export async function createManualJournal(actor: { id: string }, p: { date: string; memo: string; lines: { accountCode: string; branchId: string; debit: number; credit: number; memo?: string | null }[] }) {
  await ensureCoa();
  if (p.date > wibDate()) throw new HttpError(400, 'Tanggal jurnal tidak boleh di masa depan');
  if (p.lines.length < 2) throw new HttpError(400, 'Minimal dua baris jurnal');
  const codes = [...new Set(p.lines.map((l) => l.accountCode))];
  const accs = await db.select().from(coaAccounts).where(inArray(coaAccounts.code, codes));
  for (const c of codes) {
    const a = accs.find((x) => x.code === c);
    if (!a) throw new HttpError(400, `Akun ${c} tidak ada`);
    if (!a.isActive) throw new HttpError(400, `Akun ${c} ${a.name} nonaktif`);
  }
  const bIds = [...new Set(p.lines.map((l) => l.branchId))];
  const bs = await db.select({ id: branches.id, country: branches.countryCode }).from(branches).where(inArray(branches.id, bIds));
  if (bs.length !== bIds.length) throw new HttpError(400, 'Kantor tidak dikenal');
  if (new Set(bs.map((b) => b.country)).size > 1) throw new HttpError(400, 'Satu jurnal hanya untuk kantor dalam satu negara (mata uang sama)');
  for (const l of p.lines) {
    if ((l.debit > 0) === (l.credit > 0)) throw new HttpError(400, 'Setiap baris diisi debit ATAU kredit');
  }
  return db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    const e = await writeEntry(tx, { date: p.date, sourceType: 'manual', sourceId: id, memo: p.memo, createdBy: actor.id, manual: true,
      lines: p.lines.map((l) => ({ account: l.accountCode, branchId: l.branchId, debit: l.debit, credit: l.credit, memo: l.memo ?? undefined })) });
    return e!;
  });
}

export async function reverseJournal(actor: { id: string }, id: string, p: { date?: string; reason: string }) {
  const [e] = await db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
  if (!e) throw new HttpError(404, 'Jurnal tidak ditemukan');
  if (e.sourceType !== 'manual') throw new HttpError(409, 'Jurnal otomatis tidak bisa dibalik — koreksi lewat dokumen sumber atau jurnal manual');
  if (e.status !== 'posted') throw new HttpError(409, 'Jurnal sudah dibalik');
  const date = p.date ?? wibDate();
  if (await isClosed(db, date)) throw new HttpError(409, `Periode ${date.slice(0, 7)} sudah ditutup`);
  const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, id)).orderBy(journalLines.lineNo);
  return db.transaction(async (tx) => {
    const r = await writeEntry(tx, { date, sourceType: 'reversal', sourceId: e.id, sourceNo: e.entryNo, memo: `Pembalik ${e.entryNo}: ${p.reason}`, createdBy: actor.id, reversalOf: e.id,
      lines: lines.filter((l) => l.accountCode !== ACC.RAK || l.memo !== 'Antar kantor').map((l) => ({ account: l.accountCode, branchId: l.branchId, debit: l.credit, credit: l.debit, memo: l.memo ?? undefined, subType: l.subType ?? undefined, subId: l.subId ?? undefined })) });
    if (!r) throw new HttpError(409, 'Jurnal sudah dibalik');
    await tx.update(journalEntries).set({ status: 'reversed' }).where(eq(journalEntries.id, e.id));
    return r;
  });
}

export async function charityNo(tx: Db) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('journal_seq')::text as seq`);
  const d = wibDate();
  return `DKB-${d.slice(2, 4)}${d.slice(5, 7)}-${seq.padStart(6, '0')}`;
}
