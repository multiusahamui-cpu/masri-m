import { env } from './env.js';
import { createApp } from './app.js';
import { isProd } from './env.js';
import { getPaymentGateway } from './lib/gateways.js';
import { getCourierProvider } from './lib/couriers.js';
import { getStorage } from './lib/storage.js';
import { expireStaleOrders } from './lib/orders.js';
import { assessTazir, expireStalePayments } from './lib/payments.js';
import './lib/aftersales.js';
import { notifyProviders, processOutbox, queueInstallmentReminders } from './lib/notify.js';
import { expireStaleApprovals } from './lib/credit.js';
import { syncJournals } from './lib/accounting.js';
import { pollCourierUpdates } from './lib/shipping.js';
import { checkProduction } from './lib/prod-check.js';
import { logger } from './lib/logger.js';
import { guardedJob, sendAlert } from './lib/alert.js';
import { runScheduledCampaigns } from './lib/promo.js';
import { watchdog } from './lib/monitor.js';

if (isProd) {
  const { errors, warnings } = checkProduction();
  for (const w of warnings) logger.warn('prod-check', w);
  if (errors.length) {
    for (const e of errors) logger.error('prod-check', e);
    logger.error('prod-check', `API tidak dijalankan: ${errors.length} masalah konfigurasi production. Perbaiki server/.env.production (lihat docs/DEPLOY.md).`);
    process.exit(1);
  }
}

const server = createApp().listen(env.PORT, () => {
  const n = notifyProviders();
  logger.info('api', `Masri-M API berjalan di port ${env.PORT}`, {
    env: env.NODE_ENV, version: process.env.APP_VERSION ?? 'dev',
    payment: { ID: getPaymentGateway('ID').name, MY: getPaymentGateway('MY').name, BN: getPaymentGateway('BN').name },
    courier: { ID: getCourierProvider('ID').name, MY: getCourierProvider('MY').name },
    whatsapp: n.whatsapp, email: n.email, storage: getStorage().name,
  });
});

// Tugas berkala: order & tagihan kedaluwarsa, persetujuan kredit yang tidak diakadkan, ta'zir, pengingat
const housekeeping = guardedJob('housekeeping', async () => {
  const [o, p, a] = await Promise.all([expireStaleOrders(), expireStalePayments(), expireStaleApprovals()]);
  const t = await assessTazir();
  const rem = await queueInstallmentReminders();
  if (rem || o || p || a || t) logger.info('housekeeping', 'selesai', { ordersExpired: o, paymentsExpired: p, approvalsExpired: a, tazir: t, reminders: rem });
});
setInterval(housekeeping, 5 * 60_000);
setTimeout(housekeeping, 10_000);

// Pengiriman notifikasi WhatsApp / email dari outbox
let sending = false;
const outbox = guardedJob('notifikasi', async () => { await processOutbox(); }, 20);
setInterval(async () => {
  if (sending) return;
  sending = true;
  try { await outbox(); } finally { sending = false; }
}, 15_000);

// Posting jurnal otomatis dari transaksi operasional
const journals = guardedJob('akuntansi', async () => { await syncJournals(); }, 5);
setInterval(journals, 60_000);
setTimeout(journals, 5_000);

// Status resi kurir tanpa webhook (EasyParcel)
setInterval(guardedJob('kurir', async () => { await pollCourierUpdates(); }, 2), 30 * 60_000);

// Kampanye marketing terjadwal
setInterval(guardedJob('kampanye', async () => { await runScheduledCampaigns(); }, 3), 5 * 60_000);

// Pengawas: cadangan database & antrean notifikasi
setInterval(guardedJob('watchdog', watchdog), 15 * 60_000);
setTimeout(guardedJob('watchdog', watchdog), 60_000);

process.on('unhandledRejection', (e) => { logger.error('process', 'unhandledRejection', e); void sendAlert('unhandled', 'Error tak tertangani di API', e instanceof Error ? e.message : String(e)); });
process.on('uncaughtException', (e) => {
  logger.error('process', 'uncaughtException — proses dihentikan, container akan restart', e);
  void sendAlert('crash', 'API crash dan direstart', e.message).finally(() => setTimeout(() => process.exit(1), 2000));
});
const shutdown = (sig: string) => {
  logger.info('api', `${sig} diterima, menutup server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
