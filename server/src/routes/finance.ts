import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branchExpenses, branches, cashierShifts, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import { getConfig } from '../lib/config.js';
import { branchCountry } from '../lib/region.js';
import {
  EXPENSE_CATEGORIES, SHIFT_ROLES, cancelExpense, closeShift, createExpense, decideExpense, expenseScope, monthUsage, openShift, openShiftOf,
  payExpense, recentShifts, shiftSummary, verifyShift,
} from '../lib/finance.js';
import { receiptDoc, voucherDoc } from '../lib/receipts.js';
import { settlementQuote, waiveTazir } from '../lib/payments.js';

/** Shift kasir, biaya operasional cabang, ta'zir, pelunasan, dokumen cetak. */
export const financeRouter = Router();

const money = (label: string) => z.number(`${label} harus angka`).min(0, `${label} tidak boleh negatif`);
const idParam = (v: unknown) => z.uuid().parse(v);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// ---------------------------------------------------------------------------
// Shift kasir
// ---------------------------------------------------------------------------
financeRouter.get('/shifts/current', requireRole(...SHIFT_ROLES), async (req, res) => {
  const s = await openShiftOf(req.user!.id);
  res.json({ shift: s, summary: s ? await shiftSummary(s) : null });
});

financeRouter.post('/shifts/open', requireRole(...SHIFT_ROLES), async (req, res) => {
  const { openingCash } = parseBody(z.object({ openingCash: money('Saldo awal') }), req.body);
  res.status(201).json({ shift: await openShift(req.user!, openingCash) });
});

financeRouter.post('/shifts/:id/close', requireRole(...SHIFT_ROLES), async (req, res) => {
  const b = parseBody(z.object({ countedCash: money('Kas fisik'), depositAmount: money('Setoran'), depositRef: z.string().trim().max(64).nullish(), note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ shift: await closeShift(req.user!, idParam(req.params.id), b) });
});

const shiftScope = (u: AuthUser): SQL | undefined =>
  SHIFT_ROLES.includes(u.roleCode) ? eq(cashierShifts.userId, u.id) : ['biz-mgr', 'finance'].includes(u.roleCode) ? undefined : u.branch ? eq(cashierShifts.branchId, u.branch.id) : sql`false`;

financeRouter.get('/shifts', requireRole(...SHIFT_ROLES, 'branch-manager', 'biz-mgr', 'finance'), async (req, res) => {
  const q = parseBody(z.object({ status: z.enum(['open', 'closed', 'verified']).optional() }), req.query);
  const where: SQL[] = [];
  const sc = shiftScope(req.user!);
  if (sc) where.push(sc);
  if (q.status) where.push(eq(cashierShifts.status, q.status));
  const rows = await recentShifts(where.length ? and(...where) : undefined, 60);
  res.json({ shifts: rows.map(({ s, userName }) => ({ ...s, userName })) });
});

financeRouter.get('/shifts/:id', requireRole(...SHIFT_ROLES, 'branch-manager', 'biz-mgr', 'finance'), async (req, res) => {
  const sc = shiftScope(req.user!);
  const [row] = await db.select({ s: cashierShifts, userName: users.fullName }).from(cashierShifts).innerJoin(users, eq(users.id, cashierShifts.userId))
    .where(sc ? and(eq(cashierShifts.id, idParam(req.params.id)), sc) : eq(cashierShifts.id, idParam(req.params.id))).limit(1);
  if (!row) throw new HttpError(404, 'Shift tidak ditemukan');
  res.json({ shift: { ...row.s, userName: row.userName }, summary: await shiftSummary(row.s) });
});

financeRouter.post('/shifts/:id/verify', requireRole('branch-manager', 'biz-mgr'), async (req, res) => {
  const { note } = parseBody(z.object({ note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ shift: await verifyShift(req.user!, idParam(req.params.id), note ?? null) });
});

// ---------------------------------------------------------------------------
// Biaya operasional cabang
// ---------------------------------------------------------------------------
const EXP_ROLES = requireRole('branch-admin', 'branch-manager', 'cashier', 'biz-mgr', 'finance');
const submitter = aliasedTable(users, 'submitter_u');

financeRouter.get('/expenses/meta', EXP_ROLES, async (req, res) => {
  const u = req.user!;
  const cc = await branchCountry(u.branch?.id);
  const [limit, budget] = await Promise.all([getConfig<number>('finance.expense_mc_limit', cc), getConfig<number>('finance.expense_monthly_budget', cc)]);
  res.json({ categories: EXPENSE_CATEGORIES, mcLimit: Number(limit), monthlyBudget: Number(budget),
    monthUsed: u.branch?.type === 'branch' ? await monthUsage(u.branch.id, thisMonth()) : null });
});

financeRouter.get('/expenses', EXP_ROLES, async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), branchId: z.uuid().optional() }), req.query);
  const where: SQL[] = [];
  const sc = expenseScope(req.user!);
  if (sc) where.push(sc);
  if (q.status) where.push(inArray(branchExpenses.status, q.status.split(',')));
  if (q.month) where.push(sql`substr(${branchExpenses.expenseDate}, 1, 7) = ${q.month}`);
  if (q.branchId) where.push(eq(branchExpenses.branchId, q.branchId));
  const rows = await db.select({ e: branchExpenses, branchName: branches.name, submitterName: submitter.fullName, approverName: sql<string | null>`(select u.full_name from users u where u.id = ${branchExpenses.mcBy})` })
    .from(branchExpenses).innerJoin(branches, eq(branches.id, branchExpenses.branchId)).innerJoin(submitter, eq(submitter.id, branchExpenses.submittedBy))
    .where(where.length ? and(...where) : undefined).orderBy(desc(branchExpenses.createdAt)).limit(200);
  res.json({ expenses: rows.map(({ e, ...x }) => ({ ...e, ...x })) });
});

financeRouter.post('/expenses', requireRole('branch-admin'), async (req, res) => {
  const b = parseBody(z.object({
    category: z.string().min(1, 'Pilih kategori'), description: z.string().trim().min(5, 'Keterangan minimal 5 karakter').max(300),
    vendor: z.string().trim().max(120).nullish(), amount: z.number().positive('Nominal harus lebih dari 0'),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid'), method: z.enum(['cash', 'transfer']), receiptRef: z.string().trim().max(64).nullish(),
  }), req.body);
  res.status(201).json(await createExpense(req.user!, b));
});

financeRouter.post('/expenses/:id/decide', requireRole('branch-manager', 'biz-mgr'), async (req, res) => {
  const b = parseBody(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ expense: await decideExpense(req.user!, idParam(req.params.id), b.decision, b.note ?? null) });
});

financeRouter.post('/expenses/:id/pay', requireRole(...SHIFT_ROLES), async (req, res) => {
  const { paidRef } = parseBody(z.object({ paidRef: z.string().trim().max(64).nullish() }), req.body);
  res.json({ expense: await payExpense(req.user!, idParam(req.params.id), paidRef ?? null) });
});

financeRouter.post('/expenses/:id/cancel', requireRole('branch-admin'), async (req, res) => {
  res.json({ expense: await cancelExpense(req.user!, idParam(req.params.id)) });
});

/** Laporan biaya per cabang & kategori (bulan). */
financeRouter.get('/expenses/report', requireRole('branch-manager', 'branch-admin', 'biz-mgr', 'finance'), async (req, res) => {
  const { month } = parseBody(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(thisMonth()) }), req.query);
  const sc = expenseScope(req.user!);
  const rows = await db.select({
    branchId: branchExpenses.branchId, branchName: branches.name, category: branchExpenses.category,
    paid: sql<number>`coalesce(sum(${branchExpenses.amount}) filter (where ${branchExpenses.status} = 'paid'), 0)::float`,
    committed: sql<number>`coalesce(sum(${branchExpenses.amount}) filter (where ${branchExpenses.status} in ('submitted','hq_review','approved')), 0)::float`,
    count: sql<number>`count(*) filter (where ${branchExpenses.status} not in ('rejected','cancelled'))::int`,
  }).from(branchExpenses).innerJoin(branches, eq(branches.id, branchExpenses.branchId))
    .where(and(sql`substr(${branchExpenses.expenseDate}, 1, 7) = ${month}`, sc)).groupBy(branchExpenses.branchId, branches.name, branchExpenses.category);
  const budget = Number(await getConfig<number>('finance.expense_monthly_budget'));
  const byBranch: Record<string, { branchId: string; branchName: string; paid: number; committed: number; count: number; byCategory: Record<string, number> }> = {};
  for (const r of rows) {
    const b = (byBranch[r.branchId] ??= { branchId: r.branchId, branchName: r.branchName, paid: 0, committed: 0, count: 0, byCategory: {} });
    b.paid += r.paid; b.committed += r.committed; b.count += r.count; b.byCategory[r.category] = (b.byCategory[r.category] ?? 0) + r.paid + r.committed;
  }
  res.json({ month, budget, categories: EXPENSE_CATEGORIES, branches: Object.values(byBranch) });
});

// ---------------------------------------------------------------------------
// Ta'zir & pelunasan dipercepat
// ---------------------------------------------------------------------------
financeRouter.post('/tazir/:id/waive', requireRole('branch-manager', 'biz-mgr'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter') }), req.body);
  res.json({ charge: await waiveTazir(req.user!, idParam(req.params.id), reason) });
});

financeRouter.get('/credits/:id/settlement', requireRole('cashier', 'branch-admin', 'branch-manager', 'ao', 'biz-mgr'), async (req, res) => {
  const id = idParam(req.params.id);
  const { loadAppInBranchScope } = await import('../lib/credit.js');
  await loadAppInBranchScope(req.user!, id);
  res.json({ quote: await settlementQuote(id) });
});

// ---------------------------------------------------------------------------
// Dokumen cetak
// ---------------------------------------------------------------------------
financeRouter.get('/receipts/:paymentNo', requireRole('cashier', 'branch-admin', 'branch-manager', 'ao', 'biz-mgr', 'finance', 'support'), async (req, res) => {
  res.json({ doc: await receiptDoc(z.string().min(5).parse(req.params.paymentNo), { actor: req.user! }) });
});

financeRouter.get('/vouchers/:type/:id', requireRole('branch-admin', 'cashier', 'branch-manager', 'biz-mgr', 'finance'), async (req, res) => {
  const type = z.enum(['expense', 'refund']).parse(req.params.type);
  res.json({ doc: await voucherDoc(type, idParam(req.params.id), req.user!) });
});
