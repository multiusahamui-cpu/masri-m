import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { creditApplications, creditEvents, installments, notifications, payments, paymentAllocations, tazirCharges, users, type Payment } from '../db/schema.js';
import { cashShiftFor } from './finance.js';
import { customerContact, links, money, notifyCustomer } from './notify.js';
import { orders } from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import { SUPPORTED, TIMEZONE, branchCountry, e164, localDate } from './region.js';
import type { Tx } from './stock.js';
import type { AuthUser } from '../middleware/auth.js';

import { getPaymentGateway, type GatewayNotification, type VaBank } from './gateways.js';
export { getPaymentGateway };

export async function nextPaymentNo(tx: Tx | typeof db) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('payment_doc_seq')::text as seq`);
  const d = new Date();
  return `PAY-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Angsuran: tunggakan, DPD, ta'zir
// ---------------------------------------------------------------------------
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // tanggal WIB

export async function creditPosition(appId: string, tx: Tx | typeof db = db) {
  const rows = await tx.select().from(installments).where(eq(installments.applicationId, appId)).orderBy(asc(installments.seq));
  const t = today();
  const unpaid = rows.filter((r) => r.status !== 'paid');
  const outstanding = unpaid.reduce((s, r) => s + (r.amount - r.paidAmount), 0);
  const overdueRows = unpaid.filter((r) => r.dueDate < t);
  const overdueAmount = overdueRows.reduce((s, r) => s + (r.amount - r.paidAmount), 0);
  const oldest = overdueRows[0];
  const dpd = oldest ? Math.floor((Date.parse(t) - Date.parse(oldest.dueDate)) / 86400_000) : 0;
  const next = unpaid[0] ?? null;
  const tz = await tx.select().from(tazirCharges).where(eq(tazirCharges.applicationId, appId)).orderBy(asc(tazirCharges.assessedOn));
  const tazirDue = round(tz.filter((c) => c.status === 'unpaid').reduce((s, c) => s + c.amount, 0));
  return { rows, outstanding: round(outstanding), overdueAmount: round(overdueAmount), dpd, next, paidCount: rows.length - unpaid.length, tazirDue, tazirCharges: tz };
}

const round = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Ta'zir otomatis (dana sosial)
// ---------------------------------------------------------------------------
/** Kenakan ta'zir satu kali untuk setiap angsuran yang terlambat melewati masa tenggang. Idempoten. */
export async function assessTazir() {
  let total = 0;
  for (const country of SUPPORTED) {
    if (!(await getConfig<boolean>('credit.tazir_enabled', country))) continue;
    const [grace, amount] = await Promise.all([getConfig<number>('credit.grace_period_days', country), getConfig<number>('credit.late_tazir_flat', country)]);
    if (!(Number(amount) > 0)) continue;
    const { rows } = await db.execute<{ id: string; application_id: string; branch_id: string }>(sql`
      select i.id, i.application_id, a.branch_id from installments i
      join credit_applications a on a.id = i.application_id
      join branches b on b.id = a.branch_id
      left join tazir_charges t on t.installment_id = i.id
      where a.status = 'active' and i.status <> 'paid' and t.id is null and b.country_code = ${country}
        and i.due_date::date + ${Number(grace)}::int < (now() at time zone ${TIMEZONE[country]})::date`);
    if (!rows.length) continue;
    const assessedOn = localDate(country);
    const inserted = await db.insert(tazirCharges).values(rows.map((r) => ({ applicationId: r.application_id, installmentId: r.id, branchId: r.branch_id, amount: Number(amount), assessedOn })))
      .onConflictDoNothing().returning({ id: tazirCharges.id });
    total += inserted.length;
  }
  return total;
}

/** Bebaskan ta'zir (nasabah tidak mampu / force majeure) — Manager Cabang / Business Manager. */
export async function waiveTazir(actor: AuthUser, chargeId: string, reason: string) {
  const [c] = await db.select().from(tazirCharges).where(eq(tazirCharges.id, chargeId)).limit(1);
  if (!c) throw new HttpError(404, "Ta'zir tidak ditemukan");
  if (!((actor.roleCode === 'branch-manager' && actor.branch?.id === c.branchId) || actor.roleCode === 'biz-mgr')) throw new HttpError(403, "Pembebasan ta'zir oleh Manager Cabang / Business Manager");
  if (c.status !== 'unpaid') throw new HttpError(409, "Ta'zir sudah dibayar / dibebaskan");
  return db.transaction(async (tx) => {
    const [after] = await tx.update(tazirCharges).set({ status: 'waived', waivedBy: actor.id, waiveReason: reason, updatedAt: new Date() }).where(eq(tazirCharges.id, c.id)).returning();
    await tx.insert(creditEvents).values({ applicationId: c.applicationId, type: 'tazir_waived', actorId: actor.id, actorName: actor.fullName, actorRole: actor.roleCode, message: `Ta'zir ${c.amount.toLocaleString('id-ID')} dibebaskan: ${reason}` });
    return after;
  });
}

/** Tandai ta'zir terbayar (tertua dulu) sebesar nominal ta'zir pada pembayaran. */
async function markTazirPaid(tx: Tx, appId: string, paymentId: string, amount: number) {
  if (amount <= 0) return;
  const open = await tx.select().from(tazirCharges).where(and(eq(tazirCharges.applicationId, appId), eq(tazirCharges.status, 'unpaid'))).orderBy(asc(tazirCharges.assessedOn));
  let left = amount;
  const ids: string[] = [];
  for (const c of open) { if (left + 0.009 < c.amount) break; ids.push(c.id); left = round(left - c.amount); }
  if (ids.length) await tx.update(tazirCharges).set({ status: 'paid', paymentId, updatedAt: new Date() }).where(inArray(tazirCharges.id, ids));
}

// ---------------------------------------------------------------------------
// Pelunasan dipercepat & ibra'
// ---------------------------------------------------------------------------
const UNIT: Record<string, number> = { IDR: 100, MYR: 0.05, BND: 0.05 };
const floorUnit = (v: number, cur: string) => { const u = UNIT[cur] ?? 0.01; return Math.round(Math.floor(v / u + 1e-9) * u * 100) / 100; };

/**
 * Kutipan pelunasan: seluruh sisa kewajiban dikurangi ibra' (potongan) atas margin angsuran yang BELUM jatuh tempo.
 * Angsuran yang sudah jatuh tempo / menunggak dibayar penuh. Ta'zir terutang ditampilkan terpisah (dana sosial).
 */
export async function settlementQuote(appId: string, tx: Tx | typeof db = db) {
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, appId)).limit(1);
  if (!a || a.status !== 'active') throw new HttpError(409, 'Pembiayaan tidak aktif');
  const pos = await creditPosition(appId, tx);
  const t = today();
  const future = pos.rows.filter((r) => r.status !== 'paid' && r.dueDate >= t);
  const futureOutstanding = round(future.reduce((s, r) => s + (r.amount - r.paidAmount), 0));
  const unearnedMargin = a.salePrice ? round((a.marginAmount ?? 0) * futureOutstanding / a.salePrice) : 0;
  const ibraPct = Number(await getConfig<number>('credit.early_settlement_ibra_pct', await branchCountry(a.branchId))) || 0;
  const ibra = Math.min(floorUnit(unearnedMargin * ibraPct / 100, a.currency), pos.outstanding);
  return {
    appNo: a.appNo, contractNo: a.contractNo, currency: a.currency, outstanding: pos.outstanding, overdueAmount: pos.overdueAmount,
    futureInstallments: future.length, futureOutstanding, unearnedMargin, ibraPct, ibra, payable: round(pos.outstanding - ibra), tazirDue: pos.tazirDue, validOn: t,
  };
}

/** Alokasikan pembayaran (+ ibra' bila pelunasan) ke angsuran tertua yang belum lunas. Lunas semua -> paid_off. */
async function allocateInstallments(tx: Tx, p: Payment, actor: AuthUser | null) {
  // Kunci akad: pembayaran kasir & webhook untuk akad yang sama diproses bergantian (tidak ada pembayaran yang "hilang")
  await tx.execute(sql`select id from credit_applications where id = ${p.refId} for update`);
  const pos = await creditPosition(p.refId, tx);
  const discount = p.ibraAmount ?? 0;
  if (p.amount + discount - pos.outstanding > 0.009) throw new HttpError(400, `Pembayaran melebihi sisa kewajiban ${pos.outstanding.toLocaleString('id-ID')}`);
  if (discount > 0 && Math.abs(p.amount + discount - pos.outstanding) > 0.009) throw new HttpError(409, 'Kutipan pelunasan sudah tidak berlaku, hitung ulang');
  await markTazirPaid(tx, p.refId, p.id, p.tazirAmount);
  let left = round(p.amount + discount);
  for (const r of pos.rows) {
    if (left <= 0) break;
    if (r.status === 'paid') continue;
    const need = round(r.amount - r.paidAmount);
    const pay = Math.min(need, left);
    left = round(left - pay);
    const paidAmount = round(r.paidAmount + pay);
    await tx.update(installments).set({ paidAmount, status: paidAmount >= r.amount - 0.009 ? 'paid' : 'partial', paidAt: new Date() }).where(eq(installments.id, r.id));
    await tx.insert(paymentAllocations).values({ paymentId: p.id, installmentId: r.id, amount: pay });
  }
  const after = await creditPosition(p.refId, tx);
  const [app] = await tx.select().from(creditApplications).where(eq(creditApplications.id, p.refId)).limit(1);
  await tx.insert(creditEvents).values({ applicationId: app.id, type: 'payment', actorId: actor?.id ?? null, actorName: actor?.fullName ?? 'Gateway pembayaran', actorRole: actor?.roleCode ?? 'system',
    message: `${discount ? 'Pelunasan dipercepat' : 'Pembayaran'} ${p.paymentNo} ${p.amount.toLocaleString('id-ID')} (${p.method})${discount ? `, ibra' ${discount.toLocaleString('id-ID')}` : ''}${p.tazirAmount ? ` + ta'zir ${p.tazirAmount.toLocaleString('id-ID')} (dana sosial)` : ''}. Sisa ${after.outstanding.toLocaleString('id-ID')}` });
  if (after.outstanding <= 0.009 && app.status === 'active') {
    await tx.update(creditApplications).set({ status: 'paid_off', updatedAt: new Date(), ...(discount ? { settledEarlyAt: new Date(), ibraAmount: discount } : {}) }).where(eq(creditApplications.id, app.id));
    await tx.insert(creditEvents).values({ applicationId: app.id, type: 'paid_off', actorName: 'Sistem', actorRole: 'system', message: discount ? `Lunas dipercepat dengan ibra' ${discount.toLocaleString('id-ID')}` : 'Seluruh angsuran lunas', fromStatus: 'active', toStatus: 'paid_off' });
    if (app.aoId) await tx.insert(notifications).values({ userId: app.aoId, title: `${app.appNo} LUNAS`, body: 'Seluruh angsuran Murabahah telah dibayar.' });
  }
}

/** Kasir mencatat pembayaran angsuran (tunai / transfer) di cabang. */
export async function recordInstallmentPayment(actor: AuthUser, appId: string, p: { amount?: number; method: 'cash' | 'transfer'; proofRef?: string | null; payTazir?: boolean; settlement?: boolean; note?: string | null }) {
  if (!['cashier', 'branch-admin'].includes(actor.roleCode)) throw new HttpError(403, 'Pembayaran dicatat Kasir');
  const [a] = await db.select().from(creditApplications).where(eq(creditApplications.id, appId)).limit(1);
  if (!a) throw new HttpError(404, 'Pembiayaan tidak ditemukan');
  if (actor.branch?.type === 'branch' && actor.branch.id !== a.branchId) throw new HttpError(403, 'Pembiayaan bukan milik cabang Anda');
  if (a.status !== 'active') throw new HttpError(409, 'Pembiayaan tidak aktif');
  if (await openIqalah(db, a.id)) throw new HttpError(409, 'Pembiayaan sedang dalam proses iqalah (pembatalan akad) — pembayaran angsuran dihentikan');
  if (p.method === 'transfer' && !p.proofRef) throw new HttpError(400, 'Isi nomor referensi transfer');
  return db.transaction(async (tx) => {
    const pos = await creditPosition(a.id, tx);
    let amount = p.amount ?? 0, ibra = 0;
    if (p.settlement) { const q = await settlementQuote(a.id, tx); amount = q.payable; ibra = q.ibra; }
    if (!(amount > 0)) throw new HttpError(400, 'Nominal harus lebih dari 0');
    const shiftId = p.method === 'cash' ? await cashShiftFor(actor, tx) : null;
    const paymentNo = await nextPaymentNo(tx);
    const [pay] = await tx.insert(payments).values({
      paymentNo, kind: 'installment', refId: a.id, refNo: a.contractNo ?? a.appNo, branchId: a.branchId, amount, tazirAmount: p.payTazir ? pos.tazirDue : 0, ibraAmount: ibra,
      method: p.method, status: 'paid', channel: 'cashier', proofRef: p.proofRef ?? null, paidAt: new Date(), receivedBy: actor.id, shiftId,
      note: p.note ?? (p.settlement ? 'Pelunasan dipercepat' : null),
    }).returning();
    await allocateInstallments(tx, pay, actor);
    await notifyPaymentReceived(tx, pay);
    return pay;
  });
}

/** Nasabah membuat VA / QRIS untuk membayar angsuran (dari halaman cek status). */
export async function createInstallmentCharge(appId: string, amountIn: number, method: 'va' | 'qris' | 'fpx', customerName: string, opts: { includeTazir?: boolean; settlement?: boolean; bank?: VaBank | null; phone?: string | null } = {}) {
  const [a] = await db.select().from(creditApplications).where(eq(creditApplications.id, appId)).limit(1);
  if (!a || a.status !== 'active') throw new HttpError(409, 'Pembiayaan tidak aktif');
  if (await openIqalah(db, a.id)) throw new HttpError(409, 'Pembiayaan sedang dalam proses iqalah (pembatalan akad) — pembayaran angsuran dihentikan');
  const pos = await creditPosition(a.id);
  let amount = amountIn, ibra = 0;
  if (opts.settlement) { const q = await settlementQuote(a.id); amount = q.payable; ibra = q.ibra; }
  // Total tagihan online yang masih berjalan tidak boleh melebihi sisa kewajiban (VA lama tetap bisa dibayar di bank)
  const { rows: [pend] } = await db.execute<{ v: string | null }>(sql`select sum(amount + ibra_amount) v from payments where kind = 'installment' and ref_id = ${a.id} and status = 'pending'`);
  const pending = round(Number(pend?.v ?? 0));
  const allowed = round(pos.outstanding - pending);
  if (pending > 0 && amount - allowed > 0.009) throw new HttpError(409, `Masih ada tagihan ${pending.toLocaleString('id-ID')} yang belum dibayar. Bayar tagihan tersebut, atau tunggu hingga kedaluwarsa.`);
  if (amount <= 0 || amount - pos.outstanding > 0.009) throw new HttpError(400, `Nominal harus antara 1 dan ${pos.outstanding.toLocaleString('id-ID')}`);
  const tazir = opts.includeTazir ? pos.tazirDue : 0;
  const paymentNo = await nextPaymentNo(db);
  // VA berisi angsuran + ta'zir; pembagiannya dicatat terpisah (ta'zir -> dana sosial)
  const cc = await branchCountry(a.branchId);
  const charge = await getPaymentGateway(cc).createCharge({ paymentNo, amount: round(amount + tazir), method, bank: opts.bank, customerName, customerPhone: opts.phone ? e164(opts.phone, cc) : null, currency: a.currency, returnUrl: links.credit(a.appNo) });
  const [pay] = await db.insert(payments).values({
    paymentNo, kind: 'installment', refId: a.id, refNo: a.contractNo ?? a.appNo, branchId: a.branchId, amount, tazirAmount: tazir, ibraAmount: ibra, method, status: 'pending', channel: 'gateway',
    vaNumber: charge.vaNumber, bank: charge.bank, qrString: charge.qrString, qrUrl: charge.qrUrl, payUrl: charge.payUrl ?? null, gatewayRef: charge.gatewayRef, expiresAt: charge.expiresAt, note: opts.settlement ? 'Pelunasan dipercepat' : null,
  }).returning();
  return pay;
}

/** Ada iqalah yang sudah disetujui (menunggu barang kembali) untuk akad ini? */
async function openIqalah(tx: Tx | typeof db, appId: string) {
  const { rows } = await tx.execute(sql`select 1 from iqalah_requests where application_id = ${appId} and status = 'approved' limit 1`);
  return rows.length > 0;
}

/** Hook dipanggil di dalam transaksi pembayaran. Kembalikan false bila pembayaran tidak dapat diterapkan (sudah lunas / dibatalkan). */
export type OrderPaidHook = (tx: Tx, p: Payment, actor: AuthUser | null) => Promise<boolean | void>;

/** Tandai pembayaran yang perlu ditindaklanjuti manual (mis. dana masuk tetapi order sudah ditutup) & kabari Bookkeeping + Manager Cabang. */
export async function flagPayment(tx: Tx | typeof db, p: Payment, reason: string) {
  await tx.update(payments).set({ note: `PERLU DICEK: ${reason}` }).where(eq(payments.id, p.id));
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'),
    sql`(${users.roleCode} = 'finance' or (${users.roleCode} = 'branch-manager' and ${users.branchId} = ${p.branchId}))`));
  if (rows.length) await tx.insert(notifications).values(rows.map((r) => ({ userId: r.id, title: `Pembayaran ${p.paymentNo} perlu dicek`, body: reason })));
}
let orderPaid: OrderPaidHook | null = null;
export const onOrderPaid = (fn: OrderPaidHook) => { orderPaid = fn; };
let dpPaid: OrderPaidHook | null = null;
/** Uang muka akad lunas (kasir / gateway) -> akad berlaku, pengiriman dibuat. Didaftarkan oleh lib/credit.ts. */
export const onDownPaymentPaid = (fn: OrderPaidHook) => { dpPaid = fn; };

/** Konfirmasi pembayaran gateway (webhook / simulasi dev) atau verifikasi kasir. */
export async function confirmPayment(paymentNo: string, actor: AuthUser | null, gatewayRef?: string, outerTx?: Tx) {
  const [p] = await (outerTx ?? db).select().from(payments).where(eq(payments.paymentNo, paymentNo)).limit(1);
  if (!p) throw new HttpError(404, 'Pembayaran tidak ditemukan');
  if (p.status === 'paid') return p; // idempoten untuk webhook berulang
  if (p.status !== 'pending') throw new HttpError(409, `Pembayaran berstatus ${p.status}`);
  if (p.expiresAt && p.expiresAt < new Date()) throw new HttpError(409, 'Pembayaran sudah kedaluwarsa');
  const run = (fn: (tx: Tx) => Promise<Payment>) => (outerTx ? fn(outerTx) : db.transaction(fn));
  return run(async (tx) => {
    const [after] = await tx.update(payments).set({ status: 'paid', paidAt: new Date(), receivedBy: actor?.id ?? null, gatewayRef: gatewayRef ?? p.gatewayRef })
      .where(and(eq(payments.id, p.id), eq(payments.status, 'pending'))).returning();
    if (!after) {
      // Kalah balapan dengan pembatalan (mis. kasir menerima tunai saat VA dibayar): dana mungkin sudah masuk
      const [cur] = await tx.select().from(payments).where(eq(payments.id, p.id)).limit(1);
      if (cur && (cur.status === 'cancelled' || cur.status === 'expired') && actor === null) await flagPayment(tx, cur, `dana masuk di gateway setelah tagihan ${cur.status} — proses pengembalian dana / alokasi ulang`);
      return cur ?? p;
    }
    if (after.kind === 'installment') {
      const [app] = await tx.select({ status: creditApplications.status }).from(creditApplications).where(eq(creditApplications.id, after.refId)).for('update').limit(1);
      if (!app || app.status !== 'active' || (await openIqalah(tx, after.refId))) {
        await flagPayment(tx, after, `angsuran ${after.refNo} dibayar tetapi pembiayaan tidak lagi aktif / dalam proses iqalah — kembalikan dana nasabah`);
        return after;
      }
      const pos0 = await creditPosition(after.refId, tx);
      if (after.amount + (after.ibraAmount ?? 0) - pos0.outstanding > 0.009 && !(after.ibraAmount > 0)) {
        await flagPayment(tx, after, `angsuran ${after.refNo} ${after.amount.toLocaleString('id-ID')} melebihi sisa kewajiban ${pos0.outstanding.toLocaleString('id-ID')} — alokasikan / kembalikan kelebihan`);
        return after;
      }
      let toAllocate = after;
      if (after.ibraAmount > 0) {
        // Kutipan pelunasan dihitung saat VA dibuat; bila posisi berubah, bayar sebagai angsuran biasa tanpa ibra'
        const pos = await creditPosition(after.refId, tx);
        if (Math.abs(after.amount + after.ibraAmount - pos.outstanding) > 0.009) {
          [toAllocate] = await tx.update(payments).set({ ibraAmount: 0, note: "Kutipan pelunasan kedaluwarsa — dibukukan sebagai angsuran biasa" }).where(eq(payments.id, after.id)).returning();
        }
      }
      await allocateInstallments(tx, toAllocate, actor);
    }
    if (after.kind === 'order' && (await orderPaid?.(tx, after, actor)) === false) await flagPayment(tx, after, `pembayaran order ${after.refNo} diterima tetapi order sudah tidak menunggu pembayaran — proses pengembalian dana`);
    if (after.kind === 'down_payment' && (await dpPaid?.(tx, after, actor)) === false) await flagPayment(tx, after, `uang muka ${after.refNo} diterima tetapi akad sudah dibayar / dibatalkan — proses pengembalian dana`);
    await notifyPaymentReceived(tx, after);
    return after;
  });
}

/** Kedaluwarsakan tagihan gateway yang lewat batas. */
export async function expireStalePayments() {
  const r = await db.update(payments).set({ status: 'expired' })
    .where(and(eq(payments.status, 'pending'), lt(payments.expiresAt, sql`now()`))).returning({ id: payments.id });
  return r.length;
}

export const usersOfRole = (role: string, branchId: string) =>
  db.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), eq(users.roleCode, role), eq(users.branchId, branchId)));


/** Notifikasi gateway (webhook) yang sudah diverifikasi -> perbarui status pembayaran. */
export async function handleGatewayNotification(n: GatewayNotification) {
  const [p] = await db.select().from(payments).where(eq(payments.paymentNo, n.paymentNo)).limit(1);
  if (!p) return { ok: false, reason: 'unknown_payment' };
  if (n.status === 'paid') {
    const expected = round(p.amount + p.tazirAmount);
    if (Math.abs(n.amount - expected) > 0.5) {
      console.error(`[gateway] nominal ${n.paymentNo} tidak cocok: gateway ${n.amount}, sistem ${expected}`);
      await db.update(payments).set({ note: `PERLU DICEK: nominal gateway ${n.amount} ≠ tagihan ${expected}` }).where(eq(payments.id, p.id));
      return { ok: false, reason: 'amount_mismatch' };
    }
    if (p.status === 'expired' || p.status === 'cancelled') {
      // Dana masuk setelah tagihan ditutup: catat untuk ditindaklanjuti manual (refund / alokasi ulang)
      await db.update(payments).set({ note: `PERLU DICEK: dibayar di gateway setelah status ${p.status}` }).where(eq(payments.id, p.id));
      return { ok: false, reason: 'late_payment' };
    }
    // Batas waktu internal tidak berlaku bila gateway sudah menyatakan lunas
    if (p.expiresAt && p.expiresAt < new Date()) await db.update(payments).set({ expiresAt: null }).where(eq(payments.id, p.id));
    await confirmPayment(p.paymentNo, null, n.gatewayRef);
    return { ok: true };
  }
  if (p.status === 'pending' && (n.status === 'expired' || n.status === 'failed')) {
    await db.update(payments).set({ status: n.status }).where(and(eq(payments.id, p.id), eq(payments.status, 'pending')));
  }
  return { ok: true };
}

/** Kabari nasabah bahwa pembayaran diterima (dipanggil di dalam transaksi pembayaran). */
export async function notifyPaymentReceived(tx: Tx, p: Payment) {
  if (p.kind === 'order') {
    const [o] = await tx.select().from(orders).where(eq(orders.id, p.refId)).limit(1);
    if (!o) return;
    const c = await customerContact(tx, o.customerId);
    await notifyCustomer(tx, { phone: o.recipientPhone, email: c.email, lang: c.lang }, 'payment_received', {
      name: o.recipientName, amount: money(p.amount, o.currency), purposeKind: 'order', purposeRef: o.orderNo, paymentNo: p.paymentNo, link: links.order(o.orderNo),
      extraKey: 'order_preparing',
    }, { type: 'payment', id: p.id, dedupe: `paid:${p.id}` });
    return;
  }
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, p.refId)).limit(1);
  if (!a) return;
  const c = await customerContact(tx, a.customerId);
  const pos = p.kind === 'installment' ? await creditPosition(a.id, tx) : null;
  await notifyCustomer(tx, c, 'payment_received', {
    name: c.name, amount: money(p.amount + p.tazirAmount, a.currency), paymentNo: p.paymentNo, link: links.credit(a.appNo),
    purposeKind: p.kind === 'down_payment' ? 'down_payment' : p.ibraAmount ? 'settlement' : 'installment', purposeRef: a.contractNo ?? a.appNo,
    extraKey: pos && pos.outstanding > 0 ? 'outstanding' : null, outstanding: pos ? money(pos.outstanding, a.currency) : null,
  }, { type: 'payment', id: p.id, dedupe: `paid:${p.id}` });
}
