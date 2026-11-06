/**
 * Uji integrasi NYATA ke sandbox penyedia (bukan server tiruan). Membaca server/.env (atau env container).
 *   pnpm --filter masrim-server smoke                 -> semua yang sudah dikonfigurasi
 *   pnpm --filter masrim-server smoke -- midtrans s3  -> hanya yang disebut
 * Di VPS: docker compose -f docker-compose.prod.yml exec api node dist/scripts/smoke-integrations.js
 *
 * Variabel tambahan untuk uji: SMOKE_PHONE (nomor WA penerima uji), SMOKE_EMAIL, SMOKE_ORIGIN_POSTAL /
 * SMOKE_DEST_POSTAL (default 13230 → 40111), SMOKE_MY_ORIGIN_POSTAL / SMOKE_MY_DEST_POSTAL (50450 → 10200).
 * Tidak ada uang sungguhan yang berpindah selama kunci yang dipakai adalah kunci SANDBOX.
 */
import 'dotenv/config';

type Result = { name: string; status: 'LULUS' | 'GAGAL' | 'LEWATI'; note: string };
const results: Result[] = [];
const only = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((a) => a.toLowerCase());
const want = (k: string) => !only.length || only.includes(k);
const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);

async function step(key: string, name: string, configured: boolean | string, fn: () => Promise<string>) {
  if (!want(key)) return;
  if (configured !== true) { results.push({ name, status: 'LEWATI', note: typeof configured === 'string' ? configured : 'belum dikonfigurasi' }); return; }
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, status: 'LULUS', note: `${note} (${Date.now() - t0} ms)` });
  } catch (e) {
    results.push({ name, status: 'GAGAL', note: e instanceof Error ? e.message : String(e) });
  }
}
const env = (k: string) => (process.env[k] ?? '').trim();
const isLive = (k: string) => env(k) === 'true';

const { getPaymentGateway } = await import('../lib/gateways.js');
const { getCourierProvider } = await import('../lib/couriers.js');
const { sendDirect } = await import('../lib/notify.js');
const { getStorage } = await import('../lib/storage.js');

// ---------- Pembayaran
await step('midtrans', 'Midtrans — Virtual Account BCA', env('PAYMENT_PROVIDER') === 'midtrans' || 'PAYMENT_PROVIDER bukan midtrans', async () => {
  if (isLive('MIDTRANS_IS_PRODUCTION')) throw new Error('MIDTRANS_IS_PRODUCTION=true — uji ini hanya untuk sandbox');
  const g = getPaymentGateway('ID');
  const r = await g.createCharge({ paymentNo: `SMOKE-VA-${stamp}`, amount: 10000, method: 'va', bank: 'bca', customerName: 'Uji Integrasi', customerPhone: '081200000000', expiresAt: new Date(Date.now() + 3600_000) });
  if (!r.vaNumber) throw new Error('nomor VA kosong');
  return `VA ${r.bank?.toUpperCase()} ${r.vaNumber} — bayar di simulator: https://simulator.sandbox.midtrans.com`;
});
await step('midtrans', 'Midtrans — QRIS', env('PAYMENT_PROVIDER') === 'midtrans' || 'PAYMENT_PROVIDER bukan midtrans', async () => {
  if (isLive('MIDTRANS_IS_PRODUCTION')) throw new Error('hanya untuk sandbox');
  const r = await getPaymentGateway('ID').createCharge({ paymentNo: `SMOKE-QR-${stamp}`, amount: 10000, method: 'qris', customerName: 'Uji Integrasi', expiresAt: new Date(Date.now() + 3600_000) });
  if (!r.qrString && !r.qrUrl) throw new Error('QR kosong');
  return `QR dibuat (${r.gatewayRef})`;
});
await step('billplz', 'Billplz (Malaysia) — tagihan FPX', env('PAYMENT_PROVIDER_MY') === 'billplz' || 'PAYMENT_PROVIDER_MY bukan billplz', async () => {
  if (isLive('BILLPLZ_IS_PRODUCTION')) throw new Error('BILLPLZ_IS_PRODUCTION=true — uji ini hanya untuk sandbox');
  const r = await getPaymentGateway('MY').createCharge({ paymentNo: `SMOKE-FPX-${stamp}`, amount: 1, method: 'fpx', customerName: 'Ujian Integrasi', customerEmail: env('SMOKE_EMAIL') || 'ujian@example.com', customerPhone: '+60123456789', currency: 'MYR', returnUrl: `${env('PUBLIC_WEB_URL') || 'http://localhost:3000'}/` });
  if (!r.payUrl) throw new Error('URL pembayaran kosong');
  return `buka & bayar (sandbox): ${r.payUrl}`;
});

// ---------- Kurir
await step('biteship', 'Biteship — cek tarif', env('SHIPPING_PROVIDER') === 'biteship' || 'SHIPPING_PROVIDER bukan biteship', async () => {
  const q = await getCourierProvider('ID').quote({
    origin: { city: 'Jakarta Timur', postalCode: env('SMOKE_ORIGIN_POSTAL') || '13230' }, dest: { city: 'Bandung', postalCode: env('SMOKE_DEST_POSTAL') || '40111' },
    weightKg: 5, isBulky: false, couriers: ['jne', 'jnt', 'sicepat', 'anteraja'], value: 1_000_000, itemName: 'Uji integrasi',
  });
  if (!q.length) throw new Error('tidak ada tarif — periksa saldo/aktivasi kurir di dashboard Biteship');
  return q.slice(0, 3).map((x) => `${x.courierName} ${x.serviceName} Rp${x.price.toLocaleString('id-ID')}`).join('; ');
});
await step('easyparcel', 'EasyParcel (Malaysia) — cek tarif', env('SHIPPING_PROVIDER_MY') === 'easyparcel' || 'SHIPPING_PROVIDER_MY bukan easyparcel', async () => {
  const q = await getCourierProvider('MY').quote({
    origin: { city: 'Kuala Lumpur', postalCode: env('SMOKE_MY_ORIGIN_POSTAL') || '50450' }, dest: { city: 'George Town', postalCode: env('SMOKE_MY_DEST_POSTAL') || '10200' },
    weightKg: 5, isBulky: false, couriers: [], value: 500, itemName: 'Ujian integrasi',
  });
  if (!q.length) throw new Error('tidak ada tarif');
  return q.slice(0, 3).map((x) => `${x.courierName} RM${x.price}`).join('; ');
});

// ---------- Notifikasi
await step('whatsapp', 'Fonnte — kirim WhatsApp uji', (env('WHATSAPP_PROVIDER') === 'fonnte' && !!env('FONNTE_TOKEN') && !!env('SMOKE_PHONE')) || 'perlu WHATSAPP_PROVIDER=fonnte, FONNTE_TOKEN, SMOKE_PHONE', async () => {
  await sendDirect('whatsapp', env('SMOKE_PHONE'), 'Uji', `Pesan uji integrasi Masri-M (${stamp}). Abaikan pesan ini.`);
  return `terkirim ke ${env('SMOKE_PHONE')} — pastikan pesan diterima di HP`;
});
await step('email', 'SMTP — kirim email uji', (!!env('SMTP_URL') && !!env('SMOKE_EMAIL')) || 'perlu SMTP_URL dan SMOKE_EMAIL', async () => {
  await sendDirect('email', env('SMOKE_EMAIL'), 'Uji integrasi Masri-M', `Email uji (${stamp}). Abaikan.`);
  return `terkirim ke ${env('SMOKE_EMAIL')}`;
});

// ---------- Penyimpanan
await step('s3', 'Penyimpanan S3/MinIO — tulis & baca', env('STORAGE_DRIVER') === 's3' || 'STORAGE_DRIVER bukan s3', async () => {
  const st = getStorage();
  const key = `smoke/${stamp}.txt`;
  const data = Buffer.from(`uji ${stamp}`);
  await st.put(key, data, 'text/plain');
  const back = await st.get(key);
  if (!back.equals(data)) throw new Error('isi file berbeda');
  return `objek ${key} tersimpan di bucket ${env('S3_BUCKET')}`;
});

// ---------- Asisten Virtual
await step('claude', 'Claude API — Asisten Virtual', !!env('ANTHROPIC_API_KEY') || 'ANTHROPIC_API_KEY kosong', async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const c = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  const r = await c.messages.create({ model: env('ASSISTANT_MODEL') || 'claude-haiku-4-5', max_tokens: 20, messages: [{ role: 'user', content: 'Jawab satu kata: halo' }] });
  return `model ${r.model} menjawab`;
});

// ---------- Akses publik (webhook harus bisa dijangkau penyedia)
await step('public', 'URL publik & HTTPS', (!!env('PUBLIC_WEB_URL') && !env('PUBLIC_WEB_URL').includes('localhost')) || 'PUBLIC_WEB_URL masih localhost (webhook tidak bisa diterima)', async () => {
  const r = await fetch(`${env('PUBLIC_WEB_URL').replace(/\/$/, '')}/api/health`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${env('PUBLIC_WEB_URL')} sehat`;
});

// ---------- Ringkasan
const w = Math.max(...results.map((r) => r.name.length), 10);
console.log('\nHasil uji integrasi Masri-M\n' + '-'.repeat(w + 60));
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(w)}  ${r.note}`);
const failed = results.filter((r) => r.status === 'GAGAL').length;
console.log('-'.repeat(w + 60) + `\n${results.filter((r) => r.status === 'LULUS').length} lulus, ${failed} gagal, ${results.filter((r) => r.status === 'LEWATI').length} dilewati`);
process.exit(failed ? 1 : 0);
