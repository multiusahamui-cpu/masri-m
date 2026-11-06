# Panduan Deploy Produksi Masri-M (VPS)

Arsitektur satu server — semua berjalan dengan Docker Compose:

```
Internet ──443──▶ Caddy (HTTPS otomatis) ──▶ web  (nginx, file website & dashboard)
                                         └──▶ api  (Node/Express) ──▶ postgres, redis, minio
                  backup (02:00 WIB tiap hari) ──▶ ./backups  (+ salinan off-site opsional)
                  uptime-kuma (opsional) ──▶ status.domain
```

## 0. Yang perlu disiapkan

| Item | Rekomendasi |
|---|---|
| VPS | Lokasi **Jakarta** (data nasabah Indonesia tetap di dalam negeri), Ubuntu 24.04 LTS, 4 vCPU / 8 GB RAM / 80 GB SSD. Minimum 2 vCPU / 4 GB. |
| Domain | mis. `masri-m.com` (beli sendiri) |
| DNS | A record `masri-m.com` dan `www` → IP VPS. Opsional: `status.masri-m.com` → IP VPS |
| Akun penyedia | lihat [SANDBOX.md](SANDBOX.md) |
| Penyimpanan off-site | Cloudflare R2 / Backblaze B2 / Google Drive (untuk salinan cadangan di luar VPS) |

## 1. Siapkan server (sekali saja)

Masuk sebagai root lalu jalankan:

```bash
# Pengguna deploy + kunci SSH
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh

# Matikan login root & password SSH
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: hanya SSH, HTTP, HTTPS
apt update && apt -y upgrade && apt -y install ufw fail2ban unattended-upgrades git
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Asia/Jakarta

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

> Pastikan Anda bisa login sebagai `deploy` dengan kunci SSH **sebelum** menutup sesi root.

## 2. Ambil kode & isi konfigurasi

```bash
sudo mkdir -p /opt/masrim && sudo chown deploy:deploy /opt/masrim
git clone https://github.com/<akun-anda>/masrim.git /opt/masrim
cd /opt/masrim

cp deploy/.env.prod.example .env                         # domain, password DB & MinIO
cp deploy/env.production.example server/.env.production  # secret aplikasi & penyedia
chmod 600 .env server/.env.production
```

Buat password/secret acak:
```bash
openssl rand -base64 32 | tr -d '/+='   # POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, MINIO_APP_PASSWORD, REDIS_PASSWORD
openssl rand -base64 48                 # JWT_SECRET
openssl rand -hex 16                    # BITESHIP_WEBHOOK_TOKEN
openssl rand -hex 24                    # MONITOR_TOKEN
```

Isi **`.env`**: `DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `REDIS_PASSWORD`
(dan `STATUS_DOMAIN` bila memakai halaman status).

Disarankan juga (lihat [Pengamanan](#10-pengamanan-hardening)):
- `MINIO_APP_USER` + `MINIO_APP_PASSWORD` — akun MinIO khusus API yang **hanya** bisa mengakses bucket aplikasi
  (dibuat otomatis oleh service `minio-init`). Bila kosong, API memakai akun root MinIO.
- `BACKUP_AGE_RECIPIENT` — public key [age](https://age-encryption.org) untuk mengenkripsi salinan cadangan off-site.

Isi **`server/.env.production`**: `JWT_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, kunci Midtrans,
Biteship, Fonnte, SMTP, `ALERT_WHATSAPP` (nomor tim teknis), `MONITOR_TOKEN`.

> API **menolak berjalan** bila konfigurasi berbahaya (gateway mock, secret contoh, tanpa HTTPS, WhatsApp
> belum diatur). Daftar masalahnya terlihat di `docker compose -f docker-compose.prod.yml logs api`.
> Kunci **sandbox** diperbolehkan (hanya muncul peringatan) sehingga Anda bisa uji coba di domain asli dulu.

## 3. Jalankan pertama kali

```bash
cd /opt/masrim
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # semua "running"/"healthy"
docker compose -f docker-compose.prod.yml logs -f api   # tunggu "Masri-M API berjalan"
```

Saat start, API menjalankan migrasi database dan membuat akun Super Admin. Caddy mengambil sertifikat
HTTPS otomatis (butuh DNS sudah mengarah ke VPS dan port 80/443 terbuka).

Buka `https://<domain>` → **Login Portal → Super Admin** → masuk dengan `SUPERADMIN_EMAIL` /
`SUPERADMIN_PASSWORD` → ganti password. Lalu:

1. **Kantor & Cabang**: lengkapi Kantor Pusat dan cabang (alamat, **kode pos**, telepon).
2. **Parameter Bisnis**: periksa margin, uang muka, ta'zir, ibra'; isi **Nama Badan Usaha (Legal)**,
   **Alamat Kantor Terdaftar**, **Email Perlindungan Data**, **Nomor WhatsApp CS**.
3. **Manajemen User**: buat akun staf (password sementara wajib diganti saat login pertama).
4. **System Admin**: input kategori & produk; **Gudang**: catat penerimaan barang.

> Jangan jalankan `db:seed-demo` / `db:seed-asia` di produksi (keduanya otomatis menolak).
> Bila database produksi berasal dari salinan staging yang berisi akun demo:
> `docker compose -f docker-compose.prod.yml exec api node dist/db/disable-demo.js --yes`

## 4. Uji integrasi di server

```bash
docker compose -f docker-compose.prod.yml exec api node dist/scripts/smoke-integrations.js
```
Lalu jalankan checklist end-to-end di [SANDBOX.md](SANDBOX.md#checklist-uji-end-to-end-manual-1-jam).

## 5. Monitoring & alert

**Bawaan aplikasi** (aktif otomatis, dikirim ke `ALERT_WHATSAPP` / `ALERT_EMAIL`):
- Cadangan database tidak berhasil > 26 jam
- Lonjakan error server (≥ 20 error 5xx dalam 10 menit)
- Tugas berkala gagal berturut-turut (jurnal akuntansi, pengingat, kurir)
- Notifikasi nasabah gagal/tertahan
- API crash (container restart otomatis)

**Uptime Kuma** (memantau dari luar aplikasi):
```bash
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```
Buka `https://status.<domain>`, buat akun admin, lalu tambahkan monitor:
1. HTTP(s) — `https://<domain>/api/health` (interval 60 detik)
2. HTTP(s) – Keyword — `https://<domain>/api/health/details`, header `x-monitor-token: <MONITOR_TOKEN>`, keyword `"ok":true`
3. Notifikasi: Telegram / email / WhatsApp (menu Settings → Notifications)

Karena Uptime Kuma berada di server yang sama, tambahkan juga pemantau eksternal gratis
(mis. UptimeRobot / Better Stack) ke `https://<domain>/api/health` agar Anda tetap diberi tahu bila VPS mati total.

**Log**: format JSON per baris.
```bash
docker compose -f docker-compose.prod.yml logs --since 1h api | grep '"level":"error"'
docker compose -f docker-compose.prod.yml logs --since 1h caddy
```

## 6. Cadangan (backup)

- Otomatis tiap hari **02:00 WIB**: database (`pg_dump`, diverifikasi + checksum) dan seluruh file MinIO ke `/opt/masrim/backups`.
- Disimpan **14 hari** + cadangan bulanan **12 bulan**.
- **Uji restore otomatis tiap Minggu** ke database sementara (hasil di log container backup).

Cadangan manual / cek:
```bash
docker compose -f docker-compose.prod.yml run --rm backup backup.sh now
docker compose -f docker-compose.prod.yml run --rm backup backup.sh verify
ls -lh backups/db
```

**Salinan off-site (sangat disarankan)** — cadangan di VPS yang sama ikut hilang bila VPS rusak:
1. Buat bucket di Cloudflare R2 (atau B2/S3), buat API token.
2. Buat `deploy/rclone/rclone.conf` (contoh di `deploy/rclone/README.md`).
3. Isi `RCLONE_REMOTE=r2:masrim-backup` di `.env`, lalu `docker compose -f docker-compose.prod.yml up -d backup`.
4. **Enkripsi**: buat kunci `age-keygen -o masrim-backup.key` di **komputer Anda** (bukan di VPS), simpan file
   kuncinya di tempat aman (brankas password / flashdisk terkunci), lalu isi `BACKUP_AGE_RECIPIENT=age1...`
   (baris "public key") di `.env`. Dump database yang dikirim off-site menjadi `*.dump.age`. Alternatif: remote
   rclone bertipe `crypt` — skrip memberi peringatan bila remote tidak terenkripsi sama sekali.
   Memulihkan dump terenkripsi: `age -d -i masrim-backup.key masrim-....dump.age > masrim.dump`.

### Memulihkan
```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml run --rm backup restore.sh db /backups/db/masrim-YYYYMMDD-HHMM.dump
docker compose -f docker-compose.prod.yml run --rm backup restore.sh files
docker compose -f docker-compose.prod.yml start api
```

## 7. Update aplikasi

Manual di VPS:
```bash
cd /opt/masrim && ./deploy/deploy.sh          # versi terbaru branch main
./deploy/deploy.sh v1.1.0                      # atau tag tertentu
```
Skrip ini: cadangan dulu → ambil kode → build → jalankan → cek kesehatan → **rollback otomatis** bila API tidak sehat.

Otomatis dari GitHub (opsional) — di repo GitHub, **Settings → Secrets and variables → Actions**, tambahkan:

| Secret | Isi |
|---|---|
| `DEPLOY_HOST` | IP VPS |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | private key khusus deploy (public key-nya di `~deploy/.ssh/authorized_keys`) |
| `DEPLOY_PATH` | `/opt/masrim` (opsional) |
| `DEPLOY_HOST_FINGERPRINT` | sidik jari host key SSH VPS — dapatkan di VPS: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 \| cut -d' ' -f2` (mencegah deploy ke server palsu) |

Setelah itu, membuat tag `v1.0.0` (`git tag v1.0.0 && git push --tags`) atau menjalankan workflow CI
secara manual dengan centang *deploy* akan menjalankan test lalu deploy ke VPS.

## 8. Go-live checklist

- [ ] Semua penyedia memakai kunci **production** (`MIDTRANS_IS_PRODUCTION=true`, Biteship live, Fonnte aktif)
- [ ] Notification URL Midtrans production & webhook Biteship live mengarah ke domain
- [ ] `smoke-integrations` lulus; checklist end-to-end lulus
- [ ] Parameter legal (nama badan usaha, alamat, email privasi) terisi untuk setiap negara aktif
- [ ] Tinjauan hukum & DPS selesai ([KEPATUHAN.md](KEPATUHAN.md))
- [ ] Cadangan off-site aktif; uji restore berhasil
- [ ] Uptime Kuma + pemantau eksternal aktif; alert WhatsApp diterima (uji: hentikan container api sebentar)
- [ ] Tidak ada akun demo aktif; password Super Admin sudah diganti
- [ ] `ALLOW_INSECURE_PRODUCTION` tidak di-set
- [ ] `REDIS_PASSWORD`, `MINIO_APP_USER/PASSWORD` terisi; `BACKUP_AGE_RECIPIENT` terisi & kunci privat age disimpan di luar VPS
- [ ] Secret GitHub `DEPLOY_HOST_FINGERPRINT` terisi (bila memakai deploy otomatis)

## 9. Catatan

- **Cloudflare (opsional)**: bila domain diproksikan Cloudflare (awan oranye), set SSL/TLS mode **Full (strict)**
  dan ubah `TRUST_PROXY: "2"` di `docker-compose.prod.yml` agar IP nasabah terbaca benar untuk pembatasan laju.
- **MinIO**: edisi komunitas tidak lagi merilis image baru sejak akhir 2025; versi dikunci di compose.
  Bila kelak ingin pindah ke Cloudflare R2/AWS S3, cukup ubah variabel `S3_*` di service api dan salin isi bucket dengan rclone.
- **Konsol MinIO** hanya dapat dibuka lewat SSH tunnel: `ssh -L 9001:127.0.0.1:9001 deploy@<ip>` lalu buka `http://localhost:9001`.
- **Masalah umum**:
  - Sertifikat gagal → cek DNS (`dig +short <domain>`) dan port 80/443 terbuka.
  - API restart terus → `docker compose -f docker-compose.prod.yml logs api` (biasanya daftar masalah konfigurasi production).
  - Pembayaran tidak berubah status → cek Notification URL Midtrans dan log `grep webhooks`.

## 10. Pengamanan (hardening)

Sudah diterapkan di kode & konfigurasi (tidak perlu langkah tambahan selain mengisi variabel di atas):

- **Container**: semua service `no-new-privileges` + batas memori; API berjalan read-only, tanpa capability Linux,
  `/tmp` di memori, batas jumlah proses. Redis wajib password. MinIO: bucket privat, API memakai akun bucket-only.
- **Log**: token webhook Biteship di URL disamarkan di log Caddy & API.
- **CI**: token GitHub hanya-baca, `pnpm audit` wajib lulus, verifikasi host key SSH saat deploy.
- **Login staf**: kunci sementara 15 menit setelah salah password berulang; pembatasan per email & per IP;
  sesi lama otomatis tidak berlaku setelah ganti/reset password, ganti role/cabang, atau "Keluar dari semua perangkat".
- **Data**: constraint database mencegah stok minus, nominal negatif, angsuran ganda, shift kasir ganda.

Setelah update ke versi ini, migrasi `0014_hardening` berjalan otomatis saat API start. Migrasi akan **gagal**
bila data lama melanggar constraint baru (mis. stok minus) — perbaiki datanya dulu (lihat log API), lalu start ulang.
Ringkasan lengkap: [HARDENING.md](HARDENING.md).

