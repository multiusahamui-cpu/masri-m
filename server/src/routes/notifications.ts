import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';

export const notificationsRouter = Router();

notificationsRouter.get('/notifications', async (req, res) => {
  const mine = eq(notifications.userId, req.user!.id);
  const [rows, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(mine).orderBy(desc(notifications.id)).limit(30),
    db.select({ unread: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
  ]);
  res.json({ notifications: rows, unread });
});

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
  res.json({ ok: true });
});

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, req.user!.id)));
  res.json({ ok: true });
});
