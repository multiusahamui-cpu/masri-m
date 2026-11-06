import crypto from 'node:crypto';
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { shipments } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { applyCourierUpdate, deliver } from '../lib/shipping.js';
import { getCourierProvider } from '../lib/couriers.js';
import '../lib/aftersales.js';
import { isProd } from '../env.js';
import '../lib/credit.js';
import '../lib/orders.js';

/** Simulasi webhook kurir mitra "paket diterima" (hanya pengembangan). */
export const devCourierRouter = Router();
devCourierRouter.post('/dev/shipments/:shipmentNo/courier-delivered', async (req, res) => {
  if (isProd || process.env.ENABLE_DEV_SIMULATION !== 'true') throw new HttpError(404, 'Endpoint tidak ditemukan');
  const [s] = await db.select().from(shipments).where(eq(shipments.shipmentNo, String(req.params.shipmentNo))).limit(1);
  if (!s || s.mode !== 'partner') throw new HttpError(404, 'Pengiriman kurir mitra tidak ditemukan');
  const after = await deliver(null, s.id, { podName: String(req.body?.podName ?? s.recipientName), podNote: 'Status kurir: DELIVERED (simulasi)' });
  res.json({ shipment: { ...after, pickupCode: undefined } });
});

/**
 * Webhook Biteship. Daftarkan URL: https://domain-anda/api/webhooks/biteship/<BITESHIP_WEBHOOK_TOKEN>
 * Isi webhook tidak dipercaya begitu saja: status diambil ulang dari API Biteship berdasarkan order_id.
 */
devCourierRouter.post('/webhooks/biteship/:token', async (req, res) => {
  const token = process.env.BITESHIP_WEBHOOK_TOKEN;
  const provider = getCourierProvider();
  if (!token || provider.name !== 'biteship' || !provider.fetchUpdate) throw new HttpError(404, 'Endpoint tidak ditemukan');
  const a = Buffer.from(String(req.params.token)), b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Token webhook tidak valid');
  const orderId = String(req.body?.order_id ?? req.body?.id ?? '');
  if (!orderId) { res.json({ received: true, ignored: 'no order_id' }); return; } // ping uji dari dashboard
  const update = await provider.fetchUpdate(orderId);
  res.json({ received: true, ...(await applyCourierUpdate(update)) });
});
