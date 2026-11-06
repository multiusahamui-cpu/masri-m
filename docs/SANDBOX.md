# Checklist Akun Sandbox & Uji Integrasi Nyata

Kode integrasi Masri-M sudah diuji otomatis terhadap server tiruan. Dokumen ini memandu Anda mendaftar
akun **sandbox** di setiap penyedia, lalu menguji ke server mereka yang sebenarnya. Tidak ada uang
sungguhan yang berpindah selama kunci yang dipakai adalah kunci sandbox.

> Tampilan dashboard penyedia bisa berubah sewaktu-waktu. Jika nama menu berbeda, cari menu dengan
> fungsi yang sama (API Key / Access Key, Webhook / Notification URL).

## Urutan yang disarankan

| # | Penyedia | Untuk | Wajib go-live? | Perkiraan waktu |
|---|----------|-------|----------------|-----------------|
| 1 | Fonnte | WhatsApp: kode masuk nasabah, notifikasi | Ya | 15 menit |
| 2 | Midtrans | Pembayaran Indonesia: VA & QRIS | Ya | 30 menit (sandbox langsung aktif) |
| 3 | Biteship | Kurir mitra Indonesia | Ya (bila memakai kurir mitra) | 30 menit |
| 4 | SMTP (email) | Salinan notifikasi email | Disarankan | 15 menit |
| 5 | Claude API | Asisten Virtual | Opsional | 10 menit |
| 6 | Billplz | Pembayaran Malaysia (FPX) | Saat Malaysia dibuka | 30 menit |
| 7 | EasyParcel | Kurir Malaysia | Saat Malaysia dibuka | 1–2 hari kerja |

Semua kunci diisi di `server/.env` (laptop) atau `server/.env.production` (VPS). **Jangan** kirim kunci
lewat chat/email, dan jangan commit file `.env`.

---

## 1. Fonnte (WhatsApp)

1. Daftar di **fonnte.com**, masuk ke dashboard.
2. Menu **Device** → tambah device dengan nomor WhatsApp bisnis Masri-M → scan QR dari HP (WhatsApp → Perangkat tertaut).
3. Salin **Token** device.
4. Isi:
   ```
   WHATSAPP_PROVIDER=fonnte
   FONNTE_TOKEN=<token device>
   ```
5. Pastikan paket/kuota pesan mencukupi. Untuk volume besar di kemudian hari, pertimbangkan WhatsApp Business API resmi (Meta).

## 2. Midtrans (Indonesia)

1. Daftar di **midtrans.com** → masuk **Dashboard** → pastikan mode **Sandbox** (pojok kiri atas).
2. **Settings → Access Keys**: salin **Server Key** (diawali `SB-Mid-server-`).
3. **Settings → Payment → Notification URL** (di beberapa versi: *Settings → Configuration*), isi:
   `https://<domain-anda>/api/webhooks/midtrans`
4. Aktifkan metode **Bank Transfer (VA)** BCA/BNI/BRI/Permata dan **QRIS** bila diminta.
5. Isi:
   ```
   PAYMENT_PROVIDER=midtrans
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxx
   MIDTRANS_IS_PRODUCTION=false
   ```
6. Uji bayar: buat pesanan di website → salin nomor VA → bayar di **Midtrans Simulator**
   (simulator.sandbox.midtrans.com) → status pesanan harus berubah menjadi *Dibayar* dalam beberapa detik.

**Go-live:** ajukan aktivasi Production (dokumen badan usaha), ganti ke Server Key production (`Mid-server-…`),
set `MIDTRANS_IS_PRODUCTION=true`, dan isi Notification URL di dashboard **Production**.

## 3. Biteship (kurir Indonesia)

1. Daftar di **biteship.com** → dashboard.
2. Menu **Integrations / API Keys** → buat API key **testing** (diawali `biteship_test.`).
3. Menu **Webhook** → tambahkan URL:
   `https://<domain-anda>/api/webhooks/biteship/<BITESHIP_WEBHOOK_TOKEN>`
   (`BITESHIP_WEBHOOK_TOKEN` = string acak buatan Anda sendiri, min. 24 karakter; `openssl rand -hex 16`).
4. Isi:
   ```
   SHIPPING_PROVIDER=biteship
   BITESHIP_API_KEY=biteship_test.xxxxxxxx
   BITESHIP_WEBHOOK_TOKEN=<string acak>
   ```
5. Pastikan **kode pos** setiap cabang sudah diisi di menu Super Admin → Kantor & Cabang (dipakai sebagai asal kiriman).

**Go-live:** isi saldo Biteship, buat API key **live**, ganti `BITESHIP_API_KEY`.

## 4. Email (SMTP)

Pakai email domain sendiri (mis. `no-reply@masri-m.com` dari penyedia hosting/email) atau layanan
transaksional (Brevo, Mailgun, Amazon SES).
```
SMTP_URL=smtps://no-reply%40masri-m.com:PASSWORD@mail.masri-m.com:465
MAIL_FROM=Masri-M Syariah <no-reply@masri-m.com>
```
Karakter `@` di username ditulis `%40`. Atur SPF/DKIM domain agar email tidak masuk spam.

## 5. Claude API (Asisten Virtual)

1. Masuk **Claude Console** (console.anthropic.com) → **API Keys** → buat key.
2. Atur **batas pemakaian bulanan** (Billing / Limits) sebagai pengaman biaya.
3. Isi `ANTHROPIC_API_KEY=sk-ant-…` (hanya di server, tidak pernah di frontend).

## 6. Billplz (Malaysia, FPX)

1. Daftar akun sandbox di **billplz-sandbox.com**.
2. **Settings**: salin **API Secret Key** dan **X Signature Key** (aktifkan X Signature).
3. **Billing → Collections**: buat collection, salin **Collection ID**.
4. Isi:
   ```
   PAYMENT_PROVIDER_MY=billplz
   BILLPLZ_API_KEY=...
   BILLPLZ_COLLECTION_ID=...
   BILLPLZ_X_SIGNATURE=...
   BILLPLZ_IS_PRODUCTION=false
   ```
   URL callback dikirim otomatis per tagihan (`https://<domain>/api/webhooks/billplz`), tidak perlu diisi di dashboard.
5. Bila Malaysia belum dibuka: `PAYMENT_PROVIDER_MY=none`.

## 7. EasyParcel (Malaysia)

1. Daftar di **easyparcel.com** (Malaysia) → ajukan akses **API** (Individual/Business). Persetujuan bisa butuh 1–2 hari kerja.
2. Minta API key **demo** untuk pengujian.
3. Isi:
   ```
   SHIPPING_PROVIDER_MY=easyparcel
   EASYPARCEL_API_KEY=...
   EASYPARCEL_IS_PRODUCTION=false
   ```
4. Bila Malaysia belum dibuka: `SHIPPING_PROVIDER_MY=none`.

---

## Menjalankan uji integrasi

Setelah kunci diisi, jalankan uji ke server penyedia yang sebenarnya:

```bash
# di laptop (folder D:\APX\masrim)
pnpm --filter masrim-server smoke

# hanya sebagian
pnpm --filter masrim-server smoke -- midtrans whatsapp

# di VPS
docker compose -f docker-compose.prod.yml exec api node dist/scripts/smoke-integrations.js
```

Tambahkan di `.env` agar pesan uji terkirim ke Anda: `SMOKE_PHONE=0812xxxxxxx` dan `SMOKE_EMAIL=anda@domain.com`.

Contoh hasil:
```
LULUS   Midtrans — Virtual Account BCA       VA BCA 12345678901 — bayar di simulator ...
LULUS   Biteship — cek tarif                 JNE REG Rp27.000; SiCepat REG Rp25.000 ...
LULUS   Fonnte — kirim WhatsApp uji          terkirim ke 0812... — pastikan pesan diterima di HP
LEWATI  Billplz (Malaysia) — tagihan FPX     PAYMENT_PROVIDER_MY bukan billplz
```

### Uji webhook dari laptop (sebelum VPS siap)

Penyedia harus bisa memanggil server Anda. Dari laptop, buka terowongan sementara, mis. Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://localhost:3000
```
Pakai URL `https://xxxx.trycloudflare.com` sebagai domain di Notification URL Midtrans / webhook Biteship,
dan isi `PUBLIC_WEB_URL` dengan URL tersebut selama pengujian.

## Checklist uji end-to-end (manual, ±1 jam)

- [ ] Masuk Akun Saya dengan kode WhatsApp asli
- [ ] Checkout tunai → bayar VA di simulator → status *Dibayar* otomatis + WhatsApp konfirmasi diterima
- [ ] Checkout tunai QRIS → bayar di simulator → status *Dibayar*
- [ ] Checkout dengan kurir mitra → tarif Biteship muncul → Admin Cabang memesan kurir → nomor resi tercatat
- [ ] Status resi berubah lewat webhook Biteship (di sandbox gunakan fitur ubah status order di dashboard)
- [ ] Pengajuan cicilan → disetujui → bayar angsuran lewat VA → jadwal angsuran berkurang, jurnal terbentuk
- [ ] Unggah foto KTP & bukti → file tersimpan di MinIO (cek konsol MinIO) dan dapat dibuka kembali
- [ ] (Malaysia) bayar FPX di sandbox Billplz → status *Dibayar*
- [ ] Super Admin → Notifikasi Nasabah: tidak ada pesan gagal
