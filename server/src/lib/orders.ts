import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, customers, orderItems, orders, payments, productPrices, products, shipmentItems, stockLevels, type Order } from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import { commitReservedOut, releaseStock, reserveStock, type Tx } from './stock.js';
import { createShipment, onShipmentDelivered, resolveOption, type DeliveryMode } from './shipping.js';
import { getPaymentGateway, nextPaymentNo, onOrderPaid } from './payments.js';
import type { VaBank } from './gateways.js';
import { cashShiftFor } from './finance.js';
import { links, money, notifyCustomer, payVars, when } from './notify.js';
import type { AuthUser } from '../middleware/auth.js';
import { CURRENCY, POSTAL_HINT, branchCountry, e164, phoneMatch, validPhoneFor, validPostal } from './region.js';

async function nextOrderNo(tx: Tx) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('order_doc_seq')::text as seq`);
  const d = new Date();
  return `ORD-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
}

export interface CheckoutInput {
  customer: { fullName: string; phone: string; email?: string | null };
  branchId: string;
  items: { productId: string; qty: number }[];
  delivery: { mode: DeliveryMode; address: string; city: string; postalCode?: string | null; courierCode?: string | null; service?: string | null };
  paymentMethod: 'va' | 'qris' | 'fpx' | 'cashier';
  bank?: VaBank | null;
  note?: string | null;
  promoCode?: string | null;
  marketingOptIn?: boolean;
}

/** Potongan kode promo untuk keranjang (dipakai checkout & pratinjau). Pajak dihitung dari harga setelah potongan. */
export async function cartPromo(cart: Awaited<ReturnType<typeof priceCart>>, code: string | null | undefined, phone: string | null) {
  if (!code?.trim()) return { discount: 0, tax: cart.tax, promo: null };
  const { evaluatePromo } = await import('./promo.js');
  const r = await evaluatePromo(db, { code, country: cart.branch.countryCode, currency: cart.currency, phone, channel: 'cash', lines: cart.lines.map((l) => ({ productId: l.id, qty: l.qty, unitPrice: l.price })) });
  const tax = cart.subtotal > 0 ? Math.round(cart.tax * (cart.subtotal - r.discount) / cart.subtotal * 100) / 100 : 0;
  return { discount: r.discount, tax, promo: r.promo };
}

/** Hitung keranjang: harga, PPN, berat, lokasi stok (cabang dulu, lalu Gudang Pusat). */
export async function priceCart(branchId: string, items: CheckoutInput['items']) {
  const [b] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!b || b.type !== 'branch' || !b.isActive) throw new HttpError(400, 'Pilih cabang yang melayani');
  if (!items.length) throw new HttpError(400, 'Keranjang kosong');
  const ids = items.map((i) => i.productId);
  const rows = await db.select({ id: products.id, name: products.name, status: products.status, weightKg: products.weightKg, isBulky: products.isBulky,
    requiresInstallation: products.requiresInstallation, price: productPrices.cashPrice })
    .from(products).innerJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, b.countryCode)))
    .where(inArray(products.id, ids));
  const lines = items.map((i) => {
    const p = rows.find((r) => r.id === i.productId);
    if (!p || p.status !== 'active') throw new HttpError(400, 'Ada produk yang tidak tersedia');
    return { ...p, qty: i.qty };
  });
  const [vat, incl] = await Promise.all([getConfig<number>('tax.vat_rate', b.countryCode), getConfig<boolean>('tax.prices_include_vat', b.countryCode)]);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = incl ? 0 : Math.round(subtotal * Number(vat)) / 100;
  const avail = async (productId: string, locId: string) => {
    const [s] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.branchId, locId))).limit(1);
    return s ? s.onHand - s.reserved : 0;
  };
  const stockAt = async (locId: string) => { for (const l of lines) if ((await avail(l.id, locId)) < l.qty) return false; return true; };
  const [ho] = await db.select().from(branches).where(and(eq(branches.type, 'head_office'), eq(branches.countryCode, b.countryCode))).limit(1);
  // 1) Satu lokasi: cabang dulu, lalu Gudang Pusat (satu pengiriman)
  let fulfillBranchId: string | null = null;
  let allocation: Allocation[] = [];
  if (await stockAt(b.id)) fulfillBranchId = b.id;
  else if (ho && (await stockAt(ho.id))) fulfillBranchId = ho.id;
  if (fulfillBranchId) allocation = lines.map((l) => ({ productId: l.id, branchId: fulfillBranchId!, qty: l.qty }));
  else {
    // 2) Stok tersebar: pecah per lokasi (cabang + Gudang Pusat, lalu cabang lain di negara yang sama)
    const others = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.countryCode, b.countryCode), eq(branches.isActive, true), eq(branches.hasBufferStock, true)));
    const locs = [b.id, ...(ho ? [ho.id] : []), ...others.map((o) => o.id).filter((id) => id !== b.id && id !== ho?.id)];
    let ok = true;
    for (const l of lines) {
      let need = l.qty;
      for (const loc of locs) {
        if (need <= 0) break;
        const a = Math.min(need, await avail(l.id, loc));
        if (a > 0) { allocation.push({ productId: l.id, branchId: loc, qty: a }); need -= a; }
      }
      if (need > 0) { ok = false; break; }
    }
    if (ok) {
      const units = new Map<string, number>();
      for (const a of allocation) units.set(a.branchId, (units.get(a.branchId) ?? 0) + a.qty);
      fulfillBranchId = [...units.entries()].sort((x, y) => y[1] - x[1])[0][0];
    } else allocation = [];
  }
  const locations = [...new Set(allocation.map((a) => a.branchId))];
  return {
    branch: b, lines, subtotal, tax, fulfillBranchId, allocation, split: locations.length > 1, locations, currency: CURRENCY[b.countryCode] ?? 'IDR',
    weightKg: lines.reduce((s, l) => s + l.weightKg * l.qty, 0), isBulky: lines.some((l) => l.isBulky),
    installCount: lines.reduce((s, l) => s + (l.requiresInstallation ? l.qty : 0), 0),
  };
}

export interface Allocation { productId: string; branchId: string; qty: number }
/** Alokasi stok order (order lama tanpa alokasi: semua dari lokasi utama). */
export async function allocationOf(tx: Tx | typeof db, o: Order): Promise<Allocation[]> {
  if (o.allocation?.length) return o.allocation;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  return items.map((i) => ({ productId: i.productId, branchId: o.fulfillBranchId, qty: i.qty }));
}

export async function checkout(input: CheckoutInput) {
  await expireStaleOrders();
  const cart = await priceCart(input.branchId, input.items);
  if (!cart.fulfillBranchId) throw new HttpError(409, 'Maaf, stok belum mencukupi untuk seluruh barang di keranjang. Kurangi jumlah atau hubungi cabang.');
  if (cart.split && input.delivery.mode === 'pickup') throw new HttpError(409, 'Stok barang ini tersebar di beberapa lokasi sehingga tidak bisa diambil sendiri sekaligus. Pilih pengiriman, atau kurangi jumlah barang.');
  const opt = await resolveOption({ fromBranchId: cart.fulfillBranchId, destCity: input.delivery.city, destPostalCode: input.delivery.postalCode, weightKg: cart.weightKg, isBulky: cart.isBulky, installCount: cart.installCount, subtotal: cart.subtotal },
    input.delivery.mode, input.delivery.courierCode, input.delivery.service);
  if (input.delivery.mode !== 'pickup' && input.delivery.address.trim().length < 10) throw new HttpError(400, 'Isi alamat pengiriman lengkap');
  const hours = Number(await getConfig<number>('order.payment_expiry_hours', await branchCountry(input.branchId))) || 24;
  const phoneE = e164(input.customer.phone, cart.branch.countryCode);
  if (!validPhoneFor(phoneE, cart.branch.countryCode)) throw new HttpError(400, 'Nomor HP tidak valid untuk negara cabang');
  const pr = await cartPromo(cart, input.promoCode, phoneE);
  const total = Math.round((cart.subtotal - pr.discount + pr.tax + opt.fee) * 100) / 100;
  if (input.delivery.mode !== 'pickup' && !validPostal(input.delivery.postalCode, cart.branch.countryCode)) throw new HttpError(400, `Format kode pos tidak valid (${POSTAL_HINT[cart.branch.countryCode] ?? ''})`);

  const result = await db.transaction(async (tx) => {
    let [cust] = await tx.select().from(customers).where(phoneMatch(customers.phone, phoneE, cart.branch.countryCode)).limit(1);
    if (!cust) {
      const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('customer_no_seq')::text as seq`);
      [cust] = await tx.insert(customers).values({ fullName: input.customer.fullName, phone: `+${phoneE}`, email: input.customer.email ?? null,
        city: input.delivery.city, address: input.delivery.address, branchId: cart.branch.id, customerNo: `C${cart.branch.code}-${seq.padStart(6, '0')}` }).returning();
    }
    const orderNo = await nextOrderNo(tx);
    const [o] = await tx.insert(orders).values({
      orderNo, customerId: cust.id, branchId: cart.branch.id, fulfillBranchId: cart.fulfillBranchId!, allocation: cart.allocation, currency: cart.currency,
      subtotal: cart.subtotal, discount: pr.discount, promoCode: pr.promo?.code ?? null, tax: pr.tax, shippingFee: opt.fee, total, deliveryMode: input.delivery.mode,
      courierCode: opt.courierCode ?? null, courierService: opt.service ?? null,
      recipientName: input.customer.fullName, recipientPhone: `+${phoneE}`, address: input.delivery.address, city: input.delivery.city, postalCode: input.delivery.postalCode ?? null,
      note: input.note ?? null, expiresAt: new Date(Date.now() + hours * 3600_000),
    }).returning();
    await tx.insert(orderItems).values(cart.lines.map((l) => ({ orderId: o.id, productId: l.id, name: l.name, qty: l.qty, unitPrice: l.price })));
    for (const a of cart.allocation) await reserveStock(tx, a.productId, a.branchId, a.qty, { refType: 'order', refId: o.id, refNo: orderNo });
    if (pr.promo) { const { redeemPromo } = await import('./promo.js'); await redeemPromo(tx, { promoId: pr.promo.id, phone: `+${phoneE}`, sourceType: 'order', sourceId: o.id, sourceNo: orderNo, discount: pr.discount }); }
    if (input.marketingOptIn) { const { setMarketingOptIn } = await import('./promo.js'); await setMarketingOptIn(tx, cust.id, true, { phone: `+${phoneE}`, country: cart.branch.countryCode }); }
    let payment = null;
    if (input.paymentMethod !== 'cashier') {
      const paymentNo = await nextPaymentNo(tx);
      const charge = await getPaymentGateway(cart.branch.countryCode).createCharge({ paymentNo, amount: total, method: input.paymentMethod, bank: input.bank, customerName: cust.fullName, customerPhone: phoneE, customerEmail: input.customer.email, expiresAt: o.expiresAt, currency: cart.currency, returnUrl: links.order(orderNo) });
      [payment] = await tx.insert(payments).values({
        paymentNo, kind: 'order', refId: o.id, refNo: orderNo, branchId: o.branchId, amount: total, method: input.paymentMethod, status: 'pending',
        channel: 'gateway', vaNumber: charge.vaNumber, bank: charge.bank, qrString: charge.qrString, qrUrl: charge.qrUrl, payUrl: charge.payUrl ?? null, gatewayRef: charge.gatewayRef, expiresAt: o.expiresAt,
      }).returning();
    }
    await notifyCustomer(tx, { phone: `+${phoneE}`, email: input.customer.email }, 'order_created', {
      name: input.customer.fullName, orderNo, total: money(total, cart.currency), expires: when(o.expiresAt), link: links.order(orderNo),
      ...payVars(payment ?? { method: 'cashier' }),
    }, { type: 'order', id: o.id });
    return { order: o, payment };
  });
  return { ...result, delivery: opt };
}

/** Pembayaran order lunas -> buat pengiriman (satu per lokasi stok bila dipecah). */
onOrderPaid(async (tx, p, actor) => {
  // Kunci order: pembayaran, pembatalan & kedaluwarsa tidak boleh berjalan bersamaan
  const [o] = await tx.select().from(orders).where(eq(orders.id, p.refId)).for('update').limit(1);
  if (!o || o.status !== 'awaiting_payment') return false;
  const items = await tx.select({ productId: orderItems.productId, name: orderItems.name, qty: orderItems.qty, weightKg: products.weightKg, isBulky: products.isBulky, req: products.requiresInstallation })
    .from(orderItems).innerJoin(products, eq(products.id, orderItems.productId)).where(eq(orderItems.orderId, o.id));
  await tx.update(orders).set({ status: 'fulfilling', paidAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, o.id));
  const alloc = await allocationOf(tx, o);
  const locs = [o.fulfillBranchId, ...new Set(alloc.map((a) => a.branchId).filter((b) => b !== o.fulfillBranchId))];
  for (const [n, loc] of locs.entries()) {
    const part = alloc.filter((a) => a.branchId === loc);
    if (!part.length) continue;
    const lines = part.map((a) => ({ ...items.find((i) => i.productId === a.productId)!, qty: a.qty }));
    const s = await createShipment(tx, {
      sourceType: 'order', sourceId: o.id, sourceNo: o.orderNo, branchId: o.branchId, fromBranchId: loc, mode: o.deliveryMode as DeliveryMode,
      recipientName: o.recipientName, recipientPhone: o.recipientPhone, address: o.address, city: o.city, postalCode: o.postalCode,
      itemsSummary: lines.map((i) => `${i.name} × ${i.qty}`).join(', ') + (locs.length > 1 ? ` (kiriman ${n + 1} dari ${locs.length})` : ''),
      weightKg: lines.reduce((t, i) => t + i.weightKg * i.qty, 0), isBulky: lines.some((i) => i.isBulky), needsInstallation: lines.some((i) => i.req),
      shippingFee: n === 0 ? o.shippingFee : 0, courierCode: o.courierCode, courierService: o.courierService,
    });
    await tx.insert(shipmentItems).values(part.map((a) => ({ shipmentId: s.id, productId: a.productId, qty: a.qty })));
  }
  void actor;
});

/** Satu pengiriman order selesai -> stok kiriman itu keluar; order selesai setelah semua kiriman diterima. */
onShipmentDelivered('order', async (tx, s, actor) => {
  const [o] = await tx.select().from(orders).where(eq(orders.id, s.sourceId)).limit(1);
  if (!o || o.status !== 'fulfilling') return;
  let lines = await tx.select({ productId: shipmentItems.productId, qty: shipmentItems.qty }).from(shipmentItems).where(eq(shipmentItems.shipmentId, s.id));
  if (!lines.length) lines = (await allocationOf(tx, o)).filter((a) => a.branchId === s.fromBranchId); // data lama tanpa rincian kiriman
  for (const i of lines) await commitReservedOut(tx, i.productId, s.fromBranchId, i.qty, { refType: 'order', refId: o.id, refNo: o.orderNo }, actor?.id);
  const { rows: [{ open }] } = await tx.execute<{ open: number }>(sql`select count(*)::int open from shipments where source_type = 'order' and source_id = ${o.id} and id <> ${s.id} and status not in ('delivered','cancelled')`);
  if (Number(open) === 0) await tx.update(orders).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, o.id));
});

export async function releaseOrder(tx: Tx, o: Order) {
  if (o.promoCode) { const { voidPromo } = await import('./promo.js'); await voidPromo(tx, 'order', o.id); }
  for (const a of await allocationOf(tx, o)) await releaseStock(tx, a.productId, a.branchId, a.qty, { refType: 'order', refId: o.id, refNo: o.orderNo });
  await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'order'), eq(payments.refId, o.id), eq(payments.status, 'pending')));
}

export async function cancelOrder(actor: AuthUser, id: string, reason: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!o) throw new HttpError(404, 'Order tidak ditemukan');
  if (!['cashier', 'branch-admin', 'branch-manager'].includes(actor.roleCode) || (actor.branch?.type === 'branch' && actor.branch.id !== o.branchId)) throw new HttpError(403, 'Tidak berwenang');
  if (o.status !== 'awaiting_payment') throw new HttpError(409, 'Hanya order yang belum dibayar yang dapat dibatalkan (pengembalian dana menyusul)');
  return db.transaction(async (tx) => {
    const [after] = await tx.update(orders).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() })
      .where(and(eq(orders.id, o.id), eq(orders.status, 'awaiting_payment'))).returning();
    if (!after) throw new HttpError(409, 'Order baru saja dibayar / ditutup oleh proses lain');
    await releaseOrder(tx, after);
    return after;
  });
}

/** Order belum dibayar melewati batas waktu -> kedaluwarsa, reservasi stok dilepas. */
export async function expireStaleOrders() {
  const stale = await db.select().from(orders).where(and(eq(orders.status, 'awaiting_payment'), lt(orders.expiresAt, sql`now()`)));
  let n = 0;
  for (const o of stale) {
    const done = await db.transaction(async (tx) => {
      const [after] = await tx.update(orders).set({ status: 'expired', cancelReason: 'Melewati batas waktu pembayaran', updatedAt: new Date() })
        .where(and(eq(orders.id, o.id), eq(orders.status, 'awaiting_payment'))).returning();
      if (after) await releaseOrder(tx, after); // sudah dibayar / dibatalkan proses lain -> lewati
      return !!after;
    });
    if (done) n++;
  }
  return n;
}

/** Kasir menerima pembayaran order di cabang (tunai / transfer). */
export async function payOrderAtCashier(actor: AuthUser, id: string, p: { method: 'cash' | 'transfer'; proofRef?: string | null }) {
  if (actor.roleCode !== 'cashier') throw new HttpError(403, 'Pembayaran dicatat Kasir');
  const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!o) throw new HttpError(404, 'Order tidak ditemukan');
  if (actor.branch?.type === 'branch' && actor.branch.id !== o.branchId) throw new HttpError(403, 'Order bukan milik cabang Anda');
  if (o.status !== 'awaiting_payment') throw new HttpError(409, 'Order sudah dibayar / ditutup');
  if (o.expiresAt < new Date()) throw new HttpError(409, 'Order sudah melewati batas waktu pembayaran');
  if (p.method === 'transfer' && !p.proofRef) throw new HttpError(400, 'Isi nomor referensi transfer');
  const { confirmPayment } = await import('./payments.js');
  // Satu transaksi + kunci order: klik ganda / dua kasir bersamaan tidak menghasilkan dua pembayaran
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(orders).where(eq(orders.id, o.id)).for('update').limit(1);
    if (!cur || cur.status !== 'awaiting_payment') throw new HttpError(409, 'Order sudah dibayar / ditutup');
    await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'order'), eq(payments.refId, o.id), eq(payments.status, 'pending')));
    const shiftId = p.method === 'cash' ? await cashShiftFor(actor, tx) : null;
    const paymentNo = await nextPaymentNo(tx);
    await tx.insert(payments).values({ paymentNo, kind: 'order', refId: o.id, refNo: o.orderNo, branchId: o.branchId, amount: o.total, method: p.method,
      status: 'pending', channel: 'cashier', proofRef: p.proofRef ?? null, shiftId });
    return confirmPayment(paymentNo, actor, undefined, tx);
  });
}

