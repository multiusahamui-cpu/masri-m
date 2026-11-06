import { afterAll, beforeAll, expect, test } from 'vitest';
import { api, call, login, q1, startApp, startFakes } from './helpers.js';
import { BillplzGateway } from '../src/lib/gateways.js';
import { pollCourierUpdates } from '../src/lib/shipping.js';

/** Go global Asia: Malaysia (MYR, SST, Billplz FPX, EasyParcel) & Brunei (BND, bayar di cabang), isolasi stok & akuntansi per negara. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let B = '';
let kul: any, bsb: any, prod: any;
const billplzHook = (body: Record<string, string>) => fetch(`${B}/webhooks/billplz`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  .then(async (r) => ({ s: r.status, ...(await r.json().catch(() => ({}))) as object }) as any);

beforeAll(async () => {
  fakes = startFakes(); app = await startApp(); B = api();
  kul = await q1(`select id from branches where code = 'KUL01'`);
  bsb = await q1(`select id from branches where code = 'BSB01'`);
  prod = await q1(`select p.id, pp.cash_price::float price from products p join product_prices pp on pp.product_id = p.id and pp.country_code = 'MY'
    join stock_levels s on s.product_id = p.id and s.branch_id = $1 where s.on_hand - s.reserved >= 2 and not p.is_bulky order by p.name limit 1`, [kul.id]);
});
afterAll(async () => { app.server.close(); fakes.server.close(); });

test('Katalog & metode pembayaran per negara', async () => {
  let r = await call('GET', `${B}/catalog/products?country=MY`);
  check(r.country?.currency === 'MYR' && r.products.length > 0 && r.products[0].cashPrice < 100_000, `katalog MY dalam MYR (${r.products?.[0]?.cashPrice})`);
  r = await call('GET', `${B}/catalog/products?country=BN`);
  check(r.country?.currency === 'BND', 'katalog BN dalam BND');
  r = await call('GET', `${B}/public/payment-options?country=MY`);
  check(r.provider === 'billplz' && r.fpx && !r.qris && r.banks.length === 0, `MY: ${r.provider} FPX`);
  r = await call('GET', `${B}/public/payment-options?country=BN`);
  check(r.methods.length === 0 && /Bank Islam Brunei/.test(r.transferInfo), 'BN: bayar di cabang / transfer bank');
  r = await call('GET', `${B}/public/payment-options?country=ID`);
  check(r.provider === 'midtrans' && r.qris, 'ID tetap Midtrans');
});

test('Malaysia: EasyParcel, Billplz FPX, webhook bertanda tangan, booking & pelacakan resi', async () => {
  const items = [{ productId: prod.id, qty: 1 }];
  let r = await call('POST', `${B}/public/cart/quote`, { branchId: kul.id, city: 'Shah Alam', postalCode: '40100', items });
  const partner = r.options.filter((o: any) => o.mode === 'partner');
  check(r.currency === 'MYR' && r.tax === 0 && r.from?.id === kul.id, `keranjang MY: ${r.currency}, dikirim dari ${r.from?.name}`);
  check(partner.length === 2 && partner[0].fee === 9.8 && partner.every((o: any) => !/Xpress Lain/.test(o.label)), `ongkir EasyParcel (kurir aktif saja): ${partner.map((o: any) => `${o.label} ${o.fee}`).join(', ')}`);
  r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Aisyah binti Ahmad', phone: '012-345 6701' }, branchId: kul.id, items,
    delivery: { mode: 'partner', address: 'No. 8, Jalan Plumbum, Seksyen 7', city: 'Shah Alam', postalCode: '4010', courierCode: 'jnt', service: 'EP-CS0B' }, paymentMethod: 'fpx' });
  check(r.s === 400 && /poskod|kode pos/i.test(r.error), `poskod tidak valid ditolak: ${r.error}`);
  r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Aisyah binti Ahmad', phone: '0812-3456-7890' }, branchId: kul.id, items,
    delivery: { mode: 'partner', address: 'No. 8, Jalan Plumbum, Seksyen 7', city: 'Shah Alam', postalCode: '40100', courierCode: 'jnt', service: 'EP-CS0B' }, paymentMethod: 'fpx' });
  check(r.s === 400, 'nomor Indonesia ditolak untuk cabang Malaysia');
  r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Aisyah binti Ahmad', phone: '012-345 6701', email: 'aisyah@example.my' }, branchId: kul.id, items,
    delivery: { mode: 'partner', address: 'No. 8, Jalan Plumbum, Seksyen 7', city: 'Shah Alam', postalCode: '40100', courierCode: 'jnt', service: 'EP-CS0B' }, paymentMethod: 'fpx' });
  check(r.s === 201 && r.currency === 'MYR' && r.payment?.payUrl?.startsWith('http://fake/bills/'), `order FPX: ${r.orderNo} ${r.payment?.payUrl ?? r.error}`);
  const order = r;
  const o = await q1(`select recipient_phone, total::float total from orders where order_no = $1`, [order.orderNo]);
  check(o.recipient_phone === '+60123456701', `nomor disimpan E.164: ${o.recipient_phone}`);
  const bill = Object.values(fakes.bills).find((x: any) => x.reference_1 === order.payment.paymentNo) as any;
  check(bill && bill.amount === Math.round(o.total * 100) && bill.form.mobile === '+60123456701' && bill.form.callback_url.endsWith('/api/webhooks/billplz'), `tagihan Billplz ${bill?.amount} sen`);
  // Webhook palsu & webhook sebelum dibayar
  const cb = { id: bill.id, collection_id: 'col1', paid: 'true', state: 'paid', amount: String(bill.amount), paid_amount: String(bill.amount), paid_at: '2026-10-07 10:00:00 +0800' };
  r = await billplzHook({ ...cb, x_signature: 'x'.repeat(64) });
  check(r.s === 401, 'tanda tangan Billplz salah ditolak');
  r = await billplzHook({ ...cb, x_signature: BillplzGateway.sign(cb, 'sigkey') });
  let st = await q1(`select status from orders where order_no = $1`, [order.orderNo]);
  check(r.s === 200 && st.status === 'awaiting_payment', 'callback "paid" palsu (bill belum dibayar di Billplz) tidak melunasi');
  fakes.payBill(bill.id);
  r = await billplzHook({ ...cb, x_signature: BillplzGateway.sign(cb, 'sigkey') });
  st = await q1(`select o.status, s.id sid, s.from_branch_id from orders o join shipments s on s.source_id = o.id where o.order_no = $1`, [order.orderNo]);
  check(st.status === 'fulfilling' && st.from_branch_id === kul.id, `setelah dibayar: ${st.status}`);
  // Booking EasyParcel & pelacakan berkala
  const adm = await login('admin.kul@masri-m.local');
  r = await adm.post(`/shipments/${st.sid}/book`);
  const sh = await q1(`select status, tracking_no, external_ref from shipments where id = $1`, [st.sid]);
  check(sh.status === 'in_transit' && /^ER\d+MY$/.test(sh.tracking_no), `booking EasyParcel: resi ${sh.tracking_no} (${r.error ?? 'ok'})`);
  const ep = Object.values(fakes.epOrders)[0] as any;
  check(ep.form['bulk[0][pick_state]'] === 'kul' && ep.form['bulk[0][send_state]'] === 'sgr' && ep.form['bulk[0][send_country]'] === 'MY', 'negeri dari poskod: KL → Selangor');
  fakes.epAwb[sh.tracking_no] = 'Delivered';
  await pollCourierUpdates();
  const done = await q1(`select status from shipments where id = $1`, [st.sid]);
  check(done.status === 'delivered', `status resi diperbarui lewat polling: ${done.status}`);
  const rc = await call('GET', `${B}/public/receipts/${order.payment.paymentNo}?phone=0123456701`);
  check(rc.doc?.currency === 'MYR' && rc.doc.notes.some((n: string) => /SST/.test(n)), `kwitansi MYR dengan catatan SST: ${rc.doc?.notes}`);
});

test('Brunei: tanpa gateway & kurir mitra, bayar di cabang', async () => {
  const p = await q1(`select p.id from products p join stock_levels s on s.product_id = p.id and s.branch_id = $1 where s.on_hand - s.reserved >= 1 limit 1`, [bsb.id]);
  const items = [{ productId: p.id, qty: 1 }];
  let r = await call('POST', `${B}/public/cart/quote`, { branchId: bsb.id, city: 'Bandar Seri Begawan', postalCode: 'BE1518', items });
  check(r.currency === 'BND' && !r.options.some((o: any) => o.mode === 'partner') && r.options.some((o: any) => o.mode === 'internal'), `BN: ${r.options.map((o: any) => o.label).join(', ')}`);
  r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Hajah Nurul', phone: '7123401' }, branchId: bsb.id, items,
    delivery: { mode: 'internal', address: 'Simpang 22, Kampong Kiarong', city: 'Bandar Seri Begawan', postalCode: 'BE1518' }, paymentMethod: 'fpx' });
  check(r.s === 400, `pembayaran online ditolak di BN: ${r.error}`);
  r = await call('POST', `${B}/public/orders`, { customer: { fullName: 'Hajah Nurul', phone: '7123401' }, branchId: bsb.id, items,
    delivery: { mode: 'internal', address: 'Simpang 22, Kampong Kiarong', city: 'Bandar Seri Begawan', postalCode: 'BE1518' }, paymentMethod: 'cashier' });
  check(r.s === 201 && r.currency === 'BND' && !r.payment, `order BN bayar di cabang ${r.orderNo ?? r.error}`);
  const c = await q1(`select phone from customers where full_name = 'Hajah Nurul'`);
  check(c.phone === '+6737123401', `nomor BN E.164: ${c.phone}`);
});

test('Isolasi negara: tanpa transfer lintas negara, pembiayaan dalam mata uang lokal', async () => {
  const wh = await login('wh@masri-m.local');
  let r = await wh.post('/inventory/transfers', { toBranchId: kul.id, items: [{ productId: prod.id, qty: 1 }] });
  check(r.s === 400 && /lintas negara/.test(r.error), `transfer ke KL ditolak: ${r.error}`);
  r = await call('POST', `${B}/public/credit-applications`, {
    customer: { fullName: 'Muhammad Faiz bin Ismail', phone: '019-8765432', nik: '900101-14-5678', birthDate: '1990-01-01', city: 'Kuala Lumpur', address: 'No. 3, Jalan Ampang, Kuala Lumpur',
      occupation: 'Jurutera', monthlyIncome: 7_500, maritalStatus: 'married', dependents: 1 },
    branchId: kul.id, productId: prod.id, qty: 1, tenor: 12, dpPct: 10, consent: true });
  check(r.s === 201 && r.terms.currency === 'MYR' && r.terms.downPayment < 1000, `pembiayaan MY: ${r.appNo} uang muka ${r.terms?.downPayment} ${r.terms?.currency}`);
  const a = await q1(`select currency from credit_applications where app_no = $1`, [r.appNo]);
  check(a.currency === 'MYR', 'mata uang akad MYR');
});

test('Akuntansi per negara: laporan seimbang dalam mata uang masing-masing', async () => {
  const acc = await login('acc@masri-m.local');
  for (const c of ['ID', 'MY', 'BN']) {
    const tb = await acc.get(`/accounting/trial-balance?from=2000-01-01&country=${c}`);
    const bs = await acc.get(`/accounting/balance-sheet?country=${c}`);
    check(tb.balanced && bs.balanced && bs.currency === { ID: 'IDR', MY: 'MYR', BN: 'BND' }[c], `${c}: neraca saldo & neraca seimbang (${bs.currency}, aset ${bs.totalAssets.total})`);
    check(bs.branches.every((b: any) => b.countryCode === c), `${c}: hanya kantor ${c}`);
  }
  const my = await acc.get('/accounting/balance-sheet?country=MY');
  const inv = my.assets.flatMap((g: any) => g.rows).find((r: any) => r.code === '1301');
  check(inv && inv.total > 0 && inv.total < 1_000_000, `persediaan KL dalam MYR: ${inv?.total}`);
  const ho = await q1(`select id from branches where type = 'head_office'`);
  const r = await acc.post('/accounting/journals', { date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }), memo: 'Uji lintas negara', lines: [
    { accountCode: '1102', branchId: kul.id, debit: 100, credit: 0 }, { accountCode: '1102', branchId: ho.id, debit: 0, credit: 100 }] });
  check(r.s === 400 && /satu negara/.test(r.error), `jurnal lintas negara ditolak: ${r.error}`);
  const mcK = await login('mc.kul@masri-m.local');
  const own = await mcK.get('/accounting/income-statement');
  check(own.currency === 'MYR' && own.branches.length === 1, 'Pengurus Cawangan KL melihat laporan cabangnya dalam MYR');
});

test('Bahasa: notifikasi WhatsApp ikut negara nomor, akad tersedia dalam 3 bahasa', async () => {
  const wa = await q1(`select body from notification_outbox where template = 'order_created' and recipient = '+60123456701' order by id desc limit 1`);
  check(/telah kami terima/.test(wa?.body ?? '') && /FPX/.test(wa.body), 'pesanan MY: pesan dalam Bahasa Melayu dengan tautan FPX');
  const idMsg = await q1(`select body from notification_outbox where template = 'order_created' and recipient like '+62%' order by id desc limit 1`);
  check(!idMsg || /sudah kami terima/.test(idMsg.body), 'pesanan ID tetap Bahasa Indonesia');
  const mc = await login('mc.jkt@masri-m.local');
  const a = await q1(`select a.id from credit_applications a join branches b on b.id = a.branch_id where b.code = 'JKT01' and a.contract_no is not null limit 1`);
  const en = (await mc.get(`/credit/applications/${a.id}/contract-doc?lang=en`)).doc;
  const ms = (await mc.get(`/credit/applications/${a.id}/contract-doc?lang=ms`)).doc;
  const id = (await mc.get(`/credit/applications/${a.id}/contract-doc`)).doc;
  check(en.lang === 'en' && /Seller/.test(en.clauses[0]) && /BASYARNAS/.test(en.clauses[7]), 'akad bahasa Inggris (forum sengketa Indonesia)');
  check(ms.lang === 'ms' && /Penjual/.test(ms.clauses[0]) && /dipersetujui/.test(ms.clauses[0]), 'akad Bahasa Melayu');
  check(id.lang === 'id' && /disepakati/.test(id.clauses[0]), 'akad cabang Indonesia default Bahasa Indonesia');
});
