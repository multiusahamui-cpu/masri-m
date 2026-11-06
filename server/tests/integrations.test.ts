import crypto from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { api, call, login, pool, q1, startApp, startFakes } from './helpers.js';

/** Integrasi pihak ketiga terhadap server tiruan: Midtrans (VA/QRIS/webhook), Biteship (ongkir/resi/webhook). */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let r: any;
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let B = '';
const db = pool;
const sig = (o: string, sc: string, ga: string) => crypto.createHash('sha512').update(`${o}${sc}${ga}SB-Mid-server-TEST`).digest('hex');
const notify = (orderId: string, gross: string, status = 'settlement', bad = false) => call('POST', `${B}/webhooks/midtrans`, { order_id: orderId, status_code: '200', gross_amount: gross, transaction_status: status, signature_key: bad ? 'x'.repeat(128) : sig(orderId, '200', gross) });
let jkt: any, sofa: any, tv: any, items: any[], order: any, charge: any, os: any, sh: any;

beforeAll(async () => {
  fakes = startFakes();
  app = await startApp();
  B = api();
  jkt = await q1(`select id from branches where code='JKT01'`);
  sofa = await q1(`select p.id from products p where name ilike '%sofa%' limit 1`);
  tv = await q1(`select p.id from products p where name ilike '%TV%' limit 1`);
  items = [{ productId: tv.id, qty: 1 }];
});
afterAll(async () => { app.server.close(); fakes.server.close(); });

test('Midtrans & Biteship end-to-end (server tiruan)', async () => {
r = await call('POST', `${B}/public/cart/quote`, { branchId: jkt.id, city: 'Bandung', items });
check(r.options.every((o) => o.mode !== 'partner') && r.courierNote, `tanpa kode pos: tidak ada kurir mitra (${r.courierNote})`);
r = await call('POST', `${B}/public/cart/quote`, { branchId: jkt.id, city: 'Bandung', postalCode: '40111', items });
const partner = r.options.filter((o) => o.mode === 'partner');
check(partner.length === 2 && partner[0].label === 'JNE Reguler', `ongkir Biteship: ${partner.map((o) => `${o.label} ${o.fee}`).join(', ')}`);
r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Uji Midtrans', phone: '081277770001' }, branchId: jkt.id, items,
  delivery: { mode: 'partner', address: 'Jl. Asia Afrika No. 1, Bandung', city: 'Bandung', postalCode: '40111', courierCode: 'jne', service: 'reg' }, paymentMethod: 'va', bank: 'bni' });
check(r.s === 201 && r.payment.bank === 'bni' && r.payment.vaNumber?.startsWith('12345'), `checkout VA BNI via Midtrans: ${r.payment?.vaNumber} ${r.error ?? ''}`);
order = r;
charge = fakes.tx[order.payment.paymentNo];
check(charge.body.bank_transfer.bank === 'bni' && charge.body.custom_expiry?.unit === 'minute' && charge.body.transaction_details.gross_amount === order.total, `request charge ke Midtrans benar (gross ${charge.body.transaction_details.gross_amount}, expiry ${charge.body.custom_expiry.expiry_duration} mnt)`);
r = await notify(order.payment.paymentNo, charge.gross_amount, 'settlement', true);
check(r.s === 401, 'webhook tanda tangan salah ditolak');
r = await notify(order.payment.paymentNo, charge.gross_amount);
check(r.s === 200 && (await q1(`select status from orders where order_no=$1`, [order.orderNo])).status === 'awaiting_payment', 'notifikasi palsu "settlement" (status asli masih pending) tidak melunasi');
fakes.settle(order.payment.paymentNo);
r = await notify(order.payment.paymentNo, charge.gross_amount);
os = await q1(`select o.status, s.id sid, s.postal_code, s.courier_service from orders o join shipments s on s.source_id=o.id where order_no=$1`, [order.orderNo]);
check(os.status === 'fulfilling' && os.postal_code === '40111' && os.courier_service === 'reg', `setelah settlement: order ${os.status}, pengiriman kode pos ${os.postal_code}`);
r = await notify(order.payment.paymentNo, charge.gross_amount);
check(r.s === 200, 'webhook berulang idempoten');

// QRIS
r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Uji QRIS', phone: '081277770002' }, branchId: jkt.id, items: [{ productId: sofa.id, qty: 1 }],
  delivery: { mode: 'pickup', address: '', city: 'Jakarta Timur' }, paymentMethod: 'qris' });
check(r.payment?.qrString?.startsWith('000201') && r.payment.qrUrl, `QRIS: qr_string & URL gambar tersedia`);

// Biteship booking + webhook
const fromBranch = await q1(`select from_branch_id from shipments where id=$1`, [os.sid]);
const isHo = (await q1(`select type from branches where id=$1`, [fromBranch.from_branch_id])).type === 'head_office';
const op = await login(isHo ? 'wh@masri-m.local' : 'admin.jkt@masri-m.local');
r = await op.post(`/shipments/${os.sid}/book`);
sh = await q1(`select status, external_ref, tracking_no from shipments where id=$1`, [os.sid]);
check(sh.status === 'in_transit' && sh.external_ref?.startsWith('bs-') && !sh.tracking_no, `booking Biteship: ${sh.external_ref}, resi menyusul (${r.error ?? 'ok'})`);
const bsReq = fakes.ships[sh.external_ref].body;
check(bsReq.destination_postal_code === 40111 && bsReq.courier_company === 'jne' && bsReq.courier_type === 'reg' && bsReq.origin_postal_code > 0, `request order ke Biteship benar (asal ${bsReq.origin_postal_code} → ${bsReq.destination_postal_code})`);
r = await call('POST', `${B}/webhooks/biteship/salah`, { order_id: sh.external_ref, status: 'delivered' });
check(r.s === 401, 'webhook Biteship token salah ditolak');
r = await call('POST', `${B}/webhooks/biteship/tok123`, { event: 'order.status', order_id: sh.external_ref, status: 'delivered' });
check((await q1(`select status from shipments where id=$1`, [os.sid])).status === 'in_transit', 'webhook "delivered" palsu (status asli confirmed) tidak menyelesaikan');
fakes.courier(sh.external_ref, 'picked');
r = await call('POST', `${B}/webhooks/biteship/tok123`, { event: 'order.status', order_id: sh.external_ref, status: 'picked' });
const sh2 = await q1(`select status, tracking_no, courier_status from shipments where id=$1`, [os.sid]);
check(sh2.tracking_no === `WB${sh.external_ref}` && sh2.courier_status === 'picked', `picked: resi ${sh2.tracking_no}`);
fakes.courier(sh.external_ref, 'delivered');
r = await call('POST', `${B}/webhooks/biteship/tok123`, { event: 'order.status', order_id: sh.external_ref, status: 'delivered' });
check((await q1(`select status from orders where order_no=$1`, [order.orderNo])).status === 'completed', 'delivered di kurir → order selesai, stok keluar');
r = await call('POST', `${B}/webhooks/biteship/tok123`, {});
check(r.s === 200, 'ping uji webhook tanpa order_id diterima');

// VA Permata (format respons berbeda: permata_va_number)
r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Uji Permata', phone: '081277770003' }, branchId: jkt.id, items: [{ productId: sofa.id, qty: 1 }],
  delivery: { mode: 'pickup', address: '', city: 'Jakarta Timur' }, paymentMethod: 'va', bank: 'permata' });
check(r.payment?.bank === 'permata' && r.payment.vaNumber?.startsWith('8562'), `order VA Permata ${r.payment?.vaNumber} ${r.error ?? ''}`);
});

