import express, { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, creditApplications, customers, orderItems, orders, payments, shipmentEvents, shipments } from '../db/schema.js';
import { recordConsent } from '../lib/consent.js';
import { HttpError, parseBody } from '../lib/http.js';
import { cartPromo, checkout, priceCart } from '../lib/orders.js';
import { quoteOptions, modeLabel } from '../lib/shipping.js';
import { confirmPayment, createInstallmentCharge, creditPosition, getPaymentGateway, handleGatewayNotification, settlementQuote } from '../lib/payments.js';
import { VA_BANKS } from '../lib/gateways.js';
import { paidPaymentsFor, receiptDoc } from '../lib/receipts.js';
import { isProd } from '../env.js';
import '../lib/credit.js';
import { e164, phoneEq } from '../lib/region.js';
import { getConfig } from '../lib/config.js';

/** Toko publik: kuotasi ongkir, checkout tunai, lacak order, bayar angsuran. */
export const publicShopRouter = Router();

const itemsSchema = z.array(z.object({ productId: z.uuid(), qty: z.number().int().min(1).max(20) })).min(1, 'Keranjang kosong').max(30);

publicShopRouter.post('/public/cart/quote', async (req, res) => {
  const b = parseBody(z.object({ branchId: z.uuid('Pilih cabang'), city: z.string().trim().min(2, 'Isi kota tujuan'), postalCode: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{4,8}$/, 'Kode pos tidak valid').nullish().or(z.literal('').transform(() => null)), items: itemsSchema,
    promoCode: z.string().trim().toUpperCase().max(32).nullish(), phone: z.string().trim().max(32).nullish() }), req.body);
  const cart = await priceCart(b.branchId, b.items);
  let promo: { code: string; discount: number; tax: number; error: string | null } | null = null;
  if (b.promoCode) {
    try { const r = await cartPromo(cart, b.promoCode, b.phone ? e164(b.phone, cart.branch.countryCode) : null); promo = { code: b.promoCode, discount: r.discount, tax: r.tax, error: null }; }
    catch (e) { promo = { code: b.promoCode, discount: 0, tax: cart.tax, error: (e as Error).message }; }
  }
  const shipping = cart.fulfillBranchId
    ? await quoteOptions({ fromBranchId: cart.fulfillBranchId, destCity: b.city, destPostalCode: b.postalCode, itemName: cart.lines.map((l) => l.name).join(', '), weightKg: cart.weightKg, isBulky: cart.isBulky, installCount: cart.installCount, subtotal: cart.subtotal })
    : null;
  res.json({
    currency: cart.currency, subtotal: cart.subtotal, tax: promo && !promo.error ? promo.tax : cart.tax, available: !!cart.fulfillBranchId, promo,
    lines: cart.lines.map((l) => ({ productId: l.id, name: l.name, qty: l.qty, unitPrice: l.price })),
    from: shipping?.from ?? null, options: (shipping?.options ?? []).filter((o) => !(cart.split && o.mode === 'pickup')), courierNote: shipping?.courierNote ?? null,
    split: cart.split, locations: cart.split ? (await db.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, cart.locations))).map((x) => x.name) : [],
  });
});

publicShopRouter.post('/public/orders', async (req, res) => {
  if (req.body?.website) throw new HttpError(400, 'Permintaan ditolak');
  const b = parseBody(z.object({
    customer: z.object({ fullName: z.string().trim().min(3, 'Nama minimal 3 karakter'), phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, 'Format nomor HP tidak valid'), email: z.email().nullish().or(z.literal('').transform(() => null)) }),
    branchId: z.uuid('Pilih cabang'), items: itemsSchema,
    delivery: z.object({ mode: z.enum(['internal', 'partner', 'pickup']), address: z.string().trim().max(300).default(''), city: z.string().trim().min(2, 'Isi kota'), postalCode: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{4,8}$/, 'Kode pos tidak valid').nullish().or(z.literal('').transform(() => null)), courierCode: z.string().nullish(), service: z.string().nullish() }),
    paymentMethod: z.enum(['va', 'qris', 'fpx', 'cashier']), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish(), note: z.string().trim().max(300).nullish(),
    promoCode: z.string().trim().toUpperCase().max(32).nullish().or(z.literal('').transform(() => null)), marketingOptIn: z.boolean().default(false),
  }), req.body);
  const r = await checkout(b);
  await recordConsent(req, { subjectType: 'order', subjectId: r.order.orderNo, phone: b.customer.phone, documents: ['terms', 'privacy'], country: ({ IDR: 'ID', MYR: 'MY', BND: 'BN' } as Record<string, string>)[r.order.currency] ?? null });
  res.status(201).json({ orderNo: r.order.orderNo, total: r.order.total, currency: r.order.currency, expiresAt: r.order.expiresAt, payment: r.payment && { paymentNo: r.payment.paymentNo, method: r.payment.method, vaNumber: r.payment.vaNumber, bank: r.payment.bank, qrString: r.payment.qrString, qrUrl: r.payment.qrUrl, payUrl: r.payment.payUrl, amount: r.payment.amount } });
});

export const ORDER_STATUS: Record<string, string> = {
  awaiting_payment: 'Menunggu pembayaran', paid: 'Pembayaran diterima', fulfilling: 'Sedang diproses / dikirim', completed: 'Selesai — barang diterima',
  cancelled: 'Dibatalkan', expired: 'Kedaluwarsa (tidak dibayar)',
};

/** revealCode: kode pengambilan hanya untuk nasabah yang login (OTP). Pelacakan publik (nomor + HP) tidak menampilkannya. */
export async function shipmentInfo(sourceType: string, sourceId: string, opts: { revealCode?: boolean } = {}) {
  const list = await db.select().from(shipments).where(and(eq(shipments.sourceType, sourceType), eq(shipments.sourceId, sourceId))).orderBy(desc(shipments.createdAt));
  if (!list.length) return null;
  const view = async (s: typeof list[number]) => {
    const [events, [from]] = await Promise.all([
      db.select({ status: shipmentEvents.status, message: shipmentEvents.message, createdAt: shipmentEvents.createdAt }).from(shipmentEvents).where(eq(shipmentEvents.shipmentId, s.id)).orderBy(asc(shipmentEvents.id)),
      db.select({ name: branches.name, address: branches.address, city: branches.city, phone: branches.phone }).from(branches).where(eq(branches.id, s.fromBranchId)),
    ]);
    return {
      shipmentNo: s.shipmentNo, status: s.status, mode: s.mode, modeLabel: modeLabel(s), trackingNo: s.trackingNo, scheduledDate: s.scheduledDate, scheduledSlot: s.scheduledSlot,
      // Kode pengambilan hanya ditampilkan ke nasabah (terverifikasi no. HP) — wajib ditunjukkan saat mengambil barang
      pickupCode: s.status === 'ready_pickup' && opts.revealCode ? s.pickupCode : null, pickupCodeSent: s.status === 'ready_pickup' && !opts.revealCode, pickupExpiresAt: s.pickupExpiresAt, pickupLocation: from,
      deliveredAt: s.deliveredAt, podName: s.podName, events, itemsSummary: s.itemsSummary,
    };
  };
  const active = list.filter((s) => s.status !== 'cancelled');
  const main = await view(active[0] ?? list[0]);
  // Order yang stoknya tersebar dikirim dalam beberapa kiriman
  return active.length > 1 ? { ...main, parts: await Promise.all(active.map(view)) } : main;
}

publicShopRouter.get('/public/orders/track', async (req, res) => {
  const q = parseBody(z.object({ orderNo: z.string().trim().toUpperCase().min(5), phone: z.string().trim().min(7, 'Nomor HP tidak valid') }), req.query);
  const [o] = await db.select().from(orders).where(eq(orders.orderNo, q.orderNo)).limit(1);
  if (!o || !(await phoneEq(o.recipientPhone, q.phone, o.branchId))) throw new HttpError(404, 'Order tidak ditemukan. Periksa nomor order & nomor HP.');
  const [items, pays, ship] = await Promise.all([
    db.select({ name: orderItems.name, qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).where(eq(orderItems.orderId, o.id)),
    db.select({ paymentNo: payments.paymentNo, method: payments.method, vaNumber: payments.vaNumber, bank: payments.bank, qrString: payments.qrString, qrUrl: payments.qrUrl, payUrl: payments.payUrl, amount: payments.amount, status: payments.status, expiresAt: payments.expiresAt })
      .from(payments).where(and(eq(payments.kind, 'order'), eq(payments.refId, o.id))).orderBy(desc(payments.createdAt)),
    shipmentInfo('order', o.id),
  ]);
  const [b] = await db.select({ name: branches.name, address: branches.address, phone: branches.phone }).from(branches).where(eq(branches.id, o.branchId));
  res.json({ orderNo: o.orderNo, status: o.status, statusLabel: ORDER_STATUS[o.status], currency: o.currency, subtotal: o.subtotal, tax: o.tax, shippingFee: o.shippingFee,
    total: o.total, expiresAt: o.expiresAt, createdAt: o.createdAt, items, payments: pays, shipment: ship, branch: b });
});

/** Angsuran: posisi & buat VA / QRIS (verifikasi no. pengajuan/akad + HP). */
async function findCredit(no: string, phone: string) {
  const [row] = await db.select({ a: creditApplications, phone: customers.phone, name: customers.fullName }).from(creditApplications)
    .innerJoin(customers, eq(customers.id, creditApplications.customerId)).where(eq(creditApplications.appNo, no.toUpperCase())).limit(1);
  const [row2] = row ? [row] : await db.select({ a: creditApplications, phone: customers.phone, name: customers.fullName }).from(creditApplications)
    .innerJoin(customers, eq(customers.id, creditApplications.customerId)).where(eq(creditApplications.contractNo, no.toUpperCase())).limit(1);
  if (!row2 || !(await phoneEq(row2.phone, phone, row2.a.branchId))) throw new HttpError(404, 'Data tidak ditemukan');
  return row2;
}

publicShopRouter.get('/public/credit-applications/position', async (req, res) => {
  const q = parseBody(z.object({ appNo: z.string().trim().min(5), phone: z.string().trim().min(7, 'Nomor HP tidak valid') }), req.query);
  const { a } = await findCredit(q.appNo, q.phone);
  const [pos, pend, ship, receipts, quote] = await Promise.all([
    a.status === 'active' || a.status === 'paid_off' ? creditPosition(a.id) : Promise.resolve(null),
    db.select({ paymentNo: payments.paymentNo, method: payments.method, vaNumber: payments.vaNumber, bank: payments.bank, qrString: payments.qrString, qrUrl: payments.qrUrl, payUrl: payments.payUrl, amount: sql<number>`(${payments.amount} + ${payments.tazirAmount})::float`, tazirAmount: payments.tazirAmount, ibraAmount: payments.ibraAmount, expiresAt: payments.expiresAt })
      .from(payments).where(and(eq(payments.kind, 'installment'), eq(payments.refId, a.id), eq(payments.status, 'pending'))).orderBy(desc(payments.createdAt)),
    shipmentInfo('credit', a.id),
    paidPaymentsFor('credit', a.id),
    a.status === 'active' ? settlementQuote(a.id).catch(() => null) : Promise.resolve(null),
  ]);
  res.json({
    position: pos && { outstanding: pos.outstanding, overdueAmount: pos.overdueAmount, dpd: pos.dpd, tazirDue: pos.tazirDue, next: pos.next && { seq: pos.next.seq, dueDate: pos.next.dueDate, amount: pos.next.amount - pos.next.paidAmount } },
    settlement: quote && { payable: quote.payable, ibra: quote.ibra, ibraPct: quote.ibraPct, outstanding: quote.outstanding, validOn: quote.validOn },
    pendingPayments: pend, shipment: ship, receipts,
  });
});

publicShopRouter.post('/public/credit-applications/pay', async (req, res) => {
  const b = parseBody(z.object({ appNo: z.string().trim().min(5), phone: z.string().trim().min(7), amount: z.number().positive().default(1), method: z.enum(['va', 'qris', 'fpx']),
    includeTazir: z.boolean().default(false), settlement: z.boolean().default(false), bank: z.enum(['bca', 'bni', 'bri', 'permata']).nullish() }), req.body);
  const { a, name } = await findCredit(b.appNo, b.phone);
  const p = await createInstallmentCharge(a.id, b.amount, b.method, name, { includeTazir: b.includeTazir, settlement: b.settlement, bank: b.bank, phone: b.phone });
  res.status(201).json({ payment: { paymentNo: p.paymentNo, method: p.method, vaNumber: p.vaNumber, bank: p.bank, qrString: p.qrString, qrUrl: p.qrUrl, payUrl: p.payUrl, amount: p.amount + p.tazirAmount, installmentAmount: p.amount, tazirAmount: p.tazirAmount, ibraAmount: p.ibraAmount, expiresAt: p.expiresAt } });
});

/** Kwitansi untuk nasabah (verifikasi nomor HP pemesan / pemohon). */
publicShopRouter.get('/public/receipts/:paymentNo', async (req, res) => {
  const { phone } = parseBody(z.object({ phone: z.string().trim().min(7, 'Nomor HP tidak valid') }), req.query);
  res.json({ doc: await receiptDoc(z.string().min(5).parse(req.params.paymentNo), { verifyPhone: phone }) });
});

// ---------------------------------------------------------------------------
// Webhook gateway pembayaran & simulasi pengembangan
// ---------------------------------------------------------------------------
// Catatan keamanan: webhook generik (/webhooks/payment) dihapus — hanya webhook bertanda tangan per gateway yang diterima.

/** Webhook Midtrans (HTTP Notification URL: https://domain-anda/api/webhooks/midtrans). */
publicShopRouter.post('/webhooks/midtrans', async (req, res) => {
  const gw = getPaymentGateway('ID');
  if (gw.name !== 'midtrans' || !gw.parseNotification) throw new HttpError(404, 'Endpoint tidak ditemukan');
  const n = await gw.parseNotification(req.body);
  const r = await handleGatewayNotification(n);
  res.json({ received: true, ...r });
});

/** Metode pembayaran yang tersedia per negara (untuk halaman checkout). */
publicShopRouter.get('/public/payment-options', async (req, res) => {
  const country = z.enum(['ID', 'MY', 'BN']).catch('ID').parse(String(req.query.country ?? 'ID').toUpperCase());
  const gw = getPaymentGateway(country);
  const transferInfo = await getConfig<string>('general.bank_transfer_info', country).catch(() => '');
  res.json({ country, provider: gw.name, methods: gw.methods, banks: gw.methods.includes('va') ? Object.entries(VA_BANKS).map(([code, name]) => ({ code, name })) : [],
    qris: gw.methods.includes('qris'), fpx: gw.methods.includes('fpx'), transferInfo: transferInfo || null,
    simulation: !isProd && process.env.ENABLE_DEV_SIMULATION === 'true' });
});

/** Webhook Billplz (Malaysia) — callback_url tagihan. Body form-urlencoded bertanda tangan X-Signature. */
publicShopRouter.post('/webhooks/billplz', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  const gw = getPaymentGateway('MY');
  if (gw.name !== 'billplz' || !gw.parseNotification) throw new HttpError(404, 'Endpoint tidak ditemukan');
  const n = await gw.parseNotification(req.body);
  if (!n.paymentNo) throw new HttpError(400, 'Referensi pembayaran tidak ditemukan');
  res.json({ received: true, ...(await handleGatewayNotification(n)) });
});

publicShopRouter.post('/dev/payments/:paymentNo/pay', async (req, res) => {
  if (isProd || process.env.ENABLE_DEV_SIMULATION !== 'true') throw new HttpError(404, 'Endpoint tidak ditemukan');
  const p = await confirmPayment(String(req.params.paymentNo), null, `SIMULASI-${Date.now()}`);
  res.json({ payment: p, note: 'Simulasi pembayaran (hanya mode pengembangan)' });
});
