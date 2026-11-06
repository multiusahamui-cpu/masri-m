import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, shipmentEvents, shipments, users } from '../db/schema.js';
import { HttpError, parseBody, webUrl } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import { bookPartner, canOperate, changeMode, deliver, dispatch, failDelivery, loadShipment, modeLabel, preparePickup, scheduleInternal } from '../lib/shipping.js';
import '../lib/credit.js';
import '../lib/orders.js';

export const shipmentsRouter = Router();
shipmentsRouter.use(['/shipments', '/drivers'], requireRole('warehouse', 'branch-admin', 'branch-manager', 'delivery', 'biz-mgr', 'support', 'cashier', 'ao'));

function scope(u: AuthUser): SQL | undefined {
  const b = u.branch?.id;
  switch (u.roleCode) {
    case 'biz-mgr': case 'support': return undefined;
    case 'warehouse': return b ? eq(shipments.fromBranchId, b) : sql`false`;
    case 'delivery': return eq(shipments.driverId, u.id);
    default: return b ? or(eq(shipments.fromBranchId, b), eq(shipments.branchId, b)) : sql`false`;
  }
}

const STATUSES = ['pending', 'scheduled', 'ready_pickup', 'in_transit', 'delivered', 'failed', 'cancelled'] as const;

shipmentsRouter.get('/shipments', async (req, res) => {
  const q = parseBody(z.object({ statuses: z.string().optional(), mode: z.enum(['internal', 'partner', 'pickup']).optional(), search: z.string().trim().max(80).optional(), date: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const s = scope(req.user!);
  if (s) where.push(s);
  if (q.statuses) where.push(inArray(shipments.status, q.statuses.split(',').filter((x): x is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(x))));
  if (q.mode) where.push(eq(shipments.mode, q.mode));
  if (q.date) where.push(eq(shipments.scheduledDate, q.date));
  if (q.search) { const t = `%${q.search}%`; where.push(or(ilike(shipments.shipmentNo, t), ilike(shipments.sourceNo, t), ilike(shipments.recipientName, t), ilike(shipments.trackingNo, t))!); }
  const rows = await db.select({
    s: shipments, fromName: branches.name, driverName: users.fullName,
  }).from(shipments).innerJoin(branches, eq(branches.id, shipments.fromBranchId)).leftJoin(users, eq(users.id, shipments.driverId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case ${shipments.status} when 'pending' then 0 when 'failed' then 1 when 'scheduled' then 2 when 'ready_pickup' then 3 when 'in_transit' then 4 else 5 end`, desc(shipments.updatedAt)).limit(150);
  res.json({
    shipments: rows.map(({ s: x, fromName, driverName }) => ({ ...x, pickupCode: undefined, fromName, driverName, modeLabel: modeLabel(x), canOperate: canOperate(req.user!, x) })),
  });
});

shipmentsRouter.get('/shipments/:id', async (req, res) => {
  const s = await loadShipment(z.uuid().parse(req.params.id));
  const sc = scope(req.user!);
  if (sc) {
    const [ok] = await db.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.id, s.id), sc)).limit(1);
    if (!ok) throw new HttpError(404, 'Pengiriman tidak ditemukan');
  }
  const [events, [from], driver] = await Promise.all([
    db.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, s.id)).orderBy(asc(shipmentEvents.id)),
    db.select({ name: branches.name, city: branches.city, address: branches.address, type: branches.type }).from(branches).where(eq(branches.id, s.fromBranchId)),
    s.driverId ? db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, s.driverId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const op = canOperate(req.user!, s);
  // Kode pengambilan hanya untuk petugas lokasi (tidak ditampilkan ke driver/role lain)
  res.json({ shipment: { ...s, pickupCode: undefined, hasPickupCode: !!s.pickupCode }, from, driver, events, modeLabel: modeLabel(s), canOperate: op, isMyTask: s.driverId === req.user!.id });
});

shipmentsRouter.get('/drivers', async (req, res) => {
  const u = req.user!;
  // Staf cabang hanya melihat driver cabangnya sendiri
  const branchId = u.branch?.type === 'branch' ? u.branch.id : z.uuid().parse(req.query.branchId ?? u.branch?.id);
  const rows = await db.select({
    id: users.id, fullName: users.fullName, phone: users.phone,
    todayTasks: sql<number>`(select count(*)::int from shipments s where s.driver_id = "users"."id" and s.status in ('scheduled','in_transit'))`,
  }).from(users).where(and(eq(users.roleCode, 'delivery'), eq(users.status, 'active'), eq(users.branchId, branchId))).orderBy(asc(users.fullName));
  res.json({ drivers: rows });
});

const id = (raw: unknown) => z.uuid().parse(raw);
shipmentsRouter.post('/shipments/:id/schedule', async (req, res) => {
  const p = parseBody(z.object({ driverId: z.uuid('Pilih driver'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid'), slot: z.enum(['pagi', 'siang', 'sore']), vehicleRef: z.string().trim().max(40).nullish() }), req.body);
  res.json({ shipment: await scheduleInternal(req.user!, id(req.params.id), p) });
});
shipmentsRouter.post('/shipments/:id/book', async (req, res) => { res.json({ shipment: await bookPartner(req.user!, id(req.params.id)) }); });
shipmentsRouter.post('/shipments/:id/prepare-pickup', async (req, res) => {
  const s = await preparePickup(req.user!, id(req.params.id));
  res.json({ shipment: { ...s, pickupCode: undefined } });
});
shipmentsRouter.post('/shipments/:id/dispatch', async (req, res) => { res.json({ shipment: await dispatch(req.user!, id(req.params.id)) }); });
shipmentsRouter.post('/shipments/:id/deliver', async (req, res) => {
  const p = parseBody(z.object({ podName: z.string().trim().min(2, 'Isi nama penerima'), podNote: z.string().trim().max(500).nullish(), podPhotoUrl: webUrl().nullish().or(z.literal('').transform(() => null)), pickupCode: z.string().trim().nullish() }), req.body);
  const s = await deliver(req.user!, id(req.params.id), p);
  res.json({ shipment: { ...s, pickupCode: undefined } });
});
shipmentsRouter.post('/shipments/:id/fail', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Isi alasan') }), req.body);
  res.json({ shipment: await failDelivery(req.user!, id(req.params.id), reason) });
});
shipmentsRouter.post('/shipments/:id/change-mode', async (req, res) => {
  const { mode } = parseBody(z.object({ mode: z.enum(['internal', 'pickup']) }), req.body);
  res.json({ shipment: await changeMode(req.user!, id(req.params.id), mode) });
});
