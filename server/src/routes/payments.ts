import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branchExpenses, branches, creditApplications, customers, orders, payments, products, refunds, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import { creditPosition, expireStalePayments, recordInstallmentPayment, settlementQuote } from '../lib/payments.js';
import { cancelOrder, expireStaleOrders, payOrderAtCashier } from '../lib/orders.js';
import { loadAppInBranchScope, payDownPaymentAtCashier } from '../lib/credit.js';


/** Kasir, order tunai, collection & portofolio. */
export const paymentsRouter = Router();

const branchScope = (u: AuthUser, col: typeof payments.branchId | typeof orders.branchId | typeof creditApplications.branchId): SQL | undefined =>
  u.branch?.type === 'branch' ? eq(col, u.branch.id) : undefined;

// ---------------------------------------------------------------------------
// Kasir: cari pembiayaan aktif & catat angsuran
// ---------------------------------------------------------------------------
const CASHIER = requireRole('cashier', 'branch-admin', 'branch-manager', 'biz-mgr', 'finance');

paymentsRouter.get('/cashier/credits', CASHIER, async (req, res) => {
  const { search } = parseBody(z.object({ search: z.string().trim().max(80).optional() }), req.query);
  const where: SQL[] = [eq(creditApplications.status, 'active')];
  const sc = branchScope(req.user!, creditApplications.branchId);
  if (sc) where.push(sc);
  if (search) { const s = `%${search}%`; where.push(or(ilike(creditApplications.contractNo, s), ilike(creditApplications.appNo, s), ilike(customers.fullName, s), ilike(customers.phone, s))!); }
  const rows = await db.select({ id: creditApplications.id, appNo: creditApplications.appNo, contractNo: creditApplications.contractNo, monthly: creditApplications.monthly,
    tenor: creditApplications.tenor, currency: creditApplications.currency, customerName: customers.fullName, phone: customers.phone, productName: products.name, branchName: branches.name })
    .from(creditApplications).innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
    .innerJoin(branches, eq(branches.id, creditApplications.branchId)).where(and(...where)).orderBy(asc(customers.fullName)).limit(30);
  const out = [];
  for (const r of rows) { const p = await creditPosition(r.id); out.push({ ...r, outstanding: p.outstanding, overdueAmount: p.overdueAmount, dpd: p.dpd, nextDue: p.next?.dueDate ?? null, nextAmount: p.next ? p.next.amount - p.next.paidAmount : 0, paidCount: p.paidCount }); }
  res.json({ credits: out });
});

paymentsRouter.get('/cashier/credits/:id', CASHIER, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  await loadAppInBranchScope(req.user!, id);
  const p = await creditPosition(id);
  const hist = await db.select().from(payments).where(and(eq(payments.kind, 'installment'), eq(payments.refId, id))).orderBy(desc(payments.createdAt)).limit(30);
  res.json({ position: p, tazirDue: p.tazirDue, settlement: await settlementQuote(id).catch(() => null), payments: hist });
});

paymentsRouter.post('/cashier/credits/:id/pay', requireRole('cashier'), async (req, res) => {
  const b = parseBody(z.object({ amount: z.number().positive('Nominal harus lebih dari 0').optional(), settlement: z.boolean().default(false), method: z.enum(['cash', 'transfer']), proofRef: z.string().trim().max(64).nullish(), payTazir: z.boolean().default(false), note: z.string().max(300).nullish() }), req.body);
  res.status(201).json({ payment: await recordInstallmentPayment(req.user!, z.uuid().parse(req.params.id), b) });
});

// ---------------------------------------------------------------------------
// Uang muka akad (dibayar setelah akad ditandatangani AO / Manager Cabang)
// ---------------------------------------------------------------------------
paymentsRouter.get('/cashier/down-payments', CASHIER, async (req, res) => {
  const { search } = parseBody(z.object({ search: z.string().trim().max(80).optional() }), req.query);
  const where: SQL[] = [eq(creditApplications.status, 'approved'), sql`${creditApplications.contractNo} is not null`, sql`${creditApplications.dpPaidAt} is null`];
  const sc = branchScope(req.user!, creditApplications.branchId);
  if (sc) where.push(sc);
  if (search) { const s = `%${search}%`; where.push(or(ilike(creditApplications.contractNo, s), ilike(creditApplications.appNo, s), ilike(customers.fullName, s), ilike(customers.phone, s))!); }
  const rows = await db.select({ id: creditApplications.id, appNo: creditApplications.appNo, contractNo: creditApplications.contractNo, currency: creditApplications.currency,
    downPayment: creditApplications.downPayment, shippingFee: creditApplications.shippingFee, signedAt: creditApplications.contractSignedAt,
    customerName: customers.fullName, phone: customers.phone, productName: products.name, branchName: branches.name,
    pendingNo: sql<string | null>`(select p.payment_no from payments p where p.kind = 'down_payment' and p.ref_id = ${creditApplications.id} and p.status = 'pending' order by p.created_at desc limit 1)`,
    pendingChannel: sql<string | null>`(select p.channel || ':' || p.method from payments p where p.kind = 'down_payment' and p.ref_id = ${creditApplications.id} and p.status = 'pending' order by p.created_at desc limit 1)` })
    .from(creditApplications).innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
    .innerJoin(branches, eq(branches.id, creditApplications.branchId)).where(and(...where)).orderBy(asc(creditApplications.contractSignedAt)).limit(50);
  res.json({ downPayments: rows.map((r) => ({ ...r, amount: Math.round(((r.downPayment ?? 0) + (r.shippingFee ?? 0)) * 100) / 100 })) });
});

paymentsRouter.post('/cashier/down-payments/:id/pay', requireRole('cashier'), async (req, res) => {
  const b = parseBody(z.object({ method: z.enum(['cash', 'transfer']), proofRef: z.string().trim().max(64).nullish() }), req.body);
  res.status(201).json({ payment: await payDownPaymentAtCashier(req.user!, z.uuid().parse(req.params.id), b) });
});

// ---------------------------------------------------------------------------
// Order tunai (kasir & admin cabang)
// ---------------------------------------------------------------------------
paymentsRouter.get('/orders', requireRole('cashier', 'branch-admin', 'branch-manager', 'warehouse', 'biz-mgr', 'support'), async (req, res) => {
  await expireStaleOrders();
  const q = parseBody(z.object({ statuses: z.string().optional(), search: z.string().trim().max(80).optional() }), req.query);
  const where: SQL[] = [];
  const u = req.user!;
  if (u.roleCode === 'warehouse') where.push(or(eq(orders.fulfillBranchId, u.branch!.id), sql`${orders.allocation} @> ${JSON.stringify([{ branchId: u.branch!.id }])}::jsonb`)!);
  else { const sc = branchScope(u, orders.branchId); if (sc) where.push(sc); }
  if (q.statuses) where.push(inArray(orders.status, q.statuses.split(',') as ('awaiting_payment' | 'paid' | 'fulfilling' | 'completed' | 'cancelled' | 'expired')[]));
  if (q.search) { const s = `%${q.search}%`; where.push(or(ilike(orders.orderNo, s), ilike(orders.recipientName, s), ilike(orders.recipientPhone, s))!); }
  const rows = await db.select({ o: orders, branchName: branches.name,
    items: sql<string>`(select string_agg(i.name || ' × ' || i.qty, ', ') from order_items i where i.order_id = "orders"."id")` })
    .from(orders).innerJoin(branches, eq(branches.id, orders.branchId)).where(where.length ? and(...where) : undefined).orderBy(desc(orders.createdAt)).limit(100);
  res.json({ orders: rows.map(({ o, branchName, items }) => ({ ...o, branchName, items })) });
});

paymentsRouter.post('/orders/:id/pay', requireRole('cashier'), async (req, res) => {
  const b = parseBody(z.object({ method: z.enum(['cash', 'transfer']), proofRef: z.string().trim().max(64).nullish() }), req.body);
  res.json({ payment: await payOrderAtCashier(req.user!, z.uuid().parse(req.params.id), b) });
});

paymentsRouter.post('/orders/:id/cancel', requireRole('cashier', 'branch-admin', 'branch-manager'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Isi alasan') }), req.body);
  res.json({ order: await cancelOrder(req.user!, z.uuid().parse(req.params.id), reason) });
});

// ---------------------------------------------------------------------------
// Laporan kas harian
// ---------------------------------------------------------------------------
const receiver = aliasedTable(users, 'receiver');
paymentsRouter.get('/payments', requireRole('cashier', 'branch-admin', 'branch-manager', 'biz-mgr', 'finance'), async (req, res) => {
  await expireStalePayments();
  const q = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), status: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const sc = branchScope(req.user!, payments.branchId);
  if (sc) where.push(sc);
  if (q.status) where.push(sql`${payments.status} = ${q.status}`);
  if (q.date) where.push(sql`(coalesce(${payments.paidAt}, ${payments.createdAt}) at time zone 'Asia/Jakarta')::date = ${q.date}::date`);
  const rows = await db.select({ p: payments, branchName: branches.name, receivedByName: receiver.fullName }).from(payments)
    .innerJoin(branches, eq(branches.id, payments.branchId)).leftJoin(receiver, eq(receiver.id, payments.receivedBy))
    .where(where.length ? and(...where) : undefined).orderBy(desc(payments.createdAt)).limit(300);
  const list = rows.map(({ p, branchName, receivedByName }) => ({ ...p, branchName, receivedByName }));
  const paid = list.filter((p) => p.status === 'paid');
  // Kas keluar tanggal yang sama (biaya operasional & refund yang dibayarkan)
  const outWhere = (col: typeof branchExpenses.paidAt | typeof refunds.paidAt) => q.date ? sql`(${col} at time zone 'Asia/Jakarta')::date = ${q.date}::date` : sql`${col} > now() - interval '1 day'`;
  const [exp, rfd] = await Promise.all([
    db.select({ no: branchExpenses.expenseNo, label: branchExpenses.description, amount: branchExpenses.amount, method: branchExpenses.method, at: branchExpenses.paidAt, id: branchExpenses.id })
      .from(branchExpenses).where(and(eq(branchExpenses.status, 'paid'), outWhere(branchExpenses.paidAt), sc ? eq(branchExpenses.branchId, req.user!.branch!.id) : undefined)),
    db.select({ no: refunds.refundNo, label: refunds.sourceNo, amount: refunds.amount, method: refunds.method, at: refunds.paidAt, id: refunds.id })
      .from(refunds).where(and(eq(refunds.status, 'paid'), outWhere(refunds.paidAt), sc ? eq(refunds.branchId, req.user!.branch!.id) : undefined)),
  ]);
  const outflows = [...exp.map((e) => ({ ...e, type: 'expense' as const })), ...rfd.map((r) => ({ ...r, type: 'refund' as const, label: `Refund ${r.label}` }))];
  const byMethod: Record<string, number> = {};
  for (const p of paid) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  res.json({
    payments: list,
    totals: { count: paid.length, amount: paid.reduce((s, p) => s + p.amount, 0), tazir: paid.reduce((s, p) => s + p.tazirAmount, 0),
      byMethod, installment: paid.filter((p) => p.kind === 'installment').reduce((s, p) => s + p.amount, 0), order: paid.filter((p) => p.kind === 'order').reduce((s, p) => s + p.amount, 0),
      downPayment: paid.filter((p) => p.kind === 'down_payment').reduce((s, p) => s + p.amount, 0), ibra: paid.reduce((s, p) => s + p.ibraAmount, 0),
      outflow: outflows.reduce((s, o) => s + o.amount, 0), cashOutflow: outflows.filter((o) => o.method === 'cash').reduce((s, o) => s + o.amount, 0) },
    outflows,
  });
});

// ---------------------------------------------------------------------------
// Collection (AO / Manager Cabang) & kualitas portofolio (BM)
// ---------------------------------------------------------------------------
paymentsRouter.get('/collection', requireRole('ao', 'branch-manager', 'biz-mgr', 'cashier'), async (req, res) => {
  const u = req.user!;
  const where: SQL[] = [eq(creditApplications.status, 'active')];
  if (u.roleCode === 'ao') where.push(eq(creditApplications.aoId, u.id));
  else { const sc = branchScope(u, creditApplications.branchId); if (sc) where.push(sc); }
  const rows = await db.select({ id: creditApplications.id, appNo: creditApplications.appNo, contractNo: creditApplications.contractNo, monthly: creditApplications.monthly,
    currency: creditApplications.currency, customerName: customers.fullName, phone: customers.phone, address: customers.address, city: customers.city,
    productName: products.name, branchName: branches.name, aoName: users.fullName })
    .from(creditApplications).innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
    .innerJoin(branches, eq(branches.id, creditApplications.branchId)).leftJoin(users, eq(users.id, creditApplications.aoId)).where(and(...where));
  const out = [];
  for (const r of rows) { const p = await creditPosition(r.id); out.push({ ...r, outstanding: p.outstanding, overdueAmount: p.overdueAmount, dpd: p.dpd, nextDue: p.next?.dueDate ?? null, paidCount: p.paidCount, tazirDue: p.tazirDue }); }
  out.sort((a, b) => b.dpd - a.dpd || (a.nextDue ?? '').localeCompare(b.nextDue ?? ''));
  res.json({ collection: out });
});

paymentsRouter.get('/portfolio', requireRole('biz-mgr', 'branch-manager', 'finance'), async (req, res) => {
  const where: SQL[] = [eq(creditApplications.status, 'active')];
  const sc = branchScope(req.user!, creditApplications.branchId);
  if (sc) where.push(sc);
  const rows = await db.select({ id: creditApplications.id, branchId: creditApplications.branchId, branchName: branches.name }).from(creditApplications)
    .innerJoin(branches, eq(branches.id, creditApplications.branchId)).where(and(...where));
  const buckets = ['current', 'dpd1_30', 'dpd31_60', 'dpd61_90', 'dpd90'] as const;
  const bucketOf = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'dpd1_30' : d <= 60 ? 'dpd31_60' : d <= 90 ? 'dpd61_90' : 'dpd90');
  const byBranch: Record<string, { branchId: string; branchName: string; accounts: number; outstanding: number; overdue: number } & Record<(typeof buckets)[number], number>> = {};
  for (const r of rows) {
    const p = await creditPosition(r.id);
    const b = (byBranch[r.branchId] ??= { branchId: r.branchId, branchName: r.branchName, accounts: 0, outstanding: 0, overdue: 0, current: 0, dpd1_30: 0, dpd31_60: 0, dpd61_90: 0, dpd90: 0 });
    b.accounts += 1; b.outstanding += p.outstanding; b.overdue += p.overdueAmount; b[bucketOf(p.dpd)] += p.outstanding;
  }
  const list = Object.values(byBranch);
  const total = list.reduce((s, b) => ({ ...s, accounts: s.accounts + b.accounts, outstanding: s.outstanding + b.outstanding, overdue: s.overdue + b.overdue,
    current: s.current + b.current, dpd1_30: s.dpd1_30 + b.dpd1_30, dpd31_60: s.dpd31_60 + b.dpd31_60, dpd61_90: s.dpd61_90 + b.dpd61_90, dpd90: s.dpd90 + b.dpd90 }),
    { accounts: 0, outstanding: 0, overdue: 0, current: 0, dpd1_30: 0, dpd31_60: 0, dpd61_90: 0, dpd90: 0 });
  const [{ collected30d }] = await db.select({ collected30d: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.kind} = 'installment' and ${payments.status} = 'paid' and ${payments.paidAt} > now() - interval '30 days'),0)::float` })
    .from(payments).where(sc ? (eq(payments.branchId, req.user!.branch!.id)) : undefined);
  res.json({ byBranch: list, total, collected30d, nplPct: total.outstanding ? Math.round(((total.dpd90 + total.dpd61_90) / total.outstanding) * 1000) / 10 : 0 });
});

