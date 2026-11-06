import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, businessConfigs, customers, notifications, ticketEvents, ticketWatchers, tickets, users, type Ticket,
} from '../db/schema.js';
import { HttpError } from './http.js';
import type { AuthUser } from '../middleware/auth.js';

export type TicketStatus = Ticket['status'];
export type TicketPriority = Ticket['priority'];
export const PENDING_STATUSES: TicketStatus[] = ['open', 'in_progress', 'escalated', 'branch_done'];

/** Role yang boleh melihat helpdesk & ruang lingkupnya */
export const HELPDESK_ROLES = ['support', 'biz-mgr', 'branch-manager', 'branch-admin'] as const;

const DEFAULT_SLA: Record<TicketPriority, number> = { urgent: 4, high: 24, normal: 72, low: 120 };

async function slaHours(priority: TicketPriority): Promise<number> {
  const [row] = await db.select({ value: businessConfigs.value }).from(businessConfigs)
    .where(and(eq(businessConfigs.key, 'helpdesk.sla_hours'), eq(businessConfigs.countryCode, 'ID'))).limit(1);
  const v = (row?.value ?? {}) as Partial<Record<TicketPriority, number>>;
  return typeof v[priority] === 'number' ? v[priority]! : DEFAULT_SLA[priority];
}

/**
 * Filter SQL agar setiap role hanya melihat tiket yang menjadi haknya:
 * - Helpdesk Pusat & Business Manager : semua tiket
 * - Manager Cabang                    : semua tiket cabangnya
 * - Admin Cabang                      : tiket cabangnya yang pernah dieskalasi
 */
export function scopeFilter(user: AuthUser): SQL | undefined {
  switch (user.roleCode) {
    case 'support':
    case 'biz-mgr':
      return undefined;
    case 'branch-manager':
      return user.branch ? eq(tickets.branchId, user.branch.id) : sql`false`;
    case 'branch-admin':
      return user.branch ? and(eq(tickets.branchId, user.branch.id), isNotNull(tickets.escalatedAt)) : sql`false`;
    default:
      return sql`false`;
  }
}

export async function getTicketForUser(user: AuthUser, id: string): Promise<Ticket> {
  const scope = scopeFilter(user);
  const [t] = await db.select().from(tickets).where(scope ? and(eq(tickets.id, id), scope) : eq(tickets.id, id)).limit(1);
  if (!t) throw new HttpError(404, 'Tiket tidak ditemukan');
  return t;
}

// ---------------------------------------------------------------------------
// Helper notifikasi & watcher
// ---------------------------------------------------------------------------
async function activeUserIds(where: SQL): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), where));
  return rows.map((r) => r.id);
}

async function addWatchers(ticketId: string, ids: string[], reason: string) {
  if (!ids.length) return;
  await db.insert(ticketWatchers).values(ids.map((userId) => ({ ticketId, userId, reason }))).onConflictDoNothing();
}

async function notify(userIds: string[], exceptId: string | null, ticket: Ticket, title: string, body: string) {
  const targets = [...new Set(userIds)].filter((id) => id !== exceptId);
  if (!targets.length) return;
  await db.insert(notifications).values(targets.map((userId) => ({ userId, ticketId: ticket.id, title, body })));
}

async function watcherIds(ticketId: string) {
  const rows = await db.select({ id: ticketWatchers.userId }).from(ticketWatchers).where(eq(ticketWatchers.ticketId, ticketId));
  return rows.map((r) => r.id);
}

const helpdeskStaff = () => activeUserIds(eq(users.roleCode, 'support'));

async function addEvent(t: Ticket, actor: AuthUser, type: typeof ticketEvents.$inferInsert['type'], message: string | null, toStatus?: TicketStatus) {
  await db.insert(ticketEvents).values({
    ticketId: t.id, type, actorId: actor.id, actorName: actor.fullName, actorRole: actor.roleCode,
    message, fromStatus: toStatus ? t.status : null, toStatus: toStatus ?? null,
  });
}

async function updateTicket(t: Ticket, patch: Partial<typeof tickets.$inferInsert>): Promise<Ticket> {
  const [after] = await db.update(tickets).set({ ...patch, updatedAt: new Date() }).where(eq(tickets.id, t.id)).returning();
  return after;
}

function assertStatus(t: Ticket, allowed: TicketStatus[], action: string) {
  if (!allowed.includes(t.status)) throw new HttpError(409, `Tiket berstatus "${t.status}" tidak dapat ${action}`);
}

function assertRole(actor: AuthUser, roles: string[], action: string) {
  if (!roles.includes(actor.roleCode)) throw new HttpError(403, `Role Anda tidak dapat ${action}`);
}

// ---------------------------------------------------------------------------
// Aksi tiket
// ---------------------------------------------------------------------------
export interface CreateTicketInput {
  subject: string; description: string; category: Ticket['category']; priority: TicketPriority;
  channel: Ticket['channel']; customerId?: string | null; branchId?: string | null; orderRef?: string | null;
}

export async function createTicket(actor: AuthUser, input: CreateTicketInput): Promise<Ticket> {
  assertRole(actor, ['support'], 'membuat tiket (Helpdesk satu pintu di Pusat)');
  const hours = await slaHours(input.priority);
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select nextval('helpdesk_ticket_seq')::text as seq`).then((r) => r.rows);
  const now = new Date();
  const ticketNo = `TKT-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;

  const [t] = await db.insert(tickets).values({
    ...input, customerId: input.customerId ?? null, branchId: input.branchId ?? null, orderRef: input.orderRef ?? null,
    ticketNo, createdBy: actor.id, dueAt: new Date(now.getTime() + hours * 3600_000),
  }).returning();
  await addEvent(t, actor, 'created', input.description);
  return t;
}

/**
 * Tiket dari Asisten Virtual (kanal "chat"). Tidak ada user pembuat; nasabah dicocokkan lewat nomor HP
 * agar cabang yang melayani langsung terisi. Masuk antrian Helpdesk Pusat seperti tiket biasa.
 */
export async function createAssistantTicket(input: {
  name: string; phone: string; category: Ticket['category']; subject: string; description: string; reference?: string | null;
  /** Sumber tiket (default Asisten Virtual) */ via?: string; priority?: Ticket['priority'];
}): Promise<Ticket> {
  const via = input.via ?? 'Asisten Virtual';
  const digits = input.phone.replace(/[^0-9]/g, '').replace(/^62/, '0');
  const [c] = await db.select({ id: customers.id, branchId: customers.branchId }).from(customers)
    .where(sql`regexp_replace(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), '^62', '0') = ${digits}`).limit(1);
  const hours = await slaHours(input.priority ?? 'normal');
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select nextval('helpdesk_ticket_seq')::text as seq`).then((r) => r.rows);
  const now = new Date();
  const ticketNo = `TKT-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
  const description = `${input.description}\n\n— Dilaporkan via ${via} oleh ${input.name} (${input.phone})${c ? '' : ' · nomor HP belum terdaftar sebagai nasabah'}`;
  const [t] = await db.insert(tickets).values({
    ticketNo, subject: input.subject, description, category: input.category, priority: input.priority ?? 'normal', channel: input.via ? 'web' : 'chat',
    customerId: c?.id ?? null, branchId: c?.branchId ?? null, orderRef: input.reference ?? null, createdBy: null,
    dueAt: new Date(now.getTime() + hours * 3600_000),
  }).returning();
  await db.insert(ticketEvents).values({ ticketId: t.id, type: 'created', actorName: via, actorRole: input.via ? 'customer' : 'assistant', message: description });
  await notify(await helpdeskStaff(), null, t, `Tiket baru dari ${via}: ${t.ticketNo}`, input.subject);
  return t;
}

export async function startTicket(actor: AuthUser, t: Ticket) {
  assertRole(actor, ['support'], 'memproses tiket');
  assertStatus(t, ['open'], 'diproses');
  const after = await updateTicket(t, { status: 'in_progress' });
  await addEvent(t, actor, 'status_changed', 'Tiket mulai ditangani Helpdesk Pusat', 'in_progress');
  return after;
}

/** Eskalasi ke Admin Cabang, dengan tembusan ke Business Manager & Manager Cabang. */
export async function escalateTicket(actor: AuthUser, t: Ticket, branchId: string, note: string) {
  assertRole(actor, ['support'], 'mengeskalasi tiket');
  assertStatus(t, ['open', 'in_progress', 'branch_done'], 'dieskalasi');
  const [b] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!b || !b.isActive) throw new HttpError(400, 'Cabang tujuan tidak ditemukan / nonaktif');
  if (b.type !== 'branch') throw new HttpError(400, 'Eskalasi hanya ke cabang, bukan Kantor Pusat');

  const admins = await activeUserIds(and(eq(users.roleCode, 'branch-admin'), eq(users.branchId, b.id))!);
  if (!admins.length) throw new HttpError(409, `Cabang ${b.name} belum memiliki Admin Cabang aktif`);
  const managers = await activeUserIds(and(eq(users.roleCode, 'branch-manager'), eq(users.branchId, b.id))!);
  const bms = await activeUserIds(eq(users.roleCode, 'biz-mgr'));

  const after = await updateTicket(t, {
    status: 'escalated', branchId: b.id, escalatedAt: new Date(), escalatedBy: actor.id, escalationNote: note,
    branchResolvedAt: null, branchResolvedBy: null,
  });
  await addEvent(t, actor, 'escalated', `Dieskalasi ke ${b.name}: ${note}`, 'escalated');
  await addWatchers(t.id, admins, 'assignee');
  await addWatchers(t.id, managers, 'cc_branch_manager');
  await addWatchers(t.id, bms, 'cc_biz_mgr');

  await notify(admins, actor.id, after, `Eskalasi ${t.ticketNo}: ${t.subject}`, `Mohon ditindaklanjuti oleh ${b.name}. Catatan Helpdesk: ${note}`);
  await notify([...managers, ...bms], actor.id, after, `Tembusan eskalasi ${t.ticketNo} ke ${b.name}`, `${t.subject} — ${note}`);
  return after;
}

/** Admin Cabang menyatakan penanganan di cabang selesai; kembali ke Helpdesk untuk konfirmasi nasabah. */
export async function branchDone(actor: AuthUser, t: Ticket, resolution: string) {
  assertRole(actor, ['branch-admin'], 'menyelesaikan tiket cabang');
  if (!actor.branch || t.branchId !== actor.branch.id) throw new HttpError(403, 'Tiket bukan milik cabang Anda');
  assertStatus(t, ['escalated'], 'diselesaikan cabang');
  const after = await updateTicket(t, { status: 'branch_done', branchResolvedAt: new Date(), branchResolvedBy: actor.id, resolution });
  await addEvent(t, actor, 'branch_done', resolution, 'branch_done');
  await notify([...(await helpdeskStaff()), ...(await watcherIds(t.id))], actor.id, after,
    `${t.ticketNo} selesai ditangani ${actor.branch.name}`, resolution);
  return after;
}

export async function resolveTicket(actor: AuthUser, t: Ticket, resolution?: string) {
  assertRole(actor, ['support'], 'menyelesaikan tiket');
  assertStatus(t, ['open', 'in_progress', 'branch_done'], 'diselesaikan');
  const finalResolution = resolution?.trim() || t.resolution;
  if (!finalResolution) throw new HttpError(400, 'Isi catatan penyelesaian');
  const after = await updateTicket(t, { status: 'resolved', resolution: finalResolution, resolvedAt: new Date() });
  await addEvent(t, actor, 'resolved', finalResolution, 'resolved');
  await notify(await watcherIds(t.id), actor.id, after, `${t.ticketNo} selesai`, finalResolution);
  return after;
}

export async function closeTicket(actor: AuthUser, t: Ticket) {
  assertRole(actor, ['support'], 'menutup tiket');
  assertStatus(t, ['resolved'], 'ditutup');
  const after = await updateTicket(t, { status: 'closed', closedAt: new Date() });
  await addEvent(t, actor, 'closed', 'Tiket ditutup', 'closed');
  return after;
}

export async function reopenTicket(actor: AuthUser, t: Ticket, reason: string) {
  assertRole(actor, ['support'], 'membuka ulang tiket');
  assertStatus(t, ['resolved', 'closed'], 'dibuka ulang');
  const after = await updateTicket(t, { status: 'in_progress', resolvedAt: null, closedAt: null });
  await addEvent(t, actor, 'reopened', reason, 'in_progress');
  await notify(await watcherIds(t.id), actor.id, after, `${t.ticketNo} dibuka kembali`, reason);
  return after;
}

export async function commentTicket(actor: AuthUser, t: Ticket, message: string) {
  if (['closed'].includes(t.status)) throw new HttpError(409, 'Tiket sudah ditutup');
  await addEvent(t, actor, 'comment', message);
  // Komentar cabang -> Helpdesk; komentar Helpdesk saat eskalasi -> Admin Cabang; BM/MC -> Helpdesk.
  let targets: string[] = [];
  if (actor.roleCode === 'support') {
    if (t.status === 'escalated' && t.branchId) {
      targets = await activeUserIds(and(eq(users.roleCode, 'branch-admin'), eq(users.branchId, t.branchId))!);
    }
  } else {
    targets = await helpdeskStaff();
  }
  await notify(targets, actor.id, t, `Komentar baru di ${t.ticketNo}`, `${actor.fullName}: ${message.slice(0, 200)}`);
  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, t.id));
}

export async function watchersOf(ticketId: string) {
  return db.select({ userId: users.id, fullName: users.fullName, roleCode: users.roleCode, reason: ticketWatchers.reason })
    .from(ticketWatchers).innerJoin(users, eq(users.id, ticketWatchers.userId))
    .where(eq(ticketWatchers.ticketId, ticketId));
}

