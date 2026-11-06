import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branchExpenses, cashierShifts, notifications, payments, refunds, users, type BranchExpense, type CashierShift } from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import type { Tx } from './stock.js';
import type { AuthUser } from '../middleware/auth.js';
import { branchCountry } from './region.js';

type Db = Tx | typeof db;
const round = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString('id-ID');

/** Nomor dokumen keuangan: EXP (biaya), RFD (refund), RTR (retur), SHF (shift). */
export async function financeNo(tx: Db, prefix: 'EXP' | 'RFD' | 'RTR' | 'SHF') {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('finance_doc_seq')::text as seq`);
  const d = new Date();
  return `${prefix}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
}

export async function notifyRole(tx: Db, role: string, branchId: string | null, title: string, body: string, exceptId?: string) {
  const where = branchId ? and(eq(users.roleCode, role), eq(users.branchId, branchId), eq(users.status, 'active')) : and(eq(users.roleCode, role), eq(users.status, 'active'));
  const ids = (await tx.select({ id: users.id }).from(users).where(where)).map((r) => r.id).filter((id) => id !== exceptId);
  if (ids.length) await tx.insert(notifications).values(ids.map((userId) => ({ userId, title, body })));
}

const sameBranch = (u: AuthUser, branchId: string) => u.branch?.id === branchId;

// ===========================================================================
// SHIFT KASIR
// ===========================================================================
export const SHIFT_ROLES = ['cashier', 'branch-admin'];

export async function openShiftOf(userId: string, tx: Db = db) {
  const [s] = await tx.select().from(cashierShifts).where(and(eq(cashierShifts.userId, userId), eq(cashierShifts.status, 'open'))).limit(1);
  return s ?? null;
}

/** Transaksi tunai: kembalikan shift aktif petugas (wajib bila parameter mewajibkan). */
export async function cashShiftFor(actor: AuthUser, tx: Db = db): Promise<string | null> {
  // FOR SHARE: penutupan shift menunggu transaksi tunai yang sedang berjalan (tidak ada kas yang terlewat dari rekap)
  const [s] = await tx.select().from(cashierShifts).where(and(eq(cashierShifts.userId, actor.id), eq(cashierShifts.status, 'open'))).for('share').limit(1);
  if (s) return s.id;
  if (await getConfig<boolean>('finance.require_cashier_shift', await branchCountry(actor.branch?.id))) throw new HttpError(409, 'Buka shift kasir terlebih dahulu (menu "Shift & Setoran") sebelum mencatat transaksi tunai');
  return null;
}

export async function openShift(actor: AuthUser, openingCash: number) {
  if (!SHIFT_ROLES.includes(actor.roleCode) || !actor.branch) throw new HttpError(403, 'Shift kas hanya untuk Kasir / Admin Cabang');
  if (await openShiftOf(actor.id)) throw new HttpError(409, 'Anda masih memiliki shift yang belum ditutup');
  return db.transaction(async (tx) => {
    const shiftNo = await financeNo(tx, 'SHF');
    const [s] = await tx.insert(cashierShifts).values({ shiftNo, branchId: actor.branch!.id, userId: actor.id, openingCash }).returning();
    return s;
  });
}

/** Ringkasan kas tunai sebuah shift: penerimaan (termasuk ta'zir) & pengeluaran (biaya, refund). */
export async function shiftSummary(s: CashierShift, tx: Db = db) {
  // Berurutan (bukan Promise.all): tx bisa berupa satu koneksi transaksi — kueri paralel di satu klien pg tidak didukung.
  const ins = await tx.select({ id: payments.id, no: payments.paymentNo, kind: payments.kind, refNo: payments.refNo, amount: payments.amount, tazir: payments.tazirAmount, at: payments.paidAt })
      .from(payments).where(and(eq(payments.shiftId, s.id), eq(payments.status, 'paid'), eq(payments.method, 'cash'))).orderBy(payments.paidAt);
  const exp = await tx.select({ id: branchExpenses.id, no: branchExpenses.expenseNo, description: branchExpenses.description, amount: branchExpenses.amount, at: branchExpenses.paidAt })
      .from(branchExpenses).where(and(eq(branchExpenses.shiftId, s.id), eq(branchExpenses.status, 'paid'), eq(branchExpenses.method, 'cash')));
  const rfd = await tx.select({ id: refunds.id, no: refunds.refundNo, sourceNo: refunds.sourceNo, amount: refunds.amount, at: refunds.paidAt })
      .from(refunds).where(and(eq(refunds.shiftId, s.id), eq(refunds.status, 'paid'), eq(refunds.method, 'cash')));
  const cashIn = round(ins.reduce((t, r) => t + r.amount + r.tazir, 0));
  const cashOut = round(exp.reduce((t, r) => t + r.amount, 0) + rfd.reduce((t, r) => t + r.amount, 0));
  const movements = [
    ...ins.map((r) => ({ type: 'in' as const, no: r.no, label: `${r.kind === 'installment' ? 'Angsuran' : r.kind === 'down_payment' ? 'Uang muka' : 'Order'} ${r.refNo}${r.tazir ? ` (+ ta'zir ${fmt(r.tazir)})` : ''}`, amount: round(r.amount + r.tazir), at: r.at })),
    ...exp.map((r) => ({ type: 'out' as const, no: r.no, label: `Biaya: ${r.description}`, amount: r.amount, at: r.at })),
    ...rfd.map((r) => ({ type: 'out' as const, no: r.no, label: `Refund ${r.sourceNo}`, amount: r.amount, at: r.at })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { cashIn, cashOut, expectedCash: round(s.openingCash + cashIn - cashOut), movements };
}

export async function closeShift(actor: AuthUser, id: string, p: { countedCash: number; depositAmount: number; depositRef?: string | null; note?: string | null }) {
  const [s] = await db.select().from(cashierShifts).where(eq(cashierShifts.id, id)).limit(1);
  if (!s || s.userId !== actor.id) throw new HttpError(404, 'Shift tidak ditemukan');
  if (s.status !== 'open') throw new HttpError(409, 'Shift sudah ditutup');
  if (p.depositAmount > p.countedCash + 0.009) throw new HttpError(400, 'Setoran bank tidak boleh melebihi kas fisik');
  if (p.depositAmount > 0 && !p.depositRef?.trim()) throw new HttpError(400, 'Isi nomor bukti setoran bank');
  const tol = Number(await getConfig<number>('finance.cash_variance_tolerance', await branchCountry(s.branchId))) || 0;
  return db.transaction(async (tx) => {
    // Kunci shift lalu hitung rekap di dalam transaksi yang sama
    const [cur] = await tx.select().from(cashierShifts).where(eq(cashierShifts.id, s.id)).for('update').limit(1);
    if (!cur || cur.status !== 'open') throw new HttpError(409, 'Shift sudah ditutup');
    const sum = await shiftSummary(cur, tx);
    const variance = round(p.countedCash - sum.expectedCash);
    if (Math.abs(variance) > tol && !p.note?.trim()) throw new HttpError(400, `Selisih kas ${fmt(variance)} melebihi toleransi ${fmt(tol)} — wajib isi penjelasan`);
    const [after] = await tx.update(cashierShifts).set({
      status: 'closed', closedAt: new Date(), cashIn: sum.cashIn, cashOut: sum.cashOut, expectedCash: sum.expectedCash, countedCash: p.countedCash,
      variance, depositAmount: p.depositAmount, depositRef: p.depositRef ?? null, closingNote: p.note ?? null,
    }).where(and(eq(cashierShifts.id, s.id), eq(cashierShifts.status, 'open'))).returning();
    await notifyRole(tx, 'branch-manager', s.branchId, `Shift ${s.shiftNo} ditutup ${actor.fullName}`,
      `Kas sistem ${fmt(sum.expectedCash)}, fisik ${fmt(p.countedCash)}, selisih ${fmt(variance)}, setor bank ${fmt(p.depositAmount)}`);
    return after;
  });
}

export async function verifyShift(actor: AuthUser, id: string, note: string | null) {
  const [s] = await db.select().from(cashierShifts).where(eq(cashierShifts.id, id)).limit(1);
  if (!s) throw new HttpError(404, 'Shift tidak ditemukan');
  if (!((actor.roleCode === 'branch-manager' && sameBranch(actor, s.branchId)) || actor.roleCode === 'biz-mgr')) throw new HttpError(403, 'Verifikasi oleh Manager Cabang');
  if (s.status !== 'closed') throw new HttpError(409, 'Hanya shift yang sudah ditutup yang dapat diverifikasi');
  const [after] = await db.update(cashierShifts).set({ status: 'verified', verifiedBy: actor.id, verifiedAt: new Date(), verifyNote: note }).where(eq(cashierShifts.id, s.id)).returning();
  return after;
}

// ===========================================================================
// BIAYA OPERASIONAL CABANG
// ===========================================================================
export const EXPENSE_CATEGORIES: Record<string, string> = {
  transport: 'Transportasi & BBM', utilities: 'Listrik, Air & Internet', rent: 'Sewa', office: 'ATK & Perlengkapan',
  maintenance: 'Perawatan Gedung / Kendaraan', meals: 'Konsumsi & Jamuan', courier: 'Kurir & Ongkir Tambahan',
  casual_labor: 'Tenaga Harian / Bongkar Muat', marketing: 'Promosi Lokal', other: 'Lain-lain',
};
const OPEN_EXPENSE = ['submitted', 'hq_review', 'approved', 'paid'] as const;

async function loadExpense(id: string) {
  const [e] = await db.select().from(branchExpenses).where(eq(branchExpenses.id, id)).limit(1);
  if (!e) throw new HttpError(404, 'Biaya tidak ditemukan');
  return e;
}

export function expenseScope(u: AuthUser): SQL | undefined {
  if (['biz-mgr', 'finance', 'super-admin'].includes(u.roleCode)) return undefined;
  return u.branch ? eq(branchExpenses.branchId, u.branch.id) : sql`false`;
}

/** Realisasi + pengajuan berjalan bulan berjalan (untuk peringatan anggaran). */
export async function monthUsage(branchId: string, month: string, tx: Db = db) {
  const [r] = await tx.select({ total: sql<number>`coalesce(sum(${branchExpenses.amount}), 0)::float` }).from(branchExpenses)
    .where(and(eq(branchExpenses.branchId, branchId), inArray(branchExpenses.status, [...OPEN_EXPENSE]), sql`substr(${branchExpenses.expenseDate}, 1, 7) = ${month}`));
  return Number(r.total);
}

export async function createExpense(actor: AuthUser, p: { category: string; description: string; vendor?: string | null; amount: number; expenseDate: string; method: 'cash' | 'transfer'; receiptRef?: string | null }) {
  if (actor.roleCode !== 'branch-admin' || actor.branch?.type !== 'branch') throw new HttpError(403, 'Biaya operasional diajukan Admin Cabang');
  if (!EXPENSE_CATEGORIES[p.category]) throw new HttpError(400, 'Kategori biaya tidak dikenal');
  const cc = await branchCountry(actor.branch.id);
  const [limit, budget] = await Promise.all([getConfig<number>('finance.expense_mc_limit', cc), getConfig<number>('finance.expense_monthly_budget', cc)]);
  const used = await monthUsage(actor.branch.id, p.expenseDate.slice(0, 7));
  return db.transaction(async (tx) => {
    const expenseNo = await financeNo(tx, 'EXP');
    const [e] = await tx.insert(branchExpenses).values({
      expenseNo, branchId: actor.branch!.id, category: p.category, description: p.description, vendor: p.vendor ?? null, amount: p.amount,
      expenseDate: p.expenseDate, method: p.method, receiptRef: p.receiptRef ?? null, requiresHq: p.amount > Number(limit), submittedBy: actor.id,
    }).returning();
    await notifyRole(tx, 'branch-manager', e.branchId, `Pengajuan biaya ${expenseNo}`, `${EXPENSE_CATEGORIES[p.category]} · ${p.description} · ${fmt(p.amount)}`);
    return { expense: e, overBudget: Number(budget) > 0 && used + p.amount > Number(budget), monthUsed: used + p.amount, budget: Number(budget) };
  });
}

export async function decideExpense(actor: AuthUser, id: string, decision: 'approve' | 'reject', note: string | null) {
  const e = await loadExpense(id);
  if (decision === 'reject' && !note?.trim()) throw new HttpError(400, 'Isi alasan penolakan');
  const now = new Date();
  let patch: Partial<BranchExpense>;
  if (actor.roleCode === 'branch-manager' && sameBranch(actor, e.branchId)) {
    if (e.status !== 'submitted') throw new HttpError(409, 'Biaya sudah diproses');
    patch = { mcBy: actor.id, mcAt: now, decisionNote: note, status: decision === 'reject' ? 'rejected' : e.requiresHq ? 'hq_review' : 'approved' };
  } else if (actor.roleCode === 'biz-mgr') {
    if (e.status !== 'hq_review') throw new HttpError(409, 'Biaya ini tidak menunggu persetujuan Pusat');
    patch = { hqBy: actor.id, hqAt: now, decisionNote: note, status: decision === 'reject' ? 'rejected' : 'approved' };
  } else throw new HttpError(403, 'Persetujuan oleh Manager Cabang / Business Manager');
  return db.transaction(async (tx) => {
    const [after] = await tx.update(branchExpenses).set({ ...patch, updatedAt: now }).where(and(eq(branchExpenses.id, e.id), eq(branchExpenses.status, e.status))).returning();
    if (!after) throw new HttpError(409, 'Biaya sudah diproses');
    if (after.status === 'hq_review') await notifyRole(tx, 'biz-mgr', null, `Biaya ${e.expenseNo} perlu persetujuan Pusat`, `${e.description} · ${fmt(e.amount)}`);
    await tx.insert(notifications).values({ userId: e.submittedBy, title: `Biaya ${e.expenseNo}: ${after.status === 'approved' ? 'disetujui' : after.status === 'rejected' ? 'ditolak' : 'diteruskan ke Pusat'}`, body: note ?? e.description });
    return after;
  });
}

export async function payExpense(actor: AuthUser, id: string, paidRef: string | null) {
  const e = await loadExpense(id);
  if (!SHIFT_ROLES.includes(actor.roleCode) || !sameBranch(actor, e.branchId)) throw new HttpError(403, 'Pembayaran biaya oleh Kasir / Admin Cabang');
  if (e.status !== 'approved') throw new HttpError(409, 'Biaya belum disetujui atau sudah dibayar');
  if (e.method === 'transfer' && !paidRef?.trim()) throw new HttpError(400, 'Isi nomor referensi transfer');
  return db.transaction(async (tx) => {
    const shiftId = e.method === 'cash' ? await cashShiftFor(actor, tx) : null;
    const [after] = await tx.update(branchExpenses).set({ status: 'paid', paidBy: actor.id, paidAt: new Date(), paidRef, shiftId, updatedAt: new Date() })
      .where(and(eq(branchExpenses.id, e.id), eq(branchExpenses.status, 'approved'))).returning();
    if (!after) throw new HttpError(409, 'Biaya sudah dibayar');
    return after;
  });
}

export async function cancelExpense(actor: AuthUser, id: string) {
  const e = await loadExpense(id);
  if (e.submittedBy !== actor.id) throw new HttpError(403, 'Hanya pengaju yang dapat membatalkan');
  if (!['submitted', 'hq_review', 'approved'].includes(e.status)) throw new HttpError(409, 'Biaya tidak dapat dibatalkan');
  const [after] = await db.update(branchExpenses).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(branchExpenses.id, e.id), inArray(branchExpenses.status, ['submitted', 'hq_review', 'approved']))).returning();
  if (!after) throw new HttpError(409, 'Biaya sudah dibayar / diproses');
  return after;
}

export const recentShifts = (where: SQL | undefined, limit = 50) =>
  db.select({ s: cashierShifts, userName: users.fullName }).from(cashierShifts).innerJoin(users, eq(users.id, cashierShifts.userId))
    .where(where).orderBy(desc(cashierShifts.openedAt)).limit(limit);
