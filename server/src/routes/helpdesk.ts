import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, asc, count, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, customers, ticketEvents, tickets, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import {
  HELPDESK_ROLES, PENDING_STATUSES, branchDone, closeTicket, commentTicket, createTicket, escalateTicket,
  getTicketForUser, reopenTicket, resolveTicket, scopeFilter, startTicket, watchersOf, type TicketStatus,
} from '../lib/helpdesk.js';

export const helpdeskRouter = Router();
helpdeskRouter.use(requireRole(...HELPDESK_ROLES));

const STATUSES = ['open', 'in_progress', 'escalated', 'branch_done', 'resolved', 'closed'] as const;
const CATEGORIES = ['order', 'delivery', 'product', 'credit', 'payment', 'account', 'other'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const creator = aliasedTable(users, 'creator');

const listCols = {
  id: tickets.id, ticketNo: tickets.ticketNo, subject: tickets.subject, category: tickets.category,
  priority: tickets.priority, status: tickets.status, channel: tickets.channel, orderRef: tickets.orderRef,
  dueAt: tickets.dueAt, createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, escalatedAt: tickets.escalatedAt,
  resolvedAt: tickets.resolvedAt,
  isOverdue: sql<boolean>`(${tickets.status} in ('open','in_progress','escalated','branch_done') and ${tickets.dueAt} < now())`,
  branchId: tickets.branchId, branchCode: branches.code, branchName: branches.name,
  customerId: tickets.customerId, customerNo: customers.customerNo, customerName: customers.fullName, customerPhone: customers.phone,
};

// ---------------------------------------------------------------------------
// Daftar tiket (dengan ruang lingkup role) + filter untuk drill-down
// ---------------------------------------------------------------------------
const listQuery = z.object({
  status: z.enum([...STATUSES, 'pending', 'overdue']).optional(),
  branchId: z.union([z.uuid(), z.literal('none')]).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  customerId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

helpdeskRouter.get('/tickets', async (req, res) => {
  const q = parseBody(listQuery, req.query);
  const where: SQL[] = [];
  const scope = scopeFilter(req.user!);
  if (scope) where.push(scope);
  if (q.status === 'pending') where.push(inArray(tickets.status, PENDING_STATUSES));
  else if (q.status === 'overdue') where.push(inArray(tickets.status, PENDING_STATUSES), lt(tickets.dueAt, sql`now()`));
  else if (q.status) where.push(eq(tickets.status, q.status));
  if (q.branchId === 'none') where.push(sql`${tickets.branchId} is null`);
  else if (q.branchId) where.push(eq(tickets.branchId, q.branchId));
  if (q.category) where.push(eq(tickets.category, q.category));
  if (q.priority) where.push(eq(tickets.priority, q.priority));
  if (q.customerId) where.push(eq(tickets.customerId, q.customerId));
  if (q.search) {
    const s = `%${q.search}%`;
    where.push(or(ilike(tickets.ticketNo, s), ilike(tickets.subject, s), ilike(customers.fullName, s), ilike(customers.phone, s), ilike(tickets.orderRef, s))!);
  }
  const cond = where.length ? and(...where) : undefined;

  const base = () => db.select(listCols).from(tickets)
    .leftJoin(branches, eq(branches.id, tickets.branchId))
    .leftJoin(customers, eq(customers.id, tickets.customerId));
  const [rows, [{ total }]] = await Promise.all([
    base().where(cond)
      .orderBy(sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(tickets.dueAt))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(tickets).leftJoin(customers, eq(customers.id, tickets.customerId)).where(cond),
  ]);
  res.json({ tickets: rows, total, page: q.page, pageSize: q.pageSize });
});

// ---------------------------------------------------------------------------
// Detail tiket: nasabah, cabang, timeline, tembusan
// ---------------------------------------------------------------------------
helpdeskRouter.get('/tickets/:id', async (req, res) => {
  const t = await getTicketForUser(req.user!, z.uuid().parse(req.params.id));
  const [[extra], events, watchers] = await Promise.all([
    db.select({
      branch: { id: branches.id, code: branches.code, name: branches.name, city: branches.city, phone: branches.phone },
      customer: {
        id: customers.id, customerNo: customers.customerNo, fullName: customers.fullName, phone: customers.phone,
        email: customers.email, city: customers.city, address: customers.address,
      },
      createdByName: creator.fullName,
    }).from(tickets)
      .leftJoin(branches, eq(branches.id, tickets.branchId))
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(creator, eq(creator.id, tickets.createdBy))
      .where(eq(tickets.id, t.id)),
    db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, t.id)).orderBy(asc(ticketEvents.id)),
    watchersOf(t.id),
  ]);
  const customerHistory = t.customerId
    ? await db.select({ id: tickets.id, ticketNo: tickets.ticketNo, subject: tickets.subject, status: tickets.status, createdAt: tickets.createdAt })
      .from(tickets).where(and(eq(tickets.customerId, t.customerId), sql`${tickets.id} <> ${t.id}`, scopeFilter(req.user!)))
      .orderBy(desc(tickets.createdAt)).limit(10)
    : [];
  res.json({
    ticket: {
      ...t,
      isOverdue: (PENDING_STATUSES as TicketStatus[]).includes(t.status) && t.dueAt < new Date(),
      branch: extra?.branch?.id ? extra.branch : null,
      customer: extra?.customer?.id ? extra.customer : null,
      createdByName: extra?.createdByName ?? null,
    },
    events, watchers, customerHistory,
  });
});

// ---------------------------------------------------------------------------
// Aksi
// ---------------------------------------------------------------------------
const createSchema = z.object({
  subject: z.string().trim().min(5, 'Judul minimal 5 karakter').max(200),
  description: z.string().trim().min(10, 'Uraian minimal 10 karakter').max(5000),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES).default('normal'),
  channel: z.enum(['web', 'whatsapp', 'phone', 'email', 'walk_in']).default('phone'),
  customerId: z.uuid().nullish(),
  branchId: z.uuid().nullish(),
  orderRef: z.string().trim().max(64).nullish(),
});

helpdeskRouter.post('/tickets', async (req, res) => {
  const body = parseBody(createSchema, req.body);
  let branchId = body.branchId ?? null;
  if (body.customerId) {
    const [c] = await db.select().from(customers).where(eq(customers.id, body.customerId)).limit(1);
    if (!c) throw new HttpError(400, 'Nasabah tidak ditemukan');
    branchId ??= c.branchId; // default: cabang yang melayani nasabah
  }
  const t = await createTicket(req.user!, { ...body, branchId });
  res.status(201).json({ ticket: t });
});

const id = (raw: unknown) => z.uuid().parse(raw);
const text = (min: number, label: string) => z.string().trim().min(min, `${label} minimal ${min} karakter`).max(5000);

helpdeskRouter.post('/tickets/:id/start', async (req, res) => {
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await startTicket(req.user!, t) });
});

helpdeskRouter.post('/tickets/:id/escalate', async (req, res) => {
  const { branchId, note } = parseBody(z.object({ branchId: z.uuid('Pilih cabang tujuan'), note: text(5, 'Catatan eskalasi') }), req.body);
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await escalateTicket(req.user!, t, branchId, note) });
});

helpdeskRouter.post('/tickets/:id/branch-done', async (req, res) => {
  const { resolution } = parseBody(z.object({ resolution: text(5, 'Catatan penanganan') }), req.body);
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await branchDone(req.user!, t, resolution) });
});

helpdeskRouter.post('/tickets/:id/resolve', async (req, res) => {
  const { resolution } = parseBody(z.object({ resolution: z.string().trim().max(5000).optional() }), req.body);
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await resolveTicket(req.user!, t, resolution) });
});

helpdeskRouter.post('/tickets/:id/close', async (req, res) => {
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await closeTicket(req.user!, t) });
});

helpdeskRouter.post('/tickets/:id/reopen', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: text(5, 'Alasan') }), req.body);
  const t = await getTicketForUser(req.user!, id(req.params.id));
  res.json({ ticket: await reopenTicket(req.user!, t, reason) });
});

helpdeskRouter.post('/tickets/:id/comments', async (req, res) => {
  const { message } = parseBody(z.object({ message: text(2, 'Komentar') }), req.body);
  const t = await getTicketForUser(req.user!, id(req.params.id));
  await commentTicket(req.user!, t, message);
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Problem Status: ringkasan untuk Business Manager (semua cabang) & Manager Cabang (cabangnya)
// ---------------------------------------------------------------------------
helpdeskRouter.get('/summary', async (req, res) => {
  const scope = scopeFilter(req.user!);
  const scoped = (extra?: SQL) => (scope && extra ? and(scope, extra) : scope ?? extra);
  const pending = inArray(tickets.status, PENDING_STATUSES);

  const [byStatus, byBranch, byCategory, aging, [kpi]] = await Promise.all([
    db.select({ status: tickets.status, n: count() }).from(tickets).where(scoped()).groupBy(tickets.status),

    db.select({
      branchId: tickets.branchId, branchCode: branches.code, branchName: branches.name, branchType: branches.type,
      pending: sql<number>`count(*) filter (where ${tickets.status} in ('open','in_progress','escalated','branch_done'))::int`,
      escalated: sql<number>`count(*) filter (where ${tickets.status} = 'escalated')::int`,
      branchDone: sql<number>`count(*) filter (where ${tickets.status} = 'branch_done')::int`,
      overdue: sql<number>`count(*) filter (where ${tickets.status} in ('open','in_progress','escalated','branch_done') and ${tickets.dueAt} < now())::int`,
      resolved30d: sql<number>`count(*) filter (where ${tickets.status} in ('resolved','closed') and ${tickets.resolvedAt} > now() - interval '30 days')::int`,
      total: sql<number>`count(*)::int`,
    }).from(tickets).leftJoin(branches, eq(branches.id, tickets.branchId))
      .where(scoped()).groupBy(tickets.branchId, branches.code, branches.name, branches.type)
      .orderBy(sql`count(*) filter (where ${tickets.status} in ('open','in_progress','escalated','branch_done') and ${tickets.dueAt} < now()) desc`, asc(branches.code)),

    db.select({ category: tickets.category, n: count() }).from(tickets).where(scoped(pending)).groupBy(tickets.category),

    db.select({
      lt1d: sql<number>`count(*) filter (where now() - ${tickets.createdAt} < interval '1 day')::int`,
      d1to3: sql<number>`count(*) filter (where now() - ${tickets.createdAt} >= interval '1 day' and now() - ${tickets.createdAt} < interval '3 days')::int`,
      d3to7: sql<number>`count(*) filter (where now() - ${tickets.createdAt} >= interval '3 days' and now() - ${tickets.createdAt} < interval '7 days')::int`,
      gt7d: sql<number>`count(*) filter (where now() - ${tickets.createdAt} >= interval '7 days')::int`,
    }).from(tickets).where(scoped(pending)),

    db.select({
      pending: sql<number>`count(*) filter (where ${tickets.status} in ('open','in_progress','escalated','branch_done'))::int`,
      overdue: sql<number>`count(*) filter (where ${tickets.status} in ('open','in_progress','escalated','branch_done') and ${tickets.dueAt} < now())::int`,
      escalatedOpen: sql<number>`count(*) filter (where ${tickets.status} = 'escalated')::int`,
      resolved30d: sql<number>`count(*) filter (where ${tickets.resolvedAt} > now() - interval '30 days')::int`,
      avgResolveHours30d: sql<number | null>`round(avg(extract(epoch from (${tickets.resolvedAt} - ${tickets.createdAt})) / 3600) filter (where ${tickets.resolvedAt} > now() - interval '30 days')::numeric, 1)::float`,
      slaMet30d: sql<number>`count(*) filter (where ${tickets.resolvedAt} > now() - interval '30 days' and ${tickets.resolvedAt} <= ${tickets.dueAt})::int`,
    }).from(tickets).where(scoped()),
  ]);

  res.json({ scope: req.user!.roleCode === 'branch-manager' ? 'branch' : 'all', branch: req.user!.branch, kpi, byStatus, byBranch, byCategory, aging: aging[0] });
});
