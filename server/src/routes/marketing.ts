import express, { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { banners, campaigns, featuredProducts, productPrices, products, promoCodes, promoRedemptions } from '../db/schema.js';
import { HttpError, clientIp, parseBody, webUrl } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { CURRENCY, e164 } from '../lib/region.js';
import { audienceCount, evaluatePromo, sendCampaign, setMarketingOptIn, verifyUnsubscribe } from '../lib/promo.js';
import { rateLimit } from '../lib/ratelimit.js';

/** Marketing: kode promo, banner & produk unggulan, kampanye (opt-in), laporan efektivitas. */
export const marketingRouter = Router();
export const publicMarketingRouter = Router();

const MKT = [requireRole('marketing')];
const MKT_READ = [requireRole('marketing', 'super-admin', 'biz-mgr')];
const cc = z.enum(['ID', 'MY', 'BN']);
const ts = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => `${d}T00:00:00+07:00`));
const country = (v: unknown) => cc.catch('ID').parse(String(v ?? 'ID').toUpperCase());

// ---------------------------------------------------------------------------
// Kode promo
// ---------------------------------------------------------------------------
const promoSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Kode 3–32 huruf/angka tanpa spasi'), countryCode: cc, name: z.string().trim().min(3).max(120), description: z.string().trim().max(500).default(''),
  type: z.enum(['percent', 'amount']), value: z.number().positive(), maxDiscount: z.number().positive().nullish(), minPurchase: z.number().min(0).default(0),
  appliesTo: z.enum(['cash', 'credit', 'both']).default('both'), categoryIds: z.array(z.uuid()).default([]), productIds: z.array(z.uuid()).default([]),
  quota: z.number().int().positive().nullish(), perCustomer: z.number().int().min(1).max(100).default(1), startsAt: ts, endsAt: ts, isActive: z.boolean().default(true),
}).refine((p) => p.type !== 'percent' || p.value <= 90, { message: 'Potongan persen maksimal 90%', path: ['value'] })
  .refine((p) => new Date(p.endsAt) > new Date(p.startsAt), { message: 'Tanggal berakhir harus setelah tanggal mulai', path: ['endsAt'] });

marketingRouter.get('/marketing/promos', ...MKT_READ, async (req, res) => {
  const rows = await db.select({ p: promoCodes,
    used: sql<number>`(select count(*)::int from promo_redemptions r where r.promo_id = ${promoCodes.id} and r.status = 'active')`,
    discountTotal: sql<number>`(select coalesce(sum(r.discount),0)::float from promo_redemptions r where r.promo_id = ${promoCodes.id} and r.status = 'active')` })
    .from(promoCodes).where(eq(promoCodes.countryCode, country(req.query.country))).orderBy(desc(promoCodes.createdAt));
  res.json({ promos: rows.map((r) => ({ ...r.p, used: r.used, discountTotal: r.discountTotal })) });
});

marketingRouter.post('/marketing/promos', ...MKT, async (req, res) => {
  const b = parseBody(promoSchema, req.body);
  const [p] = await db.insert(promoCodes).values({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), createdBy: req.user!.id }).returning()
    .catch((e) => { if (String(e?.cause?.code ?? e?.code) === '23505') throw new HttpError(409, `Kode ${b.code} sudah ada untuk negara ini`); throw e; });
  await writeAudit(req, { action: 'promo.create', entityType: 'promo', entityId: p.id, after: p });
  res.status(201).json({ promo: p });
});

marketingRouter.put('/marketing/promos/:id', ...MKT, async (req, res) => {
  const b = parseBody(promoSchema, req.body);
  const id = z.uuid().parse(req.params.id);
  const [{ used }] = await db.select({ used: sql<number>`count(*)::int` }).from(promoRedemptions).where(and(eq(promoRedemptions.promoId, id), eq(promoRedemptions.status, 'active')));
  const [before] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
  if (!before) throw new HttpError(404, 'Promo tidak ditemukan');
  if (Number(used) > 0 && (before.code !== b.code || before.type !== b.type || before.value !== b.value)) throw new HttpError(409, 'Promo sudah dipakai — kode & nilai potongan tidak bisa diubah (buat promo baru)');
  const [p] = await db.update(promoCodes).set({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), updatedAt: new Date() }).where(eq(promoCodes.id, id)).returning();
  await writeAudit(req, { action: 'promo.update', entityType: 'promo', entityId: id, before, after: p });
  res.json({ promo: p });
});

// ---------------------------------------------------------------------------
// Banner & produk unggulan
// ---------------------------------------------------------------------------
const bannerSchema = z.object({
  countryCode: cc, title: z.partialRecord(z.enum(['id', 'ms', 'en']), z.string().trim().max(120)).refine((t) => Object.values(t).some((v) => v), 'Isi judul minimal satu bahasa'),
  subtitle: z.partialRecord(z.enum(['id', 'ms', 'en']), z.string().trim().max(240)).default({}), imageUrl: webUrl({ httpsOnly: true }).nullish().or(z.literal('').transform(() => null)),
  theme: z.enum(['emerald', 'gold', 'dark']).default('emerald'), linkType: z.enum(['none', 'product', 'category', 'promo', 'url']).default('none'), linkValue: z.string().trim().max(300).nullish(),
  sortOrder: z.number().int().default(0), startsAt: ts, endsAt: ts, isActive: z.boolean().default(true),
});

marketingRouter.get('/marketing/banners', ...MKT_READ, async (req, res) => {
  res.json({ banners: await db.select().from(banners).where(eq(banners.countryCode, country(req.query.country))).orderBy(asc(banners.sortOrder), desc(banners.createdAt)) });
});
marketingRouter.post('/marketing/banners', ...MKT, async (req, res) => {
  const b = parseBody(bannerSchema, req.body);
  const [r] = await db.insert(banners).values({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), createdBy: req.user!.id }).returning();
  res.status(201).json({ banner: r });
});
marketingRouter.put('/marketing/banners/:id', ...MKT, async (req, res) => {
  const b = parseBody(bannerSchema, req.body);
  const [r] = await db.update(banners).set({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) }).where(eq(banners.id, z.uuid().parse(req.params.id))).returning();
  if (!r) throw new HttpError(404, 'Banner tidak ditemukan');
  res.json({ banner: r });
});
marketingRouter.delete('/marketing/banners/:id', ...MKT, async (req, res) => {
  await db.update(banners).set({ isActive: false }).where(eq(banners.id, z.uuid().parse(req.params.id)));
  res.json({ ok: true });
});

marketingRouter.get('/marketing/featured', ...MKT_READ, async (req, res) => {
  const c = country(req.query.country);
  const rows = await db.select({ f: featuredProducts, name: products.name, sku: products.sku }).from(featuredProducts).innerJoin(products, eq(products.id, featuredProducts.productId))
    .where(eq(featuredProducts.countryCode, c)).orderBy(asc(featuredProducts.rank));
  res.json({ featured: rows.map((r) => ({ ...r.f, name: r.name, sku: r.sku })) });
});
marketingRouter.put('/marketing/featured', ...MKT, async (req, res) => {
  const b = parseBody(z.object({ countryCode: cc, items: z.array(z.object({ productId: z.uuid(), label: z.enum(['featured', 'promo', 'new', 'bestseller']).default('featured'), startsAt: ts.nullish(), endsAt: ts.nullish() })).max(24) }), req.body);
  await db.transaction(async (tx) => {
    await tx.delete(featuredProducts).where(eq(featuredProducts.countryCode, b.countryCode));
    if (b.items.length) await tx.insert(featuredProducts).values(b.items.map((i, k) => ({ countryCode: b.countryCode, productId: i.productId, rank: k, label: i.label, startsAt: i.startsAt ? new Date(i.startsAt) : null, endsAt: i.endsAt ? new Date(i.endsAt) : null })));
  });
  await writeAudit(req, { action: 'featured.update', entityType: 'featured', entityId: b.countryCode, after: b.items });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Kampanye
// ---------------------------------------------------------------------------
const segment = z.object({ type: z.enum(['all', 'buyers', 'active_credit', 'paid_off', 'branch']), branchId: z.uuid().nullish(), sinceDays: z.number().int().min(1).max(730).nullish() });
const campaignSchema = z.object({
  name: z.string().trim().min(3).max(120), countryCode: cc, channel: z.enum(['whatsapp', 'email', 'both']), segment, subject: z.string().trim().min(3).max(120),
  body: z.partialRecord(z.enum(['id', 'ms', 'en']), z.string().trim().max(1000)).refine((b) => Object.values(b).some((v) => v && v.length >= 10), 'Isi pesan minimal satu bahasa (≥10 karakter)'),
  promoId: z.uuid().nullish(), link: webUrl({ httpsOnly: true }).nullish().or(z.literal('').transform(() => null)), scheduledAt: ts.nullish(),
});

marketingRouter.get('/marketing/campaigns', ...MKT_READ, async (req, res) => {
  const rows = await db.select({ c: campaigns, promoCode: promoCodes.code,
    sent: sql<number>`(select count(*)::int from notification_outbox o where o.ref_type = 'campaign' and o.ref_id = ${campaigns.id}::text and o.status = 'sent')`,
    failed: sql<number>`(select count(*)::int from notification_outbox o where o.ref_type = 'campaign' and o.ref_id = ${campaigns.id}::text and o.status = 'failed')`,
    redemptions: sql<number>`(select count(*)::int from promo_redemptions r where r.campaign_id = ${campaigns.id} and r.status = 'active')` })
    .from(campaigns).leftJoin(promoCodes, eq(promoCodes.id, campaigns.promoId)).where(eq(campaigns.countryCode, country(req.query.country))).orderBy(desc(campaigns.createdAt)).limit(100);
  res.json({ campaigns: rows.map((r) => ({ ...r.c, promoCode: r.promoCode, sent: r.sent, failed: r.failed, redemptions: r.redemptions })) });
});

marketingRouter.post('/marketing/audience', ...MKT, async (req, res) => {
  const b = parseBody(z.object({ countryCode: cc, segment, channel: z.enum(['whatsapp', 'email', 'both']) }), req.body);
  res.json(await audienceCount(b.countryCode, b.segment, b.channel));
});

marketingRouter.post('/marketing/campaigns', ...MKT, async (req, res) => {
  const b = parseBody(campaignSchema, req.body);
  const [c] = await db.insert(campaigns).values({ ...b, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null, status: b.scheduledAt ? 'scheduled' : 'draft', createdBy: req.user!.id }).returning();
  await writeAudit(req, { action: 'campaign.create', entityType: 'campaign', entityId: c.id, after: c });
  res.status(201).json({ campaign: c });
});

marketingRouter.put('/marketing/campaigns/:id', ...MKT, async (req, res) => {
  const b = parseBody(campaignSchema, req.body);
  const [c] = await db.update(campaigns).set({ ...b, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null, status: b.scheduledAt ? 'scheduled' : 'draft', updatedAt: new Date() })
    .where(and(eq(campaigns.id, z.uuid().parse(req.params.id)), sql`${campaigns.status} in ('draft','scheduled')`)).returning();
  if (!c) throw new HttpError(409, 'Kampanye sudah dikirim / dibatalkan');
  res.json({ campaign: c });
});

marketingRouter.post('/marketing/campaigns/:id/send', ...MKT, async (req, res) => {
  const c = await sendCampaign(z.uuid().parse(req.params.id));
  await writeAudit(req, { action: 'campaign.send', entityType: 'campaign', entityId: c.id, after: { recipients: c.recipients, skipped: c.skipped } });
  res.json({ campaign: c });
});

marketingRouter.post('/marketing/campaigns/:id/cancel', ...MKT, async (req, res) => {
  const [c] = await db.update(campaigns).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(campaigns.id, z.uuid().parse(req.params.id)), sql`${campaigns.status} in ('draft','scheduled')`)).returning();
  if (!c) throw new HttpError(409, 'Kampanye sudah dikirim / dibatalkan');
  res.json({ campaign: c });
});

// ---------------------------------------------------------------------------
// Laporan efektivitas
// ---------------------------------------------------------------------------
marketingRouter.get('/marketing/report', ...MKT_READ, async (req, res) => {
  const c = country(req.query.country);
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : new Date().toISOString().slice(0, 10);
  const { rows: promos } = await db.execute<{ id: string; code: string; name: string; uses: number; orders: number; credits: number; discount: number; order_revenue: number; credit_value: number; converted_credits: number }>(sql`
    select p.id, p.code, p.name,
      count(r.id)::int uses,
      count(r.id) filter (where r.source_type = 'order')::int orders,
      count(r.id) filter (where r.source_type = 'credit')::int credits,
      coalesce(sum(r.discount),0)::float discount,
      coalesce(sum(o.total) filter (where o.status in ('fulfilling','completed')),0)::float order_revenue,
      coalesce(sum(a.sale_price + coalesce(a.down_payment,0)) filter (where a.status in ('contracted','active','paid_off')),0)::float credit_value,
      count(a.id) filter (where a.status in ('contracted','active','paid_off'))::int converted_credits
    from promo_codes p
    left join promo_redemptions r on r.promo_id = p.id and r.status = 'active' and (r.created_at at time zone 'Asia/Jakarta')::date between ${from}::date and ${to}::date
    left join orders o on r.source_type = 'order' and o.id = r.source_id
    left join credit_applications a on r.source_type = 'credit' and a.id = r.source_id
    where p.country_code = ${c} group by p.id order by uses desc, p.created_at desc`);
  const { rows: [opt] } = await db.execute<{ opted: number; total: number }>(sql`
    select count(*) filter (where c.marketing_opt_in)::int opted, count(*)::int total from customers c
    where c.branch_id in (select id from branches where country_code = ${c})`);
  const { rows: camps } = await db.execute<{ id: string; name: string; sent_at: string | null; recipients: number; delivered: number; failed: number; redemptions: number; revenue: number }>(sql`
    select k.id, k.name, k.sent_at, k.recipients,
      (select count(*)::int from notification_outbox o where o.ref_type = 'campaign' and o.ref_id = k.id::text and o.status = 'sent') delivered,
      (select count(*)::int from notification_outbox o where o.ref_type = 'campaign' and o.ref_id = k.id::text and o.status = 'failed') failed,
      (select count(*)::int from promo_redemptions r where r.campaign_id = k.id and r.status = 'active') redemptions,
      (select coalesce(sum(o.total),0)::float from promo_redemptions r join orders o on o.id = r.source_id where r.campaign_id = k.id and r.status = 'active' and r.source_type = 'order' and o.status in ('fulfilling','completed')) revenue
    from campaigns k where k.country_code = ${c} and k.status = 'sent' and (k.sent_at at time zone 'Asia/Jakarta')::date between ${from}::date and ${to}::date order by k.sent_at desc`);
  res.json({ country: c, currency: CURRENCY[c], from, to, promos, optIn: opt, campaigns: camps });
});

// ---------------------------------------------------------------------------
// Publik: banner aktif, cek kode promo, berhenti berlangganan
// ---------------------------------------------------------------------------
publicMarketingRouter.get('/public/banners', async (req, res) => {
  const c = country(req.query.country);
  const now = new Date();
  const rows = await db.select().from(banners).where(and(eq(banners.countryCode, c), eq(banners.isActive, true), lte(banners.startsAt, now), gte(banners.endsAt, now))).orderBy(asc(banners.sortOrder)).limit(6);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ banners: rows.map(({ createdBy: _c, ...b }) => b) });
});

publicMarketingRouter.post('/public/promo/check', rateLimit('promo-check', 30, 600), async (req, res) => {
  const b = parseBody(z.object({ code: z.string().trim().min(3).max(32), country: cc, channel: z.enum(['cash', 'credit']), phone: z.string().trim().max(32).nullish(),
    items: z.array(z.object({ productId: z.uuid(), qty: z.number().int().min(1).max(20) })).min(1).max(30) }), req.body);
  const prices = await db.select({ id: productPrices.productId, price: productPrices.cashPrice }).from(productPrices).where(eq(productPrices.countryCode, b.country));
  const lines = b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: prices.find((p) => p.id === i.productId)?.price ?? 0 }));
  const r = await evaluatePromo(db, { code: b.code, country: b.country, currency: CURRENCY[b.country], phone: b.phone ? e164(b.phone, b.country) : null, channel: b.channel, lines });
  res.json({ code: r.promo.code, name: r.promo.name, discount: r.discount, description: r.promo.description });
});

const unsubPage = (body: string) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Masri-M</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#0f172a"><h2 style="color:#047857">Masri-M Syariah</h2>${body}</body></html>`;
const escHtml = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// GET hanya menampilkan konfirmasi: pratinjau tautan oleh WhatsApp / email tidak boleh membatalkan langganan
publicMarketingRouter.get('/public/unsubscribe', async (req, res) => {
  const id = z.uuid().safeParse(req.query.c);
  const t = typeof req.query.t === 'string' ? req.query.t : '';
  res.set('Cache-Control', 'no-store');
  if (!id.success || !verifyUnsubscribe(id.data, t)) { res.status(400).type('html').send(unsubPage('<p>Tautan tidak valid.</p>')); return; }
  res.type('html').send(unsubPage(`<p>Berhenti menerima pesan promo dari Masri-M? Pemberitahuan transaksi (tagihan, pengiriman) tetap dikirim.<br><small>Stop receiving Masri-M offers?</small></p>
<form method="post" action="unsubscribe"><input type="hidden" name="c" value="${escHtml(id.data)}"><input type="hidden" name="t" value="${escHtml(t)}">
<button type="submit" style="background:#047857;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer">Ya, berhenti berlangganan</button></form>`));
});

publicMarketingRouter.post('/public/unsubscribe', express.urlencoded({ extended: false, limit: '2kb' }), rateLimit('unsubscribe', 20, 600), async (req, res) => {
  const id = z.uuid().safeParse(req.body?.c);
  const t = typeof req.body?.t === 'string' ? req.body.t : '';
  res.set('Cache-Control', 'no-store');
  if (!id.success || !verifyUnsubscribe(id.data, t)) { res.status(400).type('html').send(unsubPage('<p>Tautan tidak valid.</p>')); return; }
  await db.transaction((tx) => setMarketingOptIn(tx, id.data, false, { ip: clientIp(req), userAgent: req.get('user-agent') ?? null }));
  res.type('html').send(unsubPage('<p>Anda sudah berhenti menerima pesan promo dari Masri-M. Pemberitahuan transaksi (tagihan, pengiriman) tetap dikirim. / You have been unsubscribed from Masri-M offers.</p>'));
});
