import { afterAll, beforeAll, expect, test } from 'vitest';
import { hashPassword } from '../src/lib/security.js';
import { activeCredit, api, call, ensureShift, login, P, pool, pub, q1, startApp, startFakes } from './helpers.js';

/** Hardening: pengambilalihan akun, kunci login, sesi, OTP paralel, race condition, isolasi cabang, constraint DB. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let r: any;
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let B = '';
const raw = async (method: string, path: string, body?: unknown, cookie?: string) => {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { s: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], ...((await res.json().catch(() => ({}))) as object) } as Record<string, any>;
};

beforeAll(async () => {
  fakes = startFakes();
  app = await startApp();
  B = api();
});
afterAll(async () => { app.server.close(); fakes.server.close(); });

test('NIK nasabah lain tidak bisa dipakai untuk mengganti nomor HP (pengambilalihan akun)', async () => {
  const victim = await q1(`select c.id, c.nik, c.phone, c.full_name, c.branch_id from customers c where c.nik is not null and c.phone like '+62%' order by c.created_at limit 1`);
  const prod = await q1(`select p.id from products p join product_prices pp on pp.product_id=p.id and pp.country_code='ID' where p.status='active' limit 1`);
  const br = await q1(`select id from branches where code='JKT01'`);
  r = await pub('POST', '/public/credit-applications', {
    customer: { fullName: 'Penyerang', phone: '081299998888', nik: victim.nik, birthDate: '1990-01-01', city: 'Jakarta', address: 'Jl. Palsu 1', occupation: 'Lainnya', monthlyIncome: 9_000_000, maritalStatus: 'single', dependents: 0 },
    branchId: br.id, productId: prod.id, qty: 1, tenor: 12, dpPct: 20, consent: true });
  check(r.s === 409, `pengajuan dengan NIK orang lain + HP berbeda ditolak (${r.s} ${r.error})`);
  const after = await q1(`select phone, full_name from customers where id=$1`, [victim.id]);
  check(after.phone === victim.phone && after.full_name === victim.full_name, 'nomor HP & nama korban tidak berubah');
});

test('Login: kunci sementara, tidak membocorkan email terdaftar, status akun hanya untuk pemilik password', async () => {
  const ho = await q1(`select id from branches where type='head_office'`);
  await pool.query(`insert into users (email, full_name, password_hash, role_code, branch_id, must_change_password) values ('uji.kunci@masri-m.local', 'Uji Kunci', $1, 'support', $2, false)`, [await hashPassword(P), ho.id]);
  r = await raw('POST', '/auth/login', { email: 'tidak.ada@masri-m.local', password: 'salah' });
  const unknown = r;
  for (let i = 0; i < 4; i++) r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: 'salah' + i });
  check(r.s === 401 && r.error === unknown.error, `email terdaftar & tidak terdaftar memberi pesan sama (${r.error})`);
  r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: 'salah-kelima' });
  r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: P });
  check(r.s === 429, `setelah 5 kali salah akun dikunci sementara, password benar pun ditolak (${r.s} ${r.error})`);
  const u = await q1(`select status, locked_until from users where email='uji.kunci@masri-m.local'`);
  check(u.status === 'active' && u.locked_until, 'kunci sementara (bukan status locked permanen)');
  await pool.query(`update users set locked_until = now() - interval '1 minute' where email='uji.kunci@masri-m.local'`);
  r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: P });
  check(r.s === 200, 'setelah masa kunci lewat, login berhasil');
  await pool.query(`update users set status='inactive' where email='uji.kunci@masri-m.local'`);
  r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: 'salah' });
  check(r.s === 401, 'akun nonaktif + password salah: tetap pesan umum (status tidak dibocorkan)');
  r = await raw('POST', '/auth/login', { email: 'uji.kunci@masri-m.local', password: P });
  check(r.s === 403, 'akun nonaktif + password benar: diberi tahu nonaktif');
});

test('Sesi lama tidak berlaku setelah ganti password; token staf ≠ token nasabah', async () => {
  const ho = await q1(`select id from branches where type='head_office'`);
  await pool.query(`insert into users (email, full_name, password_hash, role_code, branch_id, must_change_password) values ('uji.sesi@masri-m.local', 'Uji Sesi', $1, 'support', $2, false)`, [await hashPassword(P), ho.id]);
  const a = await raw('POST', '/auth/login', { email: 'uji.sesi@masri-m.local', password: P });
  const b = await raw('POST', '/auth/login', { email: 'uji.sesi@masri-m.local', password: P });
  check((await raw('GET', '/auth/me', undefined, a.cookie)).s === 200, 'sesi A aktif');
  r = await raw('POST', '/auth/change-password', { currentPassword: P, newPassword: 'PasswordBaru2026' }, a.cookie);
  check(r.s === 200 && r.cookie, 'ganti password berhasil & sesi A diperbarui');
  check((await raw('GET', '/auth/me', undefined, b.cookie)).s === 401, 'sesi B (perangkat lain) langsung tidak berlaku');
  check((await raw('GET', '/auth/me', undefined, a.cookie)).s === 401, 'cookie lama A tidak berlaku');
  check((await raw('GET', '/auth/me', undefined, r.cookie)).s === 200, 'cookie baru berlaku');
  // Cookie staf tidak diterima sebagai sesi nasabah dan sebaliknya
  const staffJwt = r.cookie.split('=')[1];
  check((await raw('GET', '/customer/me', undefined, `masri_customer=${staffJwt}`)).s === 401, 'token staf ditolak di Akun Saya nasabah');
});

test('OTP: tebakan paralel tetap dibatasi 5 percobaan', async () => {
  r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '081277771234' });
  check(r.s === 200, 'kode diminta');
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', `${B}/customer/auth/verify`, { phone: '081277771234', code: String(100000 + i).padStart(6, '0') })));
  const processed = results.filter((x) => x.s === 400).length;
  const otp = await q1(`select attempts from customer_otps where phone='6281277771234' order by created_at desc limit 1`);
  check(processed <= 5 && otp.attempts <= 5, `hanya ${processed} tebakan diproses (attempts=${otp.attempts}), sisanya 429`);
  const body = (await q1<{ body: string }>(`select body from notification_outbox where template='otp' and recipient='6281277771234' order by created_at desc limit 1`)).body;
  r = await call('POST', `${B}/customer/auth/verify`, { phone: '081277771234', code: /\*(\d{6})\*/.exec(body)![1] });
  check(r.s === 429, 'setelah 5 percobaan kode benar pun ditolak');
});

test('Race condition: bayar angsuran paralel, serah terima ganda, bayar order dua kali', async () => {
  const a = await activeCredit('bdg', 'TV-LG-43UR', { phone: '+6281277775001', nik: '3273019999990001', name: 'Nasabah Uji Race' });
  check(a.status === 'active', `pembiayaan uji aktif ${a.app_no}`);
  const inst = await q1(`select count(*)::int n from installments where application_id=$1`, [a.id]);
  check(inst.n === 12, 'jadwal angsuran tepat 12 baris (tidak dobel)');
  await ensureShift('ksr.bdg@masri-m.local');
  const ksr = await login('ksr.bdg@masri-m.local');
  const pays = await Promise.all([1, 2, 3].map(() => ksr.post(`/cashier/credits/${a.id}/pay`, { amount: 100_000, method: 'cash' })));
  const ok = pays.filter((x) => x.s === 201 || x.s === 200).length;
  const paid = await q1(`select coalesce(sum(paid_amount),0)::float v from installments where application_id=$1`, [a.id]);
  const recorded = await q1(`select coalesce(sum(amount),0)::float v from payments where ref_id=$1 and kind='installment' and status='paid'`, [a.id]);
  check(ok >= 1 && Math.abs(paid.v - recorded.v) < 0.01 && Math.abs(paid.v - ok * 100_000) < 0.01, `${ok} pembayaran paralel, angsuran terbayar ${paid.v} = pembayaran tercatat ${recorded.v}`);

  // Order bayar di kasir: dua klik bersamaan -> hanya satu pembayaran lunas
  const jkt = await q1(`select id from branches where code='JKT01'`);
  const prod = await q1(`select s.product_id id from stock_levels s join product_prices pp on pp.product_id=s.product_id and pp.country_code='ID' where s.branch_id=$1 and s.on_hand - s.reserved > 0 limit 1`, [jkt.id]);
  r = await pub('POST', '/public/orders', { customer: { fullName: 'Uji Klik Ganda', phone: '081277775002' }, branchId: jkt.id, items: [{ productId: prod.id, qty: 1 }],
    delivery: { mode: 'pickup', address: '', city: 'Jakarta Timur' }, paymentMethod: 'cashier' });
  check(r.s === 201, `order ${r.orderNo ?? r.error}`);
  const o = await q1(`select id from orders where order_no=$1`, [r.orderNo]);
  await ensureShift('ksr.jkt@masri-m.local');
  const ksrJ = await login('ksr.jkt@masri-m.local');
  await Promise.all([ksrJ.post(`/orders/${o.id}/pay`, { method: 'cash' }), ksrJ.post(`/orders/${o.id}/pay`, { method: 'cash' })]);
  const op = await q1(`select count(*) filter (where status='paid')::int paid, (select count(*)::int from shipments where source_id=$1) ships from payments where ref_id=$1`, [o.id]);
  check(op.paid === 1 && op.ships === 1, `bayar ganda: ${op.paid} pembayaran lunas, ${op.ships} pengiriman`);

  // Kedaluwarsa tidak menimpa order yang sudah dibayar
  await pool.query(`update orders set expires_at = now() - interval '1 hour' where id=$1`, [o.id]);
  const { expireStaleOrders } = await import('../src/lib/orders.js');
  await expireStaleOrders();
  check((await q1(`select status from orders where id=$1`, [o.id])).status === 'fulfilling', 'order lunas tidak menjadi kedaluwarsa');
});

test('Isolasi cabang & role', async () => {
  const jktApp = await q1(`select a.id from credit_applications a join branches b on b.id=a.branch_id where b.code='JKT01' limit 1`);
  const ksrB = await login('ksr.bdg@masri-m.local');
  r = await ksrB.get(`/cashier/credits/${jktApp.id}`);
  check(r.s === 404, `kasir BDG tidak bisa membaca posisi kredit JKT (${r.s})`);
  r = await ksrB.get(`/credits/${jktApp.id}/settlement`);
  check(r.s === 404, `kasir BDG tidak bisa membaca kutipan pelunasan JKT (${r.s})`);
  const pay = await q1(`select payment_no from payments where status='paid' limit 1`);
  const mkt = await login('mkt@masri-m.local');
  r = await mkt.get(`/receipts/${pay.payment_no}`);
  check(r.s === 403, `role Marketing tidak bisa membuka kwitansi (${r.s})`);
  r = await mkt.post('/marketing/banners', { countryCode: 'ID', title: { id: 'Uji' }, imageUrl: 'javascript:alert(1)', startsAt: '2026-01-01', endsAt: '2027-01-01' });
  check(r.s === 400, 'URL javascript: ditolak');
  r = await ksrB.get('/cashier/credits/bukan-uuid');
  check(r.s === 400, `id tidak valid -> 400, bukan 500 (${r.s})`);
  r = await pub('POST', '/webhooks/payment', { paymentNo: 'X', status: 'paid' });
  check(r.s === 404 || r.s === 401, `webhook generik tanpa tanda tangan sudah dihapus (${r.s} ${r.error})`);
  // Gudang tidak bisa menetapkan rekening pemasok
  const wh = await login('wh@masri-m.local');
  r = await wh.post('/suppliers', { code: 'SUP-HRD', name: 'Pemasok Uji Hardening', countryCode: 'ID', bankName: 'BCA', accountNo: '99999999', accountName: 'Siapa Saja' });
  check(r.s === 201 && r.supplier.accountNo === null, 'rekening pemasok dari Gudang diabaikan (hanya Bookkeeping)');
});

test('Pemisahan tugas: pengaju refund tidak bisa menyetujui sendiri', async () => {
  const mc = await login('mc.pyk@masri-m.local');
  const o = await q1(`select o.order_no from orders o join branches b on b.id=o.branch_id where b.code='PYK01' and o.status='fulfilling' limit 1`);
  if (!o) return; // data demo tanpa order PYK lunas
  r = await mc.post('/refunds', { sourceNo: o.order_no, amount: 1000, reason: 'Uji pemisahan tugas', method: 'cash' });
  if (r.s !== 201) return;
  r = await mc.post(`/refunds/${r.refund.id}/decide`, { decision: 'approve' });
  check(r.s === 403, 'MC menyetujui refund yang diajukannya sendiri ditolak');
});

test('Pelacakan publik tidak menampilkan kode pengambilan', async () => {
  const s = await q1(`select o.order_no, o.recipient_phone, s.id sid from shipments s join orders o on o.id = s.source_id where s.source_type='order' and s.mode='pickup' and s.status='pending' limit 1`);
  if (!s) return;
  const ba = await q1(`select u.email from users u join shipments s on s.from_branch_id = u.branch_id where s.id=$1 and u.role_code in ('branch-admin','warehouse') limit 1`, [s.sid]);
  const op = await login(ba.email);
  r = await op.post(`/shipments/${s.sid}/prepare-pickup`);
  r = await pub('GET', `/public/orders/track?orderNo=${s.order_no}&phone=${encodeURIComponent(s.recipient_phone)}`);
  check(r.s === 200 && r.shipment && !r.shipment.pickupCode, 'kode pengambilan tidak ada di pelacakan publik');
});

test('Constraint basis data menolak stok negatif', async () => {
  const s = await q1(`select product_id, branch_id from stock_levels limit 1`);
  const e = await pool.query(`update stock_levels set on_hand = -1 where product_id=$1 and branch_id=$2`, [s.product_id, s.branch_id]).then(() => null, (x) => x);
  check(e && /stock_levels_nonneg_ck/.test(String(e.message)), `UPDATE stok negatif ditolak: ${e?.message}`);
});
