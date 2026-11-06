import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, consents, customers, notificationOutbox, products, promoCodes, promoRedemptions } from '../db/schema.js';
import { HttpError } from './http.js';
import { env } from '../env.js';
import { getConfig } from './config.js';
import { e164, phoneMatch, SUPPORTED } from './region.js';
import { logger } from './logger.js';
import type { Tx } from './stock.js';

/**
 * Marketing: kode promo, opt-in pemasaran, kampanye WhatsApp/email.
 * Prinsip syariah: potongan harga ditetapkan & disepakati SEBELUM akad (mengurangi harga barang), bukan potongan
 * atas angsuran berjalan; tidak ada hadiah undian. Promo hanya dikirim ke nasabah yang memberi persetujuan.
 */
type Db = Tx | typeof db;
const r2 = (v: number) => Math.round(v * 100) / 100;
const UNIT: Record<string, number> = { IDR: 100, MYR: 0.01, BND: 0.01 };
const floorTo = (v: number, cur: string) => { const u = UNIT[cur] ?? 0.01; return r2(Math.floor(v / u + 1e-9) * u); };

export interface PromoLine { productId: string; qty: number; unitPrice: number }
export type PromoChannel = 'cash' | 'credit';

/** Validasi kode promo & hitung potongan. Melempar 400/409 dengan pesan yang bisa ditampilkan ke nasabah. */
export async function evaluatePromo(tx: Db, p: { code: string; country: string; currency: string; phone: string | null; channel: PromoChannel; lines: PromoLine[] }) {
  const code = p.code.trim().toUpperCase();
  const [promo] = await tx.select().from(promoCodes).where(and(eq(promoCodes.code, code), eq(promoCodes.countryCode, p.country))).limit(1);
  const now = new Date();
  if (!promo || !promo.isActive) throw new HttpError(400, 'Kode promo tidak ditemukan');
  if (promo.startsAt > now) throw new HttpError(400, 'Kode promo belum berlaku');
  if (promo.endsAt < now) throw new HttpError(400, 'Kode promo sudah berakhir');
  if (promo.appliesTo !== 'both' && promo.appliesTo !== p.channel) throw new HttpError(400, promo.appliesTo === 'cash' ? 'Kode promo ini hanya untuk pembelian tunai' : 'Kode promo ini hanya untuk pengajuan cicilan');
  let eligible = p.lines;
  if (promo.productIds.length || promo.categoryIds.length) {
    const rows = await tx.select({ id: products.id, cat: products.categoryId }).from(products).where(inArray(products.id, p.lines.map((l) => l.productId)));
    eligible = p.lines.filter((l) => { const r = rows.find((x) => x.id === l.productId); return r && (promo.productIds.includes(r.id) || promo.categoryIds.includes(r.cat)); });
    if (!eligible.length) throw new HttpError(400, 'Kode promo tidak berlaku untuk barang ini');
  }
  const base = r2(eligible.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  if (base < promo.minPurchase) throw new HttpError(400, `Minimal pembelian ${promo.minPurchase.toLocaleString('id-ID')} untuk kode ini`);
  const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(promoRedemptions).where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.status, 'active')));
  if (promo.quota != null && Number(used) >= promo.quota) throw new HttpError(409, 'Kuota kode promo sudah habis');
  if (p.phone) {
    const [{ mine }] = await tx.select({ mine: sql<number>`count(*)::int` }).from(promoRedemptions)
      .where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.status, 'active'), phoneMatch(promoRedemptions.phone, p.phone)));
    if (Number(mine) >= promo.perCustomer) throw new HttpError(409, 'Kode promo ini sudah Anda gunakan');
  }
  let discount = promo.type === 'percent' ? base * promo.value / 100 : promo.value;
  if (promo.maxDiscount != null) discount = Math.min(discount, promo.maxDiscount);
  discount = floorTo(Math.min(discount, base), p.currency);
  if (discount <= 0) throw new HttpError(400, 'Kode promo tidak memberi potongan untuk transaksi ini');
  return { promo, discount, eligibleBase: base };
}

export async function redeemPromo(tx: Tx, p: { promoId: string; phone: string; sourceType: 'order' | 'credit'; sourceId: string; sourceNo: string; discount: number }) {
  // Kunci baris promo lalu hitung ulang kuota di dalam transaksi: checkout bersamaan tidak bisa melampaui kuota / batas per nasabah
  const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.id, p.promoId)).for('update').limit(1);
  if (!promo || !promo.isActive) throw new HttpError(409, 'Kode promo tidak berlaku');
  const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(promoRedemptions).where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.status, 'active')));
  if (promo.quota != null && Number(used) >= promo.quota) throw new HttpError(409, 'Kuota kode promo sudah habis');
  const [{ mine }] = await tx.select({ mine: sql<number>`count(*)::int` }).from(promoRedemptions)
    .where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.status, 'active'), phoneMatch(promoRedemptions.phone, p.phone)));
  if (Number(mine) >= promo.perCustomer) throw new HttpError(409, 'Kode promo ini sudah Anda gunakan');
  // Kampanye yang membawa kode ini dalam 14 hari terakhir (atribusi laporan)
  const [c] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.promoId, p.promoId), eq(campaigns.status, 'sent'), sql`${campaigns.sentAt} > now() - interval '14 days'`)).orderBy(desc(campaigns.sentAt)).limit(1);
  await tx.insert(promoRedemptions).values({ ...p, campaignId: c?.id ?? null });
}

/** Batalkan pemakaian promo (order kedaluwarsa / dibatalkan, pengajuan ditolak / batal) agar kuota kembali. */
export async function voidPromo(tx: Db, sourceType: 'order' | 'credit', sourceId: string) {
  await tx.update(promoRedemptions).set({ status: 'void' }).where(and(eq(promoRedemptions.sourceType, sourceType), eq(promoRedemptions.sourceId, sourceId)));
}

// ---------------------------------------------------------------------------
// Persetujuan pemasaran (opt-in) & berhenti berlangganan
// ---------------------------------------------------------------------------
export async function setMarketingOptIn(tx: Db, customerId: string, optIn: boolean, meta: { ip?: string | null; userAgent?: string | null; phone?: string | null; country?: string | null; lang?: string | null }) {
  const [c] = await tx.select({ optIn: customers.marketingOptIn, phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c || c.optIn === optIn) return;
  await tx.update(customers).set({ marketingOptIn: optIn, marketingOptInAt: optIn ? new Date() : null }).where(eq(customers.id, customerId));
  await tx.insert(consents).values({ subjectType: 'customer', subjectId: customerId, phone: meta.phone ?? c.phone, document: optIn ? 'marketing' : 'marketing_withdrawn', version: 'marketing-1',
    lang: meta.lang ?? null, countryCode: meta.country ?? null, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 400) ?? null });
}

export const unsubscribeToken = (customerId: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(`unsub:${customerId}`).digest('hex').slice(0, 32);
export const verifyUnsubscribe = (customerId: string, token: string) => {
  const want = Buffer.from(unsubscribeToken(customerId)), got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};
const apiUrl = () => (process.env.API_PUBLIC_URL || process.env.PUBLIC_WEB_URL || 'http://localhost:4000').replace(/\/$/, '');
export const unsubscribeLink = (customerId: string) => `${apiUrl()}/api/public/unsubscribe?c=${customerId}&t=${unsubscribeToken(customerId)}`;

// ---------------------------------------------------------------------------
// Kampanye
// ---------------------------------------------------------------------------
type Segment = typeof campaigns.$inferSelect['segment'];

/** Penerima kampanye: hanya nasabah opt-in di negara kampanye, sesuai segmen. */
function audienceSql(country: string, seg: Segment) {
  const dial = { ID: '62', MY: '60', BN: '673' }[country] ?? '62';
  const since = seg.sinceDays ? sql`and o.created_at > now() - (${seg.sinceDays} || ' days')::interval` : sql``;
  const segCond =
    seg.type === 'buyers' ? sql`and exists (select 1 from orders o where o.customer_id = c.id and o.status in ('fulfilling','completed') ${since})`
    : seg.type === 'active_credit' ? sql`and exists (select 1 from credit_applications a where a.customer_id = c.id and a.status = 'active')`
    : seg.type === 'paid_off' ? sql`and exists (select 1 from credit_applications a where a.customer_id = c.id and a.status = 'paid_off')`
    : seg.type === 'branch' && seg.branchId ? sql`and c.branch_id = ${seg.branchId}`
    : sql``;
  return sql`select c.id, c.full_name, c.phone, c.email, c.lang, c.last_promo_at from customers c
    where c.marketing_opt_in and (regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g') like ${dial + '%'} or c.branch_id in (select id from branches where country_code = ${country})) ${segCond}`;
}

export async function audienceCount(country: string, seg: Segment, channel: string) {
  const days = Number(await getConfig<number>('marketing.min_days_between', country)) || 3;
  const { rows: [r] } = await db.execute<{ total: number; reachable: number; capped: number }>(sql`
    with a as (${audienceSql(country, seg)})
    select count(*)::int total,
      count(*) filter (where ${channel === 'email' ? sql`a.email is not null` : channel === 'whatsapp' ? sql`a.phone is not null` : sql`(a.phone is not null or a.email is not null)`})::int reachable,
      count(*) filter (where a.last_promo_at > now() - (${days} || ' days')::interval)::int capped from a`);
  return { optedIn: Number(r.total), reachable: Number(r.reachable), frequencyCapped: Number(r.capped), minDaysBetween: days };
}

export async function sendCampaign(id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new HttpError(404, 'Kampanye tidak ditemukan');
  if (!['draft', 'scheduled'].includes(c.status)) throw new HttpError(409, 'Kampanye sudah dikirim / dibatalkan');
  const [locked] = await db.update(campaigns).set({ status: 'sending', updatedAt: new Date() }).where(and(eq(campaigns.id, id), inArray(campaigns.status, ['draft', 'scheduled']))).returning();
  if (!locked) return c;
  const days = Number(await getConfig<number>('marketing.min_days_between', c.countryCode)) || 3;
  const [promo] = c.promoId ? await db.select().from(promoCodes).where(eq(promoCodes.id, c.promoId)).limit(1) : [];
  const { rows } = await db.execute<{ id: string; full_name: string; phone: string | null; email: string | null; lang: string | null; last_promo_at: string | null }>(audienceSql(c.countryCode, c.segment));
  const defLang = c.countryCode === 'ID' ? 'id' : 'ms';
  let sent = 0, skipped = 0;
  try {
  for (const r of rows) {
    if (r.last_promo_at && Date.parse(r.last_promo_at) > Date.now() - days * 86400_000) { skipped++; continue; }
    const lang = (r.lang && c.body[r.lang] ? r.lang : c.body[defLang] ? defLang : Object.keys(c.body)[0]) as 'id' | 'ms' | 'en';
    const body = (c.body[lang] ?? '').replace(/\{nama\}|\{name\}/gi, r.full_name).replace(/\{kode\}|\{code\}/gi, promo?.code ?? '');
    const unsub = unsubscribeLink(r.id);
    const hi = 'Assalamualaikum ' + r.full_name + ',\n';
    const foot = { id: `\n\nBerhenti menerima promo: ${unsub}`, ms: `\n\nBerhenti menerima promosi: ${unsub}`, en: `\n\nUnsubscribe: ${unsub}` }[lang];
    const text = `${hi}${body}${c.link ? `\n\n${c.link}` : ''}${foot}\n\nMasri-M Syariah`;
    const values: (typeof notificationOutbox.$inferInsert)[] = [];
    if (r.phone && c.channel !== 'email') values.push({ channel: 'whatsapp', recipient: `+${e164(r.phone, c.countryCode)}`, template: 'promo', subject: c.subject, body: text, refType: 'campaign', refId: c.id, dedupeKey: `campaign:${c.id}:${r.id}:wa` });
    if (r.email && c.channel !== 'whatsapp') values.push({ channel: 'email', recipient: r.email, template: 'promo', subject: c.subject, body: text, refType: 'campaign', refId: c.id, dedupeKey: `campaign:${c.id}:${r.id}:em` });
    if (!values.length) { skipped++; continue; }
    await db.transaction(async (tx) => {
      await tx.insert(notificationOutbox).values(values).onConflictDoNothing();
      await tx.update(customers).set({ lastPromoAt: new Date() }).where(eq(customers.id, r.id));
    });
    sent++;
  }
  } catch (e) {
    // Gagal di tengah: yang sudah diantrikan tetap tercatat; bila belum ada, kembalikan ke status semula agar bisa dikirim ulang
    await db.update(campaigns).set(sent ? { status: 'sent', sentAt: new Date(), recipients: sent, skipped, updatedAt: new Date() } : { status: c.status, updatedAt: new Date() }).where(eq(campaigns.id, id));
    throw e;
  }
  const [after] = await db.update(campaigns).set({ status: 'sent', sentAt: new Date(), recipients: sent, skipped, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning();
  logger.info('marketing', `kampanye ${c.name} dikirim`, { recipients: sent, skipped });
  return after;
}

/** Kirim kampanye terjadwal yang sudah waktunya (dipanggil tugas berkala). */
export async function runScheduledCampaigns() {
  const due = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.status, 'scheduled'), sql`${campaigns.scheduledAt} <= now()`));
  for (const c of due) await sendCampaign(c.id);
  return due.length;
}

export { SUPPORTED };
