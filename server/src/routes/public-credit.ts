import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, creditApplications, creditEvents, customers, installments, payments, products } from '../db/schema.js';
import { recordConsent } from '../lib/consent.js';
import { HttpError, parseBody } from '../lib/http.js';
import { reissueDownPayment, submitApplication } from '../lib/credit.js';
import { submitSchema } from './credit.js';
import { phoneEq } from '../lib/region.js';

/** Endpoint publik: pengajuan kredit dari website & cek status. */
export const publicCreditRouter = Router();

publicCreditRouter.get('/catalog/branches', async (req, res) => {
  const country = typeof req.query.country === 'string' && /^[A-Za-z]{2}$/.test(req.query.country) ? req.query.country.toUpperCase() : null;
  const rows = await db.select({ id: branches.id, code: branches.code, name: branches.name, city: branches.city, address: branches.address, countryCode: branches.countryCode })
    .from(branches).where(and(eq(branches.type, 'branch'), eq(branches.isActive, true), country ? eq(branches.countryCode, country) : undefined)).orderBy(asc(branches.name));
  res.json({ branches: rows });
});

publicCreditRouter.post('/public/credit-applications', async (req, res) => {
  // Honeypot sederhana anti-bot: kolom "website" harus kosong
  if (req.body?.website) throw new HttpError(400, 'Permintaan ditolak');
  const body = parseBody(submitSchema.extend({ consent: z.literal(true, 'Setujui syarat & ketentuan serta pemeriksaan data') }), req.body);
  const { consent: _c, ...input } = body;
  const r = await submitApplication(null, input);
  await recordConsent(req, { subjectType: 'credit_application', subjectId: r.application.appNo, phone: input.customer.phone, documents: ['terms', 'privacy', 'credit_check'] });
  res.status(201).json({ appNo: r.application.appNo, terms: r.terms });
});

/** Label status untuk nasabah; akad yang sudah ditandatangani tetapi uang muka belum dibayar dibedakan. */
export const publicLabel = (a: { status: string; contractNo: string | null; dpPaidAt: Date | null }) =>
  a.status === 'approved' && a.contractNo && !a.dpPaidAt ? 'Akad ditandatangani — menunggu uang muka' : PUBLIC_STEPS[a.status];

export const PUBLIC_STEPS: Record<string, string> = {
  submitted: 'Pengajuan diterima', assigned: 'Verifikasi & survei oleh Account Officer', branch_review: 'Review Manager Cabang',
  hq_review: 'Keputusan Kantor Pusat', approved: 'Disetujui — menunggu akad', contracted: 'Akad selesai — menunggu serah terima',
  active: 'Pembiayaan berjalan', paid_off: 'Lunas', rejected: 'Belum dapat disetujui', cancelled: 'Dibatalkan',
};

/** Tagihan uang muka yang menunggu dibayar (akad sudah ditandatangani). */
export async function dpDueInfo(a: typeof creditApplications.$inferSelect) {
  if (a.status !== 'approved' || !a.contractNo || a.dpPaidAt) return null;
  const [p] = await db.select().from(payments).where(and(eq(payments.kind, 'down_payment'), eq(payments.refId, a.id), eq(payments.status, 'pending'))).orderBy(desc(payments.createdAt)).limit(1);
  return { amount: Math.round(((a.downPayment ?? 0) + (a.shippingFee ?? 0)) * 100) / 100, downPayment: a.downPayment, shippingFee: a.shippingFee,
    payment: p ? { paymentNo: p.paymentNo, channel: p.channel, method: p.method, bank: p.bank, vaNumber: p.vaNumber, qrString: p.qrString, qrUrl: p.qrUrl, payUrl: p.payUrl, amount: p.amount, expiresAt: p.expiresAt } : null };
}

publicCreditRouter.get('/public/credit-applications/track', async (req, res) => {
  const q = parseBody(z.object({ appNo: z.string().trim().toUpperCase().min(5), phone: z.string().trim().min(7, 'Nomor HP tidak valid') }), req.query);
  const [row] = await db.select({ a: creditApplications, phone: customers.phone, name: customers.fullName, product: products.name, branch: branches.name })
    .from(creditApplications).innerJoin(customers, eq(customers.id, creditApplications.customerId))
    .innerJoin(products, eq(products.id, creditApplications.productId)).innerJoin(branches, eq(branches.id, creditApplications.branchId))
    .where(eq(creditApplications.appNo, q.appNo)).limit(1);
  if (!row || !(await phoneEq(row.phone, q.phone, row.a.branchId))) throw new HttpError(404, 'Data tidak ditemukan. Periksa nomor pengajuan & nomor HP.');
  const a = row.a;
  const [timeline, schedule] = await Promise.all([
    db.select({ toStatus: creditEvents.toStatus, createdAt: creditEvents.createdAt }).from(creditEvents)
      .where(eq(creditEvents.applicationId, a.id)).orderBy(asc(creditEvents.id)),
    a.status === 'active' || a.status === 'paid_off'
      ? db.select({ seq: installments.seq, dueDate: installments.dueDate, amount: installments.amount, status: installments.status }).from(installments).where(eq(installments.applicationId, a.id)).orderBy(asc(installments.seq))
      : Promise.resolve([]),
  ]);
  res.json({
    appNo: a.appNo, status: a.status, statusLabel: publicLabel(a), dpDue: await dpDueInfo(a), customerName: row.name.replace(/(?<=.{3}).(?=.{2})/g, '•'),
    product: row.product, branch: row.branch, currency: a.currency, submittedAt: a.createdAt,
    terms: a.tenor ? { tenor: a.tenor, downPayment: a.downPayment, monthly: a.monthly, salePrice: a.salePrice, marginPct: a.marginPct } : null,
    contractNo: a.contractNo, timeline: timeline.filter((t) => t.toStatus).map((t) => ({ status: t.toStatus, label: PUBLIC_STEPS[t.toStatus!], at: t.createdAt })),
    installments: schedule,
  });
});

/** Nasabah membayar uang muka online dari halaman cek status (verifikasi nomor pengajuan + HP). */
publicCreditRouter.post('/public/credit-applications/pay-dp', async (req, res) => {
  const b = parseBody(z.object({ appNo: z.string().trim().toUpperCase().min(5), phone: z.string().trim().min(7), method: z.enum(['va', 'qris', 'fpx']), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish() }), req.body);
  const [row] = await db.select({ a: creditApplications, phone: customers.phone }).from(creditApplications).innerJoin(customers, eq(customers.id, creditApplications.customerId))
    .where(eq(creditApplications.appNo, b.appNo)).limit(1);
  if (!row || !(await phoneEq(row.phone, b.phone, row.a.branchId))) throw new HttpError(404, 'Data tidak ditemukan. Periksa nomor pengajuan & nomor HP.');
  await reissueDownPayment(null, row.a.id, b.method, b.bank ?? null);
  res.status(201).json({ dpDue: await dpDueInfo(await (await import('../lib/credit.js')).loadApp(row.a.id)) });
});
