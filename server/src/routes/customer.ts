import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, consents, creditApplications, creditEvents, customers, installments, orderItems, orders, payments, products } from '../db/schema.js';
import { createAssistantTicket } from '../lib/helpdesk.js';
import { HttpError, clientIp, parseBody } from '../lib/http.js';
import { clearCustomerCookie, normPhone, phoneMatch, requestOtp, requireCustomer, setCustomerCookie, validPhone, verifyOtp } from '../lib/customer-auth.js';
import { createInstallmentCharge, creditPosition, settlementQuote } from '../lib/payments.js';
import { paidPaymentsFor, receiptDoc } from '../lib/receipts.js';
import { contractDoc } from '../lib/contract.js';
import { rateLimit } from '../lib/ratelimit.js';
import { recordConsent } from '../lib/consent.js';
import { setMarketingOptIn } from '../lib/promo.js';
import { PUBLIC_STEPS, dpDueInfo, publicLabel } from './public-credit.js';
import { reissueDownPayment } from '../lib/credit.js';
import { ORDER_STATUS, shipmentInfo } from './public-shop.js';

/** Akun Saya (nasabah): login OTP WhatsApp, pesanan, pembiayaan, pembayaran, kwitansi, akad, profil. */
export const customerRouter = Router();

// ----- Login -----
customerRouter.post('/customer/auth/request-otp', rateLimit('otp-ip', 10, 600), async (req, res) => {
  const b = parseBody(z.object({ phone: z.string().trim().min(7, 'Nomor HP tidak valid').max(20), country: z.enum(['ID', 'MY', 'BN']).default('ID'), lang: z.enum(['id', 'ms', 'en']).default('id') }), req.body);
  res.json(await requestOtp(b.phone, clientIp(req), b.country, b.lang));
});

customerRouter.post('/customer/auth/verify', rateLimit('otp-verify', 20, 600), async (req, res) => {
  const b = parseBody(z.object({ phone: z.string().trim().min(7), code: z.string().trim().regex(/^\d{6}$/, 'Kode 6 digit'), country: z.enum(['ID', 'MY', 'BN']).default('ID'), lang: z.enum(['id', 'ms', 'en']).optional() }), req.body);
  const s = await verifyOtp(b.phone, b.code, b.country, b.lang);
  await recordConsent(req, { subjectType: 'customer', subjectId: s.id, phone: `+${s.phone}`, documents: ['terms', 'privacy'], country: b.country });
  setCustomerCookie(res, s);
  res.json({ ok: true });
});

customerRouter.post('/customer/auth/logout', (_req, res) => { clearCustomerCookie(res); res.json({ ok: true }); });

const auth = Router();
auth.use(requireCustomer);
customerRouter.use('/customer', auth);

/** Semua id nasabah dengan nomor HP sesi ini. */
const myCustomerIds = async (phone: string) => (await db.select({ id: customers.id }).from(customers).where(phoneMatch(customers.phone, phone))).map((r) => r.id);

async function myCredit(phone: string, id: string) {
  const ids = await myCustomerIds(phone);
  const [a] = await db.select().from(creditApplications).where(and(eq(creditApplications.id, id), inArray(creditApplications.customerId, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))).limit(1);
  if (!a) throw new HttpError(404, 'Pembiayaan tidak ditemukan');
  return a;
}

// ----- Profil & KYC -----
auth.get('/me', async (req, res) => {
  const [c] = await db.select().from(customers).where(eq(customers.id, req.customer!.id)).limit(1);
  res.json({
    profile: { fullName: c.fullName, phone: req.customer!.phone, email: c.email, city: c.city, address: c.address, customerNo: c.customerNo, kycVerified: c.kycStatus === 'verified', needsName: c.fullName === 'Nasabah Masri-M', marketingOptIn: c.marketingOptIn },
    // Data untuk mengisi otomatis pengajuan baru (milik nasabah sendiri)
    kyc: { nik: c.nik, birthDate: c.birthDate, maritalStatus: c.maritalStatus, dependents: c.dependents, occupation: c.occupation, employer: c.employer, monthlyIncome: c.monthlyIncome },
  });
});

auth.patch('/me', async (req, res) => {
  const b = parseBody(z.object({
    fullName: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120).optional(), email: z.email('Email tidak valid').nullish().or(z.literal('').transform(() => null)),
    city: z.string().trim().max(80).optional(), address: z.string().trim().max(300).optional(), marketingOptIn: z.boolean().optional(),
  }), req.body);
  const { marketingOptIn, ...prof } = b;
  if (marketingOptIn !== undefined) {
    const ids = await myCustomerIds(req.customer!.phone);
    await db.transaction(async (tx) => { for (const id of ids) await setMarketingOptIn(tx, id, marketingOptIn, { ip: clientIp(req), userAgent: req.get('user-agent') ?? null, phone: req.customer!.phone }); });
  }
  const [c] = await db.select().from(customers).where(eq(customers.id, req.customer!.id)).limit(1);
  if (b.fullName && c.kycStatus === 'verified' && b.fullName !== c.fullName) throw new HttpError(409, 'Nama sudah terverifikasi KYC. Hubungi cabang untuk perubahan nama');
  if (Object.keys(prof).length) await db.update(customers).set(prof).where(eq(customers.id, c.id));
  res.json({ ok: true });
});

// ----- Hak atas data pribadi (UU PDP / PDPA / PDPO) -----
/** Unduh salinan seluruh data pribadi & transaksi milik nasabah ini (JSON). */
auth.get('/privacy/export', async (req, res) => {
  const phone = req.customer!.phone;
  const ids = await myCustomerIds(phone);
  const safeIds = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
  const [profiles, apps, ords, cons] = await Promise.all([
    db.select().from(customers).where(inArray(customers.id, safeIds)),
    db.select().from(creditApplications).where(inArray(creditApplications.customerId, safeIds)),
    db.select().from(orders).where(or(phoneMatch(orders.recipientPhone, phone), inArray(orders.customerId, safeIds))),
    db.select({ document: consents.document, version: consents.version, subjectType: consents.subjectType, subjectId: consents.subjectId, createdAt: consents.createdAt }).from(consents).where(phoneMatch(consents.phone, phone)),
  ]);
  const appIds = apps.map((a) => a.id), orderIds = ords.map((o) => o.id);
  const refIds = [...appIds, ...orderIds];
  const [inst, items, pays] = await Promise.all([
    appIds.length ? db.select().from(installments).where(inArray(installments.applicationId, appIds)) : [],
    orderIds.length ? db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [],
    refIds.length ? db.select({ paymentNo: payments.paymentNo, amount: payments.amount, method: payments.method, status: payments.status, paidAt: payments.paidAt, createdAt: payments.createdAt }).from(payments).where(inArray(payments.refId, refIds)) : [],
  ]);
  const strip = <T extends Record<string, unknown>>(r: T) => Object.fromEntries(Object.entries(r).filter(([k]) => !/hash|token|secret/i.test(k)));
  res.setHeader('Content-Disposition', `attachment; filename="data-saya-masri-m-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(), note: 'Salinan data pribadi Anda yang disimpan Masri-M. Dokumen foto (KTP, bukti) dapat diminta melalui Helpdesk.',
    profiles: profiles.map(strip), creditApplications: apps.map(strip), installments: inst, orders: ords.map(strip), orderItems: items, payments: pays, consents: cons,
  });
});

/** Permintaan koreksi / penghapusan data → tiket Helpdesk (diproses manual karena ada kewajiban simpan dokumen transaksi). */
auth.post('/privacy/request', rateLimit('privacy-req', 5, 3600), async (req, res) => {
  const b = parseBody(z.object({ type: z.enum(['delete', 'correct', 'withdraw']), note: z.string().trim().max(1000).default('') }), req.body);
  const [c] = await db.select({ fullName: customers.fullName }).from(customers).where(eq(customers.id, req.customer!.id)).limit(1);
  const label = { delete: 'Permintaan penghapusan data pribadi', correct: 'Permintaan koreksi data pribadi', withdraw: 'Penarikan persetujuan pemrosesan data' }[b.type];
  const t = await createAssistantTicket({
    name: c?.fullName ?? 'Nasabah', phone: `+${req.customer!.phone}`, category: 'account', subject: label, priority: 'high', via: 'Akun Saya (hak data pribadi)',
    description: `${label}.\n${b.note ? `Catatan nasabah: ${b.note}\n` : ''}Tindak lanjuti sesuai prosedur docs/KEPATUHAN.md (verifikasi identitas, cek kewajiban aktif & masa simpan dokumen, jawab maks. 3x24 jam).`,
  });
  res.status(201).json({ ticketNo: t.ticketNo });
});

// ----- Pesanan tunai -----
auth.get('/orders', async (req, res) => {
  const ids = await myCustomerIds(req.customer!.phone);
  const rows = await db.select().from(orders).where(or(phoneMatch(orders.recipientPhone, req.customer!.phone), ids.length ? inArray(orders.customerId, ids) : undefined))
    .orderBy(desc(orders.createdAt)).limit(50);
  const out = [];
  for (const o of rows) {
    const [items, pays, ship] = await Promise.all([
      db.select({ name: orderItems.name, qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).where(eq(orderItems.orderId, o.id)),
      db.select({ paymentNo: payments.paymentNo, method: payments.method, bank: payments.bank, vaNumber: payments.vaNumber, qrString: payments.qrString, qrUrl: payments.qrUrl, payUrl: payments.payUrl, amount: payments.amount, status: payments.status, expiresAt: payments.expiresAt, paidAt: payments.paidAt })
        .from(payments).where(and(eq(payments.kind, 'order'), eq(payments.refId, o.id))).orderBy(desc(payments.createdAt)),
      shipmentInfo('order', o.id, { revealCode: true }),
    ]);
    out.push({ id: o.id, orderNo: o.orderNo, status: o.status, statusLabel: ORDER_STATUS[o.status], currency: o.currency, total: o.total, createdAt: o.createdAt, expiresAt: o.expiresAt,
      deliveryMode: o.deliveryMode, items, payments: pays, shipment: ship });
  }
  res.json({ orders: out });
});

// ----- Pembiayaan -----
auth.get('/credits', async (req, res) => {
  const ids = await myCustomerIds(req.customer!.phone);
  if (!ids.length) { res.json({ credits: [] }); return; }
  const rows = await db.select({ a: creditApplications, product: products.name, branch: branches.name }).from(creditApplications)
    .innerJoin(products, eq(products.id, creditApplications.productId)).innerJoin(branches, eq(branches.id, creditApplications.branchId))
    .where(inArray(creditApplications.customerId, ids)).orderBy(desc(creditApplications.createdAt));
  const out = [];
  for (const { a, product, branch } of rows) {
    const pos = a.status === 'active' ? await creditPosition(a.id) : null;
    out.push({ id: a.id, appNo: a.appNo, contractNo: a.contractNo, status: a.status, statusLabel: publicLabel(a), dpDue: await dpDueInfo(a), product, branch, currency: a.currency,
      monthly: a.monthly, tenor: a.tenor, salePrice: a.salePrice, createdAt: a.createdAt,
      position: pos && { outstanding: pos.outstanding, overdueAmount: pos.overdueAmount, dpd: pos.dpd, tazirDue: pos.tazirDue, paidCount: pos.paidCount,
        next: pos.next && { seq: pos.next.seq, dueDate: pos.next.dueDate, amount: pos.next.amount - pos.next.paidAmount } } });
  }
  res.json({ credits: out });
});

auth.get('/credits/:id', async (req, res) => {
  const a = await myCredit(req.customer!.phone, z.uuid().parse(req.params.id));
  const [[prod], sched, timeline, pos, quote, pend, ship, receipts] = await Promise.all([
    db.select({ name: products.name, image: products.images }).from(products).where(eq(products.id, a.productId)),
    db.select({ seq: installments.seq, dueDate: installments.dueDate, amount: installments.amount, paidAmount: installments.paidAmount, status: installments.status }).from(installments).where(eq(installments.applicationId, a.id)).orderBy(asc(installments.seq)),
    db.select({ toStatus: creditEvents.toStatus, createdAt: creditEvents.createdAt }).from(creditEvents).where(eq(creditEvents.applicationId, a.id)).orderBy(asc(creditEvents.id)),
    a.status === 'active' ? creditPosition(a.id) : Promise.resolve(null),
    a.status === 'active' ? settlementQuote(a.id).catch(() => null) : Promise.resolve(null),
    db.select({ paymentNo: payments.paymentNo, method: payments.method, bank: payments.bank, vaNumber: payments.vaNumber, qrString: payments.qrString, qrUrl: payments.qrUrl, payUrl: payments.payUrl, amount: payments.amount, tazirAmount: payments.tazirAmount, ibraAmount: payments.ibraAmount, expiresAt: payments.expiresAt })
      .from(payments).where(and(eq(payments.kind, 'installment'), eq(payments.refId, a.id), eq(payments.status, 'pending'))).orderBy(desc(payments.createdAt)),
    shipmentInfo('credit', a.id, { revealCode: true }), paidPaymentsFor('credit', a.id),
  ]);
  res.json({
    dpDue: await dpDueInfo(a),
    credit: { id: a.id, appNo: a.appNo, contractNo: a.contractNo, status: a.status, statusLabel: publicLabel(a), currency: a.currency, product: prod?.name, image: prod?.image?.[0] ?? null,
      terms: a.tenor ? { tenor: a.tenor, downPayment: a.downPayment, monthly: a.monthly, salePrice: a.salePrice, marginPct: a.marginPct, cashPrice: a.cashPrice } : null,
      settledEarlyAt: a.settledEarlyAt, ibraAmount: a.ibraAmount },
    timeline: timeline.filter((t) => t.toStatus).map((t) => ({ status: t.toStatus, label: PUBLIC_STEPS[t.toStatus!], at: t.createdAt })),
    installments: sched,
    position: pos && { outstanding: pos.outstanding, overdueAmount: pos.overdueAmount, dpd: pos.dpd, tazirDue: pos.tazirDue, next: pos.next && { seq: pos.next.seq, dueDate: pos.next.dueDate, amount: pos.next.amount - pos.next.paidAmount } },
    settlement: quote && { payable: quote.payable, ibra: quote.ibra, ibraPct: quote.ibraPct, outstanding: quote.outstanding, validOn: quote.validOn },
    pendingPayments: pend.map((p) => ({ ...p, amount: p.amount + p.tazirAmount })), shipment: ship, receipts,
  });
});

auth.post('/credits/:id/pay', async (req, res) => {
  const b = parseBody(z.object({ amount: z.number().positive().default(1), method: z.enum(['va', 'qris', 'fpx']), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish(),
    includeTazir: z.boolean().default(false), settlement: z.boolean().default(false) }), req.body);
  const a = await myCredit(req.customer!.phone, z.uuid().parse(req.params.id));
  const [c] = await db.select({ name: customers.fullName }).from(customers).where(eq(customers.id, a.customerId));
  const p = await createInstallmentCharge(a.id, b.amount, b.method, c.name, { includeTazir: b.includeTazir, settlement: b.settlement, bank: b.bank, phone: req.customer!.phone });
  res.status(201).json({ payment: { paymentNo: p.paymentNo, method: p.method, bank: p.bank, vaNumber: p.vaNumber, qrString: p.qrString, qrUrl: p.qrUrl, payUrl: p.payUrl, amount: p.amount + p.tazirAmount, tazirAmount: p.tazirAmount, ibraAmount: p.ibraAmount, expiresAt: p.expiresAt } });
});

/** Bayar uang muka akad secara online (VA / QRIS / FPX). */
auth.post('/credits/:id/pay-dp', async (req, res) => {
  const b = parseBody(z.object({ method: z.enum(['va', 'qris', 'fpx']), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish() }), req.body);
  const a = await myCredit(req.customer!.phone, z.uuid().parse(req.params.id));
  await reissueDownPayment(null, a.id, b.method, b.bank ?? null);
  res.status(201).json({ dpDue: await dpDueInfo(await myCredit(req.customer!.phone, a.id)) });
});

auth.get('/credits/:id/contract', async (req, res) => {
  const a = await myCredit(req.customer!.phone, z.uuid().parse(req.params.id));
  res.json({ doc: await contractDoc(a.id, { maskNik: true, lang: typeof req.query.lang === 'string' ? req.query.lang : null }) });
});

auth.get('/receipts/:paymentNo', async (req, res) => {
  res.json({ doc: await receiptDoc(z.string().min(5).parse(req.params.paymentNo), { verifyPhone: req.customer!.phone }) });
});

export { normPhone, validPhone };
