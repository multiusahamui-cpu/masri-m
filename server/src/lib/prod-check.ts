/**
 * Pemeriksaan konfigurasi sebelum API berjalan di production.
 * Kesalahan fatal menghentikan proses agar server tidak pernah melayani nasabah dengan
 * gateway tiruan, secret contoh, atau tanpa HTTPS. Untuk staging yang sengaja memakai
 * mode tiruan, set ALLOW_INSECURE_PRODUCTION=true (semua kesalahan menjadi peringatan).
 */
export interface ProdCheckResult { errors: string[]; warnings: string[] }

const WEAK = /test|ganti|change|secret|example|contoh|masrim_dev|password/i;

export function checkProduction(e: NodeJS.ProcessEnv = process.env): ProdCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const v = (k: string) => (e[k] ?? '').trim();
  const lower = (k: string, d: string) => (v(k) || d).toLowerCase();

  // Secret & kredensial
  const jwt = v('JWT_SECRET');
  if (jwt.length < 48) errors.push('JWT_SECRET minimal 48 karakter acak (buat: openssl rand -base64 48)');
  else if (WEAK.test(jwt)) errors.push('JWT_SECRET terlihat seperti contoh — ganti dengan string acak');
  const sa = v('SUPERADMIN_PASSWORD');
  if (!sa || sa === 'GantiSegera#2026') errors.push('SUPERADMIN_PASSWORD masih default — isi password awal yang kuat');
  if (/:masrim_dev@|:postgres@|:password@/.test(v('DATABASE_URL'))) errors.push('DATABASE_URL memakai password contoh');

  // URL publik & HTTPS
  const web = v('PUBLIC_WEB_URL');
  if (!web) errors.push('PUBLIC_WEB_URL wajib diisi (mis. https://masri-m.com)');
  else if (!web.startsWith('https://')) errors.push('PUBLIC_WEB_URL harus https://');
  if (v('ENABLE_DEV_SIMULATION') === 'true') errors.push('ENABLE_DEV_SIMULATION harus false di production');
  if (v('RATE_LIMIT') === 'off') errors.push('RATE_LIMIT=off tidak boleh di production');

  // Pembayaran — gateway tiruan menghasilkan nomor VA palsu
  if (lower('PAYMENT_PROVIDER', 'mock') === 'mock') errors.push('PAYMENT_PROVIDER masih mock — isi midtrans');
  if (lower('PAYMENT_PROVIDER_MY', 'mock') === 'mock') errors.push('PAYMENT_PROVIDER_MY masih mock — isi billplz, atau none bila Malaysia belum dibuka');
  if (lower('PAYMENT_PROVIDER_BN', 'none') === 'mock') errors.push('PAYMENT_PROVIDER_BN=mock tidak boleh di production');
  if (lower('PAYMENT_PROVIDER', 'mock') === 'midtrans' && v('MIDTRANS_IS_PRODUCTION') !== 'true') warnings.push('Midtrans masih mode SANDBOX (MIDTRANS_IS_PRODUCTION bukan true)');
  if (lower('PAYMENT_PROVIDER_MY', 'mock') === 'billplz' && v('BILLPLZ_IS_PRODUCTION') !== 'true') warnings.push('Billplz masih mode SANDBOX');

  // Kurir
  if (lower('SHIPPING_PROVIDER', 'mock') === 'mock') errors.push('SHIPPING_PROVIDER masih mock — isi biteship');
  if (lower('SHIPPING_PROVIDER_MY', 'mock') === 'mock') errors.push('SHIPPING_PROVIDER_MY masih mock — isi easyparcel, atau none');
  if (lower('SHIPPING_PROVIDER_MY', 'mock') === 'easyparcel' && v('EASYPARCEL_IS_PRODUCTION') !== 'true') warnings.push('EasyParcel masih mode DEMO');

  // Notifikasi — login nasabah memakai kode WhatsApp
  if (lower('WHATSAPP_PROVIDER', 'log') !== 'fonnte' || !v('FONNTE_TOKEN')) errors.push('WhatsApp belum dikonfigurasi (WHATSAPP_PROVIDER=fonnte + FONNTE_TOKEN) — nasabah tidak bisa menerima kode masuk');
  if (lower('SHIPPING_PROVIDER', 'mock') === 'biteship' && v('BITESHIP_WEBHOOK_TOKEN').length < 24) errors.push('BITESHIP_WEBHOOK_TOKEN minimal 24 karakter acak');
  if (!v('SMTP_URL')) warnings.push('SMTP_URL kosong — salinan notifikasi email tidak terkirim');

  // Penyimpanan & lain-lain
  if (lower('STORAGE_DRIVER', 'local') === 'local') warnings.push('STORAGE_DRIVER=local — pastikan folder uploads ada di volume yang ikut di-backup');
  if (!v('ANTHROPIC_API_KEY')) warnings.push('ANTHROPIC_API_KEY kosong — Asisten Virtual offline');
  if (!v('ALERT_WHATSAPP') && !v('ALERT_EMAIL')) warnings.push('ALERT_WHATSAPP / ALERT_EMAIL kosong — alert operasional tidak terkirim ke siapa pun');

  if (v('ALLOW_INSECURE_PRODUCTION') === 'true') return { errors: [], warnings: [...errors.map((x) => `[diizinkan] ${x}`), ...warnings] };
  return { errors, warnings };
}
