import { contractDoc } from '../lib/contract.js';
import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, creditApplications, creditEvents, creditHqVotes, creditSurveys, customers, installments, products, users,
} from '../db/schema.js';
import { HttpError, parseBody, webUrl } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import {
  KYC_ITEMS, OPEN_STATUSES, assignAo, creditDeliveryQuote, branchReview, cancelApplication, computeTerms, dsr, getAppForUser, handover, hqDecide,
  recommend, saveKyc, saveSurvey, scopeFilter, signContract, reissueDownPayment, submitApplication,
} from '../lib/credit.js';
import { dpDueInfo } from './public-credit.js';
import { getConfig } from '../lib/config.js';
import { branchCountry } from '../lib/region.js';

export const creditRouter = Router();
creditRouter.use(requireRole('ao', 'branch-manager', 'branch-admin', 'biz-mgr', 'super-admin', 'support'));

const ao = aliasedTable(users, 'ao');
const STATUSES = ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted', 'active', 'paid_off', 'rejected', 'cancelled'] as const;

// ---------------------------------------------------------------------------
// Daftar & detail
// ---------------------------------------------------------------------------
creditRouter.get('/applications', async (req, res) => {
  const q = parseBody(z.object({
    status: z.union([z.enum(STATUSES), z.literal('open')]).optional(),
    statuses: z.string().optional(), // dipisah koma
    branchId: z.uuid().optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }), req.query);
  const where: SQL[] = [];
  const scope = scopeFilter(req.user!);
  if (scope) where.push(scope);
  if (q.status === 'open') where.push(inArray(creditApplications.status, OPEN_STATUSES));
  else if (q.status) where.push(eq(creditApplications.status, q.status));
  if (q.statuses) where.push(inArray(creditApplications.status, q.statuses.split(',').filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s))));
  if (q.branchId) where.push(eq(creditApplications.branchId, q.branchId));
  if (q.search) {
    const s = `%${q.search}%`;
    where.push(or(ilike(creditApplications.appNo, s), ilike(customers.fullName, s), ilike(customers.phone, s), ilike(customers.nik, s), ilike(products.name, s))!);
  }
  const cond = where.length ? and(...where) : undefined;
  const base = () => db.select({
    id: creditApplications.id, appNo: creditApplications.appNo, status: creditApplications.status, channel: creditApplications.channel,
    cashPrice: creditApplications.cashPrice, currency: creditApplications.currency, requestedTenor: creditApplications.requestedTenor,
    tenor: creditApplications.tenor, monthly: creditApplications.monthly, financed: creditApplications.financed,
    requiresCommittee: creditApplications.requiresCommittee, aoRecommendation: creditApplications.aoRecommendation,
    createdAt: creditApplications.createdAt, updatedAt: creditApplications.updatedAt,
    customerName: customers.fullName, customerPhone: customers.phone, productName: products.name, qty: creditApplications.qty,
    branchId: creditApplications.branchId, branchName: branches.name, branchCode: branches.code, aoName: ao.fullName,
  }).from(creditApplications)
    .innerJoin(customers, eq(customers.id, creditApplications.customerId))
    .innerJoin(products, eq(products.id, creditApplications.productId))
    .innerJoin(branches, eq(branches.id, creditApplications.branchId))
    .leftJoin(ao, eq(ao.id, creditApplications.aoId));
  const [rows, [{ total }]] = await Promise.all([
    base().where(cond).orderBy(desc(creditApplications.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(creditApplications)
      .innerJoin(customers, eq(customers.id, creditApplications.customerId))
      .innerJoin(products, eq(products.id, creditApplications.productId)).where(cond),
  ]);
  res.json({ applications: rows, total, page: q.page, pageSize: q.pageSize });
});

creditRouter.get('/applications/:id', async (req, res) => {
  const a = await getAppForUser(req.user!, z.uuid().parse(req.params.id));
  const [[c], [p], [b], aoUser, [survey], votes, events, schedule, maxDsr] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, a.customerId)),
    db.select({ id: products.id, sku: products.sku, name: products.name, brand: products.brand, images: products.images }).from(products).where(eq(products.id, a.productId)),
    db.select({ id: branches.id, code: branches.code, name: branches.name, city: branches.city }).from(branches).where(eq(branches.id, a.branchId)),
    a.aoId ? db.select({ id: users.id, fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, a.aoId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    db.select().from(creditSurveys).where(eq(creditSurveys.applicationId, a.id)),
    db.select({ userId: creditHqVotes.userId, fullName: users.fullName, decision: creditHqVotes.decision, notes: creditHqVotes.notes, createdAt: creditHqVotes.createdAt })
      .from(creditHqVotes).innerJoin(users, eq(users.id, creditHqVotes.userId)).where(eq(creditHqVotes.applicationId, a.id)),
    db.select().from(creditEvents).where(eq(creditEvents.applicationId, a.id)).orderBy(asc(creditEvents.id)),
    db.select().from(installments).where(eq(installments.applicationId, a.id)).orderBy(asc(installments.seq)),
    getConfig<number>('credit.max_dsr_pct', await branchCountry(a.branchId)),
  ]);
  // Simulasi syarat yang sedang dibahas (final bila sudah disetujui)
  const tenor = a.tenor ?? a.aoSuggestedTenor ?? a.requestedTenor;
  const dpPct = a.dpPct ?? a.aoSuggestedDpPct ?? a.requestedDpPct;
  let preview = null;
  try { preview = await computeTerms(a.cashPrice, tenor, dpPct, await branchCountry(a.branchId)); } catch { /* parameter berubah */ }
  const monthly = a.monthly ?? preview?.monthly ?? 0;
  const income = survey?.verifiedIncome ?? c.monthlyIncome ?? 0;
  const fulfill = a.fulfillBranchId ? (await db.select({ name: branches.name }).from(branches).where(eq(branches.id, a.fulfillBranchId)))[0]?.name : null;
  res.json({
    application: { ...a, fulfillBranchName: fulfill ?? null },
    dpDue: await dpDueInfo(a),
    customer: c, product: p, branch: b, ao: aoUser, survey: survey ?? null, votes, events, installments: schedule,
    kycItems: KYC_ITEMS,
    analysis: { preview, dsr: dsr(monthly, income, survey?.otherObligations ?? 0), maxDsr: Number(maxDsr), income },
  });
});

creditRouter.get('/preview', async (req, res) => {
  const q = parseBody(z.object({ cashPrice: z.coerce.number().positive(), tenor: z.coerce.number().int().min(1).max(120), dpPct: z.coerce.number().min(0).max(90) }), req.query);
  res.json({ terms: await computeTerms(q.cashPrice, q.tenor, q.dpPct, await branchCountry(req.user!.branch?.id)) });
});

// ---------------------------------------------------------------------------
// Aksi alur kerja
// ---------------------------------------------------------------------------
export const submitSchema = z.object({
  customer: z.object({
    fullName: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
    phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, 'Format nomor HP tidak valid'),
    email: z.email('Format email tidak valid').nullish().or(z.literal('').transform(() => null)),
    nik: z.string().trim().regex(/^[0-9A-Za-z-]{7,20}$/, 'No. identitas (NIK) tidak valid'),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal lahir tidak valid'),
    city: z.string().trim().min(2, 'Kota wajib diisi').max(80),
    address: z.string().trim().min(10, 'Alamat minimal 10 karakter').max(300),
    occupation: z.string().trim().min(2, 'Pekerjaan wajib diisi').max(80),
    employer: z.string().trim().max(120).nullish(),
    monthlyIncome: z.number().positive('Penghasilan wajib diisi'),
    maritalStatus: z.enum(['single', 'married', 'widowed']).nullish(),
    dependents: z.number().int().min(0).max(20).nullish(),
  }),
  branchId: z.uuid('Pilih cabang'),
  productId: z.uuid('Pilih produk'),
  qty: z.number().int().min(1).max(5).default(1),
  tenor: z.number().int().positive(),
  dpPct: z.number().min(0).max(90),
  purpose: z.string().trim().max(300).nullish(),
  promoCode: z.string().trim().toUpperCase().max(32).nullish().or(z.literal('').transform(() => null)),
  marketingOptIn: z.boolean().default(false),
});

creditRouter.post('/applications', async (req, res) => {
  const body = parseBody(submitSchema, req.body);
  res.status(201).json(await submitApplication(req.user!, body));
});

const id = (raw: unknown) => z.uuid().parse(raw);
const notes = (label: string) => z.string().trim().min(3, `${label} minimal 3 karakter`).max(2000);

creditRouter.post('/applications/:id/assign', async (req, res) => {
  const { aoId } = parseBody(z.object({ aoId: z.uuid('Pilih AO') }), req.body);
  res.json({ application: await assignAo(req.user!, id(req.params.id), aoId) });
});

creditRouter.put('/applications/:id/kyc', async (req, res) => {
  const { checklist } = parseBody(z.object({ checklist: z.record(z.string(), z.object({ ok: z.boolean(), note: z.string().max(300).optional() })) }), req.body);
  res.json({ application: await saveKyc(req.user!, id(req.params.id), checklist) });
});

creditRouter.put('/applications/:id/survey', async (req, res) => {
  const s = parseBody(z.object({
    visitedAt: z.string().min(10, 'Isi tanggal kunjungan'),
    addressVerified: z.boolean(), residenceStatus: z.enum(['own', 'family', 'rent', 'official']),
    lengthOfStayYears: z.number().int().min(0).max(80), incomeVerified: z.boolean(),
    verifiedIncome: z.number().min(0), otherObligations: z.number().min(0).default(0),
    characterScore: z.number().int().min(1).max(5), photos: z.array(webUrl()).max(10).default([]), notes: z.string().max(2000).nullish(),
  }), req.body);
  await saveSurvey(req.user!, id(req.params.id), s);
  res.json({ ok: true });
});

creditRouter.post('/applications/:id/recommend', async (req, res) => {
  const r = parseBody(z.object({ recommendation: z.enum(['approve', 'reject']), tenor: z.number().int().min(1).max(120), dpPct: z.number().min(0).max(90), notes: notes('Analisa') }), req.body);
  res.json({ application: await recommend(req.user!, id(req.params.id), r) });
});

creditRouter.post('/applications/:id/branch-review', async (req, res) => {
  const r = parseBody(z.object({ decision: z.enum(['forward', 'return', 'reject']), notes: notes('Catatan') }), req.body);
  res.json({ application: await branchReview(req.user!, id(req.params.id), r.decision, r.notes) });
});

creditRouter.post('/applications/:id/decide', async (req, res) => {
  const d = parseBody(z.object({ decision: z.enum(['approve', 'reject', 'return']), notes: notes('Catatan keputusan'), tenor: z.number().int().min(1).max(120).optional(), dpPct: z.number().min(0).max(90).optional() }), req.body);
  res.json(await hqDecide(req.user!, id(req.params.id), d));
});

creditRouter.post('/applications/:id/contract', async (req, res) => {
  const p = parseBody(z.object({
    dpChannel: z.enum(['cashier', 'va', 'qris', 'fpx']).default('cashier'), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish(),
    delivery: z.object({
      mode: z.enum(['internal', 'partner', 'pickup']), address: z.string().trim().max(300).default(''), city: z.string().trim().min(2, 'Kota tujuan wajib diisi'),
      postalCode: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{4,8}$/, 'Kode pos tidak valid').nullish().or(z.literal('').transform(() => null)), courierCode: z.string().nullish(), service: z.string().nullish(),
    }),
  }), req.body);
  res.json({ application: await signContract(req.user!, id(req.params.id), p) });
});

/** Terbitkan ulang tagihan uang muka (ganti metode / kedaluwarsa). */
creditRouter.post('/applications/:id/dp-charge', async (req, res) => {
  const p = parseBody(z.object({ channel: z.enum(['cashier', 'va', 'qris', 'fpx']), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish() }), req.body);
  res.status(201).json({ payment: await reissueDownPayment(req.user!, id(req.params.id), p.channel, p.bank ?? null) });
});

creditRouter.get('/applications/:id/contract-doc', async (req, res) => {
  const a = await getAppForUser(req.user!, id(req.params.id));
  res.json({ doc: await contractDoc(a.id, { maskNik: false, lang: typeof req.query.lang === 'string' ? req.query.lang : null }) });
});

creditRouter.get('/applications/:id/delivery-quote', async (req, res) => {
  const a = await getAppForUser(req.user!, id(req.params.id));
  const city = z.string().trim().min(2, 'Isi kota tujuan').parse(req.query.city);
  const postal = z.string().trim().regex(/^\d{5}$/).optional().catch(undefined).parse(req.query.postalCode || undefined);
  res.json(await creditDeliveryQuote(a, city, postal));
});

creditRouter.post('/applications/:id/handover', async (req, res) => {
  const p = parseBody(z.object({ method: z.enum(['pickup', 'internal', 'partner']), note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ application: await handover(req.user!, id(req.params.id), p) });
});

creditRouter.post('/applications/:id/cancel', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: notes('Alasan') }), req.body);
  res.json({ application: await cancelApplication(req.user!, id(req.params.id), reason) });
});

// ---------------------------------------------------------------------------
// Tim AO (Manager Cabang) & ringkasan pipeline
// ---------------------------------------------------------------------------
creditRouter.get('/ao-team', async (req, res) => {
  const u = req.user!;
  // Staf cabang hanya melihat tim cabangnya; Pusat boleh memilih cabang
  const branchId = u.branch?.type === 'branch' ? u.branch.id : parseBody(z.object({ branchId: z.uuid().optional() }), req.query).branchId;
  if (!branchId) throw new HttpError(400, 'Pilih cabang');
  const rows = await db.select({
    id: users.id, fullName: users.fullName, email: users.email, phone: users.phone, status: users.status, lastLoginAt: users.lastLoginAt,
    open: sql<number>`(select count(*)::int from credit_applications c where c.ao_id = "users"."id" and c.status in ('assigned','branch_review','hq_review','approved','contracted'))`,
    needsAction: sql<number>`(select count(*)::int from credit_applications c where c.ao_id = "users"."id" and c.status = 'assigned')`,
    active: sql<number>`(select count(*)::int from credit_applications c where c.ao_id = "users"."id" and c.status = 'active')`,
    approved30d: sql<number>`(select count(*)::int from credit_applications c where c.ao_id = "users"."id" and c.decided_at > now() - interval '30 days' and c.status in ('approved','contracted','active','paid_off'))`,
    rejected30d: sql<number>`(select count(*)::int from credit_applications c where c.ao_id = "users"."id" and c.updated_at > now() - interval '30 days' and c.status = 'rejected')`,
  }).from(users).where(and(eq(users.roleCode, 'ao'), eq(users.branchId, branchId))).orderBy(asc(users.fullName));
  res.json({ team: rows });
});

creditRouter.get('/summary', async (req, res) => {
  const scope = scopeFilter(req.user!);
  const [byStatus, byBranch, [kpi]] = await Promise.all([
    db.select({ status: creditApplications.status, n: count(), amount: sql<number>`coalesce(sum(coalesce(${creditApplications.financed}, ${creditApplications.cashPrice})),0)::float` })
      .from(creditApplications).where(scope).groupBy(creditApplications.status),
    db.select({
      branchId: branches.id, branchCode: branches.code, branchName: branches.name,
      submitted: sql<number>`count(*) filter (where ${creditApplications.status} in ('submitted','assigned'))::int`,
      branchReview: sql<number>`count(*) filter (where ${creditApplications.status} = 'branch_review')::int`,
      hqReview: sql<number>`count(*) filter (where ${creditApplications.status} = 'hq_review')::int`,
      approved: sql<number>`count(*) filter (where ${creditApplications.status} in ('approved','contracted'))::int`,
      active: sql<number>`count(*) filter (where ${creditApplications.status} = 'active')::int`,
      activeFinanced: sql<number>`coalesce(sum(${creditApplications.salePrice}) filter (where ${creditApplications.status} = 'active'),0)::float`,
      rejected: sql<number>`count(*) filter (where ${creditApplications.status} = 'rejected')::int`,
    }).from(creditApplications).innerJoin(branches, eq(branches.id, creditApplications.branchId))
      .where(scope).groupBy(branches.id).orderBy(asc(branches.code)),
    db.select({
      decided30d: sql<number>`count(*) filter (where ${creditApplications.decidedAt} > now() - interval '30 days')::int`,
      approved30d: sql<number>`count(*) filter (where ${creditApplications.decidedAt} > now() - interval '30 days' and ${creditApplications.status} in ('approved','contracted','active','paid_off'))::int`,
      avgDaysToDecision: sql<number | null>`round(avg(extract(epoch from (${creditApplications.decidedAt} - ${creditApplications.createdAt})) / 86400) filter (where ${creditApplications.decidedAt} > now() - interval '90 days')::numeric, 1)::float`,
      activeOutstanding: sql<number>`coalesce(sum(${creditApplications.salePrice}) filter (where ${creditApplications.status} = 'active'),0)::float`,
    }).from(creditApplications).where(scope),
  ]);
  res.json({ byStatus, byBranch, kpi });
});
