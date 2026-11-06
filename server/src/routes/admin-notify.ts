import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notificationOutbox } from '../db/schema.js';
import { parseBody } from '../lib/http.js';
import { outboxStats, processOutbox, render, retryFailed } from '../lib/notify.js';

/** Super Admin: pantau outbox notifikasi, kirim ulang, kirim pesan uji. */
export const adminNotifyRouter = Router();

adminNotifyRouter.get('/notifications/outbox', async (_req, res) => { res.json(await outboxStats()); });

adminNotifyRouter.post('/notifications/retry', async (req, res) => {
  const { ids } = parseBody(z.object({ ids: z.array(z.number().int()).min(1).max(200) }), req.body);
  const n = await retryFailed(ids);
  await processOutbox();
  res.json({ retried: n });
});

adminNotifyRouter.post('/notifications/test', async (req, res) => {
  const b = parseBody(z.object({ channel: z.enum(['whatsapp', 'email']), to: z.string().trim().min(5).max(200) }), req.body);
  if (b.channel === 'email') z.email('Email tidak valid').parse(b.to);
  const { subject, body } = render('payment_received', { name: 'Tim Masri-M', amount: 'Rp 0', purpose: 'uji coba notifikasi', paymentNo: 'TEST', link: 'https://masri-m.local', extra: 'Ini pesan uji dari menu Super Admin.' });
  const [m] = await db.insert(notificationOutbox).values({ channel: b.channel, recipient: b.to, template: 'test', subject: `[UJI] ${subject}`, body, refType: 'test', refId: req.user!.id }).returning();
  await processOutbox();
  const [after] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, m.id));
  res.json({ message: after });
});
