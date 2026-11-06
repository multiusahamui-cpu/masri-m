import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { errorHandler, HttpError, safeEqual } from './lib/http.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { adminConfigRouter } from './routes/admin-config.js';
import { adminAuditRouter } from './routes/admin-audit.js';
import { publicConfigRouter } from './routes/public-config.js';
import { adminBranchesRouter } from './routes/admin-branches.js';
import { branchesRouter } from './routes/branches-public.js';
import { helpdeskRouter } from './routes/helpdesk.js';
import { customersRouter } from './routes/customers.js';
import { notificationsRouter } from './routes/notifications.js';
import { productsRouter } from './routes/products.js';
import { inventoryRouter } from './routes/inventory.js';
import { catalogRouter } from './routes/catalog.js';
import { creditRouter } from './routes/credit.js';
import { publicCreditRouter } from './routes/public-credit.js';
import { publicShopRouter } from './routes/public-shop.js';
import { devCourierRouter } from './routes/dev-courier.js';
import { shipmentsRouter } from './routes/shipments.js';
import { paymentsRouter } from './routes/payments.js';
import { assistantRouter, adminAssistantRouter } from './routes/assistant.js';
import { financeRouter } from './routes/finance.js';
import { aftersalesRouter } from './routes/aftersales.js';
import { adminNotifyRouter } from './routes/admin-notify.js';
import { filesRouter } from './routes/files.js';
import { customerRouter } from './routes/customer.js';
import { accountingRouter } from './routes/accounting.js';
import { payablesRouter } from './routes/payables.js';
import { bankrecRouter } from './routes/bankrec.js';
import { operationsRouter } from './routes/operations.js';
import { marketingRouter, publicMarketingRouter } from './routes/marketing.js';
import { originGuard, rateLimit } from './lib/ratelimit.js';
import crypto from 'node:crypto';
import { logger } from './lib/logger.js';
import { healthDetails } from './lib/monitor.js';

export function createApp() {
  const app = express();
  // di belakang proxy Vite / reverse proxy (produksi: isi TRUST_PROXY, mis. 1 atau 'loopback, 10.0.0.0/8')
  app.set('trust proxy', process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback');
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  // ID permintaan (diteruskan dari reverse proxy bila ada) + log akses JSON
  app.use((req, res, next) => {
    // ID dari proxy hanya diterima bila berformat aman (cegah injeksi ke log)
    const given = req.get('x-request-id');
    const rid = given && /^[\w.-]{8,64}$/.test(given) ? given : crypto.randomUUID();
    res.setHeader('x-request-id', rid);
    if (process.env.ACCESS_LOG === 'off' || req.path === '/api/health') return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 || ms > 3000 ? 'warn' : 'info';
      if (level === 'info' && process.env.ACCESS_LOG !== 'all' && req.method === 'GET') return; // GET sukses tidak dicatat (hemat log)
      // Token rahasia di path webhook tidak boleh tertulis di log
      const path = req.originalUrl.split('?')[0].replace(/(\/webhooks\/[\w-]+\/)[^/]+$/, '$1***');
      logger[level]('access', `${req.method} ${path} ${res.statusCode}`, { rid, ms: Math.round(ms), ip: req.ip, user: req.user?.id });
    });
    next();
  });
  // Batas ukuran body: 200 KB, kecuali impor rekening koran CSV (maks. 5 MB, khusus Bookkeeping)
  const jsonSmall = express.json({ limit: '200kb' }), jsonLarge = express.json({ limit: '6mb' });
  app.use((req, res, next) => (/^\/api\/bank\/accounts\/[\w-]+\/(preview|import)$/.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));
  app.use(cookieParser());
  app.use(originGuard);
  app.use('/api', rateLimit('global', 600, 60));
  app.use('/api/auth/login', rateLimit('login', 10, 60, 'Terlalu banyak percobaan login. Coba lagi 1 menit lagi.'));
  // Endpoint publik yang bisa disalahgunakan (spam pesanan, tebak nomor HP)
  app.use(['/api/public/orders', '/api/public/credit-applications', '/api/public/credit-applications/pay', '/api/assistant/chat'], rateLimit('public-write', 30, 60, undefined, { writesOnly: true }));
  app.use(['/api/public/orders/track', '/api/public/credit-applications/track', '/api/public/credit-applications/position', '/api/public/receipts'], rateLimit('public-track', 40, 60));

  app.get('/api/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ ok: true, time: new Date().toISOString() });
  });
  // Detail kesehatan untuk monitoring (Uptime Kuma, dsb.) — wajib header x-monitor-token
  app.get('/api/health/details', async (req, res) => {
    const token = process.env.MONITOR_TOKEN;
    if (!token || !safeEqual(req.get('x-monitor-token'), token)) throw new HttpError(404, 'Endpoint tidak ditemukan');
    res.json(await healthDetails());
  });

  app.use('/api/auth', authRouter);
  app.use('/api', publicConfigRouter, catalogRouter, publicCreditRouter, publicShopRouter, devCourierRouter, assistantRouter, customerRouter, publicMarketingRouter);

  // Semua endpoint Super Admin
  const superAdmin = express.Router();
  superAdmin.use(requireAuth, requireRole('super-admin'));
  superAdmin.use(adminUsersRouter, adminConfigRouter, adminAuditRouter, adminBranchesRouter, adminAssistantRouter, adminNotifyRouter);
  app.use('/api/admin', superAdmin);

  // Endpoint staf yang sudah login (wajib sudah ganti password)
  const staff = express.Router();
  staff.use(requireAuth, (req, _res, next) => {
    if (req.user!.mustChangePassword) throw new HttpError(403, 'Silakan ganti password terlebih dahulu');
    next();
  });
  staff.use(branchesRouter, customersRouter, notificationsRouter, productsRouter);
  staff.use('/inventory', inventoryRouter);
  staff.use('/credit', creditRouter);
  staff.use(shipmentsRouter, paymentsRouter, financeRouter, aftersalesRouter, filesRouter, accountingRouter, payablesRouter, bankrecRouter, operationsRouter, marketingRouter);
  staff.use('/helpdesk', helpdeskRouter);
  app.use('/api', staff);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan')));
  app.use(errorHandler);
  return app;
}
