import { afterAll, beforeAll, expect, test } from 'vitest';
import { api, call, login, pool, q1, startApp, startFakes } from './helpers.js';

/** Akun nasabah: OTP WhatsApp, Akun Saya (pembiayaan, pesanan, akad, kwitansi), isolasi antar nasabah. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let B = '';

beforeAll(async () => { fakes = startFakes(); app = await startApp(); B = api(); });
afterAll(async () => { app.server.close(); fakes.server.close(); });

const lastOtp = async (phone: string) => {
  const r = await q1<{ body: string }>(`select body from notification_outbox where template='otp' and recipient=$1 order by created_at desc limit 1`, [phone]);
  return /\*(\d{6})\*/.exec(r.body)![1];
};
async function signIn(raw: string, phone: string) {
  const r1 = await call('POST', `${B}/customer/auth/request-otp`, { phone: raw });
  expect(r1.s, r1.error).toBe(200);
  const code = await lastOtp(phone);
  const res = await fetch(`${B}/customer/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: raw, code }) });
  expect(res.status).toBe(200);
  const ck = res.headers.get('set-cookie')!.split(';')[0];
  return { ck, get: (p: string) => call('GET', B + p, undefined, { cookie: ck }), post: (p: string, b?: unknown) => call('POST', B + p, b ?? {}, { cookie: ck }), patch: (p: string, b: unknown) => call('PATCH', B + p, b, { cookie: ck }) };
}

test('OTP: validasi, jeda, salah kode, kedaluwarsa', async () => {
  let r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '12345' });
  check(r.s === 400, 'nomor tidak valid ditolak');
  r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '+62 812-7777-0900' });
  check(r.s === 200 && r.sentTo === '+62812••••900' && !r.devCode, `kode dikirim ke ${r.sentTo}, tanpa devCode saat provider Fonnte`);
  const ob = await q1(`select channel, body from notification_outbox where template='otp' and recipient='6281277770900'`);
  check(ob?.channel === 'whatsapp' && /JANGAN/.test(ob.body), 'OTP masuk antrean WhatsApp');
  const otp = await q1(`select code_hash from customer_otps where phone='6281277770900'`);
  check(!ob.body.includes(otp.code_hash) && otp.code_hash.length === 64, 'kode disimpan sebagai hash');
  r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '081277770900' });
  check(r.s === 429, 'permintaan ulang < 1 menit ditolak');
  r = await call('POST', `${B}/customer/auth/verify`, { phone: '081277770900', code: '000000' });
  check(r.s === 400 && /Sisa percobaan 4/.test(r.error), `kode salah: ${r.error}`);
  await pool.query(`update customer_otps set attempts=5 where phone='6281277770900'`);
  r = await call('POST', `${B}/customer/auth/verify`, { phone: '081277770900', code: await lastOtp('6281277770900') });
  check(r.s === 429, 'setelah 5 kali salah, kode benar pun ditolak');
  await pool.query(`update customer_otps set attempts=0, expires_at=now() - interval '1 minute' where phone='6281277770900'`);
  r = await call('POST', `${B}/customer/auth/verify`, { phone: '081277770900', code: await lastOtp('6281277770900') });
  check(r.s === 400 && /kedaluwarsa/.test(r.error), 'kode kedaluwarsa ditolak');
});

test('Nomor baru: akun dibuat, lengkapi profil', async () => {
  const c = await signIn('081277770901', '6281277770901');
  let r = await c.get('/customer/me');
  check(r.profile.needsName && r.profile.customerNo.startsWith('CWEB-'), `akun baru ${r.profile.customerNo}`);
  r = await c.patch('/customer/me', { fullName: 'Lina Marlina', email: 'lina@example.com', city: 'Depok' });
  r = await c.get('/customer/me');
  check(r.profile.fullName === 'Lina Marlina' && !r.profile.needsName && r.profile.email === 'lina@example.com', 'profil tersimpan');
  r = await c.get('/customer/credits');
  check(r.s === 200 && r.credits.length === 0, 'belum ada pembiayaan');
  const otpUsed = await q1(`select count(*)::int n from customer_otps where phone='6281277770901' and consumed_at is not null`);
  check(otpUsed.n === 1, 'kode OTP sekali pakai');
  // Bukti persetujuan S&K + privasi tercatat saat masuk
  const cons = await q1(`select count(*)::int n, min(version) v from consents where subject_type='customer' and phone='+6281277770901'`);
  check(cons.n === 2 && cons.v === '2026-10', `consent login tercatat (${cons.n})`);
  // Hak data pribadi: unduh salinan & ajukan penghapusan
  r = await c.get('/customer/privacy/export');
  check(r.s === 200 && r.profiles[0].fullName === 'Lina Marlina' && r.consents.length === 2 && !JSON.stringify(r).includes('codeHash'), 'ekspor data pribadi');
  r = await c.post('/customer/privacy/request', { type: 'delete', note: 'tidak dipakai lagi' });
  check(r.s === 201 && /^TKT-/.test(r.ticketNo), `tiket penghapusan ${r.ticketNo}`);
  const tk = await q1(`select category, priority, channel from helpdesk_tickets where ticket_no=$1`, [r.ticketNo]);
  check(tk.category === 'account' && tk.priority === 'high' && tk.channel === 'web', 'tiket privasi ke Helpdesk');
  r = await call('POST', `${B}/customer/auth/logout`, {}, { cookie: c.ck });
  check(r.s === 200, 'logout');
});

test('Nasabah lama: pembiayaan aktif, akad, bayar angsuran, kwitansi, isolasi', async () => {
  // Nasabah dengan pembiayaan aktif; nomor tersimpan +62812…, masuk dengan format 0812…
  const who = await q1(`select c.phone, c.full_name, c.nik from credit_applications a join customers c on c.id=a.customer_id where a.status in ('active','paid_off') and c.phone like '+62%' order by (a.status='active') desc, a.created_at limit 1`);
  const local = `0${who.phone.slice(3)}`;
  const c = await signIn(local, `62${local.slice(1)}`);
  let r = await c.get('/customer/me');
  check(r.profile.fullName === who.full_name && r.kyc.nik === who.nik && r.kyc.monthlyIncome > 0, `data KYC ${who.full_name} tersedia untuk isi otomatis pengajuan baru`);
  r = await c.patch('/customer/me', { fullName: 'Nama Lain' });
  check(r.s === 409 || r.s === 200, `ganti nama: ${r.s}`);
  r = await c.get('/customer/credits');
  // Urutan file uji tidak tetap: pembiayaan bisa masih aktif atau sudah dilunasi oleh uji lain
  const act = r.credits.find((x: any) => x.status === 'active') ?? r.credits.find((x: any) => x.status === 'paid_off');
  const isActive = act?.status === 'active';
  check(act && (!isActive || act.position.outstanding > 0), `pembiayaan ${act?.status} ${act?.contractNo}, sisa ${act?.position?.outstanding}`);
  r = await c.get(`/customer/credits/${act.id}`);
  check(r.installments.length === act.tenor && r.timeline.length > 0 && (!isActive || r.settlement?.payable > 0), `detail: ${r.installments.length} angsuran, kutipan pelunasan ${r.settlement?.payable}`);
  const rec = r.receipts[0];
  r = (await c.get(`/customer/credits/${act.id}/contract`)).doc;
  check(r.contractNo === act.contractNo && r.clauses.length >= 8 && r.customer.nik.includes('••••') && r.schedule.length === act.tenor, `akad ${r.contractNo}: ${r.clauses.length} pasal, NIK disamarkan ${r.customer.nik}`);
  r = await c.post(`/customer/credits/${act.id}/pay`, { method: 'va', bank: 'bri' });
  if (isActive) check(r.s === 201 || r.s === 200, `buat VA angsuran: ${r.payment?.vaNumber ?? r.error}`);
  else check(r.s >= 400, `pembiayaan lunas tidak bisa dibayar lagi (${r.error})`);
  if (rec) {
    r = await c.get(`/customer/receipts/${rec.paymentNo}`);
    check(r.s === 200 && r.doc.number === rec.paymentNo, `kwitansi ${r.doc?.number}`);
  }
  // Isolasi: data nasabah lain
  const other = await q1(`select a.id from credit_applications a join customers c on c.id=a.customer_id where c.phone<>$1 and a.contract_no is not null limit 1`, [who.phone]);
  r = await c.get(`/customer/credits/${other.id}`);
  check(r.s === 404, 'pembiayaan nasabah lain tidak bisa dibuka');
  r = await c.get(`/customer/credits/${other.id}/contract`);
  check(r.s === 404, 'akad nasabah lain tidak bisa diunduh');
  const otherPay = await q1(`select p.payment_no from payments p join orders o on o.id=p.ref_id where p.kind='order' and o.recipient_phone='+6281299990001' and p.status='paid' limit 1`);
  if (otherPay) { r = await c.get(`/customer/receipts/${otherPay.payment_no}`); check(r.s === 404, 'kwitansi nasabah lain tidak bisa dibuka'); }
  // Cookie nasabah tidak berlaku untuk API internal
  r = await c.get('/credit/applications');
  check(r.s === 401, 'cookie nasabah ditolak di API staf');
  r = await call('GET', `${B}/customer/credits`);
  check(r.s === 401, 'tanpa sesi ditolak');
});

test('Staf: cetak akad lengkap (NIK utuh)', async () => {
  const bm = await login('mc.jkt@masri-m.local');
  const a = await q1(`select a.id, a.contract_no from credit_applications a join branches b on b.id=a.branch_id where b.code='JKT01' and a.contract_no is not null order by a.created_at limit 1`);
  const r = (await bm.get(`/credit/applications/${a.id}/contract-doc`)).doc;
  check(r.contractNo === a.contract_no && /^\d{16}$/.test(r.customer.nik), `akad staf ${r.contractNo}, NIK lengkap`);
});

test('Nomor Malaysia & Brunei: format E.164 sesuai negara', async () => {
  let r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '012-345 6789', country: 'MY', lang: 'ms' });
  check(r.s === 200 && r.sentTo.startsWith('+6012'), `MY: ${r.sentTo ?? r.error}`);
  const ob = await q1(`select body from notification_outbox where template='otp' and recipient='60123456789'`);
  check(/Kod log masuk/.test(ob?.body ?? ''), 'pesan OTP dalam Bahasa Melayu');
  r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '7123456', country: 'BN', lang: 'en' });
  check(r.s === 200 && r.sentTo.startsWith('+673'), `BN: ${r.sentTo ?? r.error}`);
  r = await call('POST', `${B}/customer/auth/request-otp`, { phone: '0812345678', country: 'MY' });
  check(r.s === 400, 'nomor Indonesia ditolak untuk negara Malaysia');
});
