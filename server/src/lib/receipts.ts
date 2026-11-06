import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branchExpenses, branches, creditApplications, customers, installments, orderItems, orders, paymentAllocations, payments, products, refunds, users,
} from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import { creditPosition } from './payments.js';
import { EXPENSE_CATEGORIES } from './finance.js';
import type { AuthUser } from '../middleware/auth.js';
import { TAX_LABEL, branchCountry, phoneEq } from './region.js';

/** Data dokumen cetak: kwitansi (penerimaan) & bukti kas keluar (biaya, refund). Dirender & dicetak di browser. */
export interface PrintDoc {
  kind: 'receipt' | 'expense' | 'refund';
  title: string; number: string; date: string | null; currency: string; status: string;
  company: string; branch: { name: string; address: string | null; phone: string | null };
  party: { label: string; name: string; phone?: string | null };
  lines: { label: string; amount: number; note?: string }[];
  total: number; totalLabel: string;
  extras: { label: string; value: string }[];
  officer: string | null; notes: string[];
}

const METHOD: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer bank', va: 'Virtual Account', qris: 'QRIS' };

async function branchInfo(id: string) {
  const [b] = await db.select({ name: branches.name, address: branches.address, phone: branches.phone }).from(branches).where(eq(branches.id, id)).limit(1);
  return b ?? { name: '-', address: null, phone: null };
}
const company = async (country = 'ID') => String(await getConfig<string>('general.company_name', country).catch(() => 'Masri-M Syariah'));
const userName = async (id: string | null) => id ? (await db.select({ n: users.fullName }).from(users).where(eq(users.id, id)).limit(1))[0]?.n ?? null : null;

/** Kwitansi pembayaran. `verifyPhone` dipakai untuk akses publik (nasabah). */
export async function receiptDoc(paymentNo: string, opts: { actor?: AuthUser; verifyPhone?: string } = {}): Promise<PrintDoc> {
  const [p] = await db.select().from(payments).where(eq(payments.paymentNo, paymentNo.toUpperCase())).limit(1);
  if (!p || p.status !== 'paid') throw new HttpError(404, 'Kwitansi tidak ditemukan (pembayaran belum lunas)');
  if (opts.actor && opts.actor.branch?.type === 'branch' && opts.actor.branch.id !== p.branchId) throw new HttpError(403, 'Pembayaran bukan milik cabang Anda');

  const lines: PrintDoc['lines'] = [];
  const extras: PrintDoc['extras'] = [];
  const notes: string[] = [];
  let party: PrintDoc['party'];
  let currency = 'IDR';

  if (p.kind === 'order') {
    const [o] = await db.select().from(orders).where(eq(orders.id, p.refId)).limit(1);
    if (opts.verifyPhone !== undefined && !(await phoneEq(o?.recipientPhone, opts.verifyPhone, p.branchId))) throw new HttpError(404, 'Kwitansi tidak ditemukan');
    currency = o.currency;
    party = { label: 'Diterima dari', name: o.recipientName, phone: o.recipientPhone };
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    for (const i of items) lines.push({ label: `${i.name} × ${i.qty}`, amount: i.unitPrice * i.qty });
    if (o.discount) lines.push({ label: `Potongan promo${o.promoCode ? ` (${o.promoCode})` : ''}`, amount: -o.discount });
    const cc = await branchCountry(p.branchId);
    if (o.tax) lines.push({ label: TAX_LABEL[cc] ?? 'Pajak', amount: o.tax });
    if (o.shippingFee) lines.push({ label: 'Ongkos kirim', amount: o.shippingFee });
    extras.push({ label: 'No. order', value: o.orderNo });
    const [incl, vat] = await Promise.all([getConfig<boolean>('tax.prices_include_vat', cc).catch(() => false), getConfig<number>('tax.vat_rate', cc).catch(() => 0)]);
    if (incl && !o.tax && Number(vat) > 0) notes.push(`Harga sudah termasuk ${TAX_LABEL[cc] ?? 'pajak'}.`);
  } else {
    const [row] = await db.select({ a: creditApplications, name: customers.fullName, phone: customers.phone, product: products.name }).from(creditApplications)
      .innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
      .where(eq(creditApplications.id, p.refId)).limit(1);
    if (opts.verifyPhone !== undefined && !(await phoneEq(row?.phone, opts.verifyPhone, p.branchId))) throw new HttpError(404, 'Kwitansi tidak ditemukan');
    const a = row.a;
    currency = a.currency;
    party = { label: 'Diterima dari', name: row.name, phone: row.phone };
    extras.push({ label: 'No. akad', value: a.contractNo ?? a.appNo }, { label: 'Barang', value: `${row.product} × ${a.qty}` });
    if (p.kind === 'down_payment') {
      lines.push({ label: 'Uang muka (urbun) Murabahah', amount: Math.min(p.amount, a.downPayment ?? p.amount) });
      if (a.shippingFee) lines.push({ label: 'Ongkos kirim', amount: a.shippingFee });
      const rest = Math.round((p.amount - Math.min(p.amount, a.downPayment ?? p.amount) - (a.shippingFee ?? 0)) * 100) / 100;
      if (rest > 0) lines.push({ label: 'Lebih bayar', amount: rest });
      extras.push({ label: 'Harga jual Murabahah', value: (a.salePrice ?? 0).toLocaleString('id-ID') }, { label: 'Angsuran', value: `${(a.monthly ?? 0).toLocaleString('id-ID')} × ${a.tenor}` });
    } else {
      const alloc = await db.select({ seq: installments.seq, due: installments.dueDate, amount: paymentAllocations.amount }).from(paymentAllocations)
        .innerJoin(installments, eq(installments.id, paymentAllocations.installmentId)).where(eq(paymentAllocations.paymentId, p.id)).orderBy(asc(installments.seq));
      if (p.ibraAmount > 0) {
        const total = alloc.reduce((s, x) => s + x.amount, 0);
        lines.push({ label: `Pelunasan dipercepat — angsuran ke-${alloc[0]?.seq ?? '-'} s/d ${alloc[alloc.length - 1]?.seq ?? '-'}`, amount: total });
        lines.push({ label: "Potongan pelunasan (ibra')", amount: -p.ibraAmount });
      } else {
        for (const x of alloc) lines.push({ label: `Angsuran ke-${x.seq} (jatuh tempo ${x.due})`, amount: x.amount });
      }
      const pos = await creditPosition(a.id);
      extras.push({ label: 'Sisa kewajiban saat dicetak', value: pos.outstanding.toLocaleString('id-ID') });
    }
  }
  if (p.tazirAmount > 0) {
    lines.push({ label: "Ta'zir keterlambatan (dana sosial)", amount: p.tazirAmount });
    notes.push("Ta'zir tidak diakui sebagai pendapatan perusahaan dan disalurkan untuk kegiatan sosial.");
  }
  extras.push({ label: 'Metode', value: `${METHOD[p.method] ?? p.method}${p.proofRef ? ` · ref ${p.proofRef}` : ''}${p.vaNumber && p.method === 'va' ? ` · VA ${p.vaNumber}` : ''}` });
  if (p.note) notes.push(p.note);
  const total = Math.round((p.amount + p.tazirAmount) * 100) / 100;
  return {
    kind: 'receipt', title: 'KWITANSI', number: p.paymentNo, date: (p.paidAt ?? p.createdAt).toISOString(), currency, status: 'LUNAS',
    company: await company(), branch: await branchInfo(p.branchId), party: party!, lines, total, totalLabel: 'Jumlah diterima', extras,
    officer: (await userName(p.receivedBy)) ?? (p.channel === 'gateway' ? 'Pembayaran elektronik' : null), notes,
  };
}

/** Bukti kas keluar: biaya operasional & refund. */
export async function voucherDoc(type: 'expense' | 'refund', id: string, actor: AuthUser): Promise<PrintDoc> {
  if (type === 'expense') {
    const submitter = aliasedTable(users, 'submitter_u');
    const [row] = await db.select({ e: branchExpenses, submitter: submitter.fullName, approver: sql<string | null>`(select u.full_name from users u where u.id = ${branchExpenses.mcBy})` }).from(branchExpenses)
      .innerJoin(submitter, eq(submitter.id, branchExpenses.submittedBy)).where(eq(branchExpenses.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Biaya tidak ditemukan');
    const e = row.e;
    if (actor.branch?.type === 'branch' && actor.branch.id !== e.branchId) throw new HttpError(403, 'Bukan biaya cabang Anda');
    return {
      kind: 'expense', title: 'BUKTI KAS KELUAR', number: e.expenseNo, date: (e.paidAt ?? e.createdAt).toISOString(), currency: 'IDR', status: e.status.toUpperCase(),
      company: await company(), branch: await branchInfo(e.branchId), party: { label: 'Dibayarkan kepada', name: e.vendor || '-' },
      lines: [{ label: `${EXPENSE_CATEGORIES[e.category] ?? e.category}: ${e.description}`, amount: e.amount }], total: e.amount, totalLabel: 'Jumlah dibayarkan',
      extras: [{ label: 'Tanggal biaya', value: e.expenseDate }, { label: 'No. nota', value: e.receiptRef ?? '-' }, { label: 'Metode', value: `${METHOD[e.method]}${e.paidRef ? ` · ref ${e.paidRef}` : ''}` },
        { label: 'Diajukan', value: row.submitter }, { label: 'Disetujui', value: row.approver ?? '-' }],
      officer: await userName(e.paidBy), notes: e.decisionNote ? [e.decisionNote] : [],
    };
  }
  const [r] = await db.select().from(refunds).where(eq(refunds.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'Refund tidak ditemukan');
  if (actor.branch?.type === 'branch' && actor.branch.id !== r.branchId) throw new HttpError(403, 'Bukan refund cabang Anda');
  return {
    kind: 'refund', title: 'BUKTI PENGEMBALIAN DANA', number: r.refundNo, date: (r.paidAt ?? r.createdAt).toISOString(), currency: 'IDR', status: r.status.toUpperCase(),
    company: await company(), branch: await branchInfo(r.branchId), party: { label: 'Dikembalikan kepada', name: r.customerName, phone: r.customerPhone },
    lines: [{ label: `Pengembalian dana ${r.sourceNo}`, amount: r.amount, note: r.reason }], total: r.amount, totalLabel: 'Jumlah dikembalikan',
    extras: [{ label: 'Metode', value: r.method === 'cash' ? 'Tunai' : `Transfer ${r.bankName ?? ''} ${r.accountNo ?? ''} a.n. ${r.accountName ?? ''}` }, ...(r.paidRef ? [{ label: 'Ref. transfer', value: r.paidRef }] : [])],
    officer: await userName(r.paidBy), notes: ['Ditandatangani penerima sebagai tanda dana telah diterima.'],
  };
}

/** Daftar pembayaran lunas sebuah order / akad (untuk link kwitansi di halaman lacak). */
export async function paidPaymentsFor(kind: 'order' | 'credit', refId: string) {
  const kinds = kind === 'order' ? ['order'] : ['installment', 'down_payment'];
  return db.select({ paymentNo: payments.paymentNo, kind: payments.kind, amount: payments.amount, tazirAmount: payments.tazirAmount, ibraAmount: payments.ibraAmount, method: payments.method, paidAt: payments.paidAt })
    .from(payments).where(and(eq(payments.refId, refId), eq(payments.status, 'paid'), inArray(payments.kind, kinds))).orderBy(asc(payments.paidAt));
}
