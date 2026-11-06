# Masri-M Syariah — E-commerce Elektronik & Furniture dengan Kredit Murabahah

Monorepo pnpm:

| Folder | Isi |
|---|---|
| `/` (root) | Frontend React 19 + Vite (port **3000**) |
| `server/` | Backend API Express 5 + Drizzle ORM + PostgreSQL (port **4000**) |
| `docker-compose.yml` | PostgreSQL 17 (port **5433**) & Redis 7 (port **6380**) untuk pengembangan lokal |

> Port Docker sengaja **5433/6380** agar tidak bentrok dengan PostgreSQL yang terinstal langsung di Windows (5432).

## Menjalankan di lokal (Windows 11 + Docker Desktop)

Prasyarat: Node.js 22+, pnpm 10+, Docker Desktop (sudah running).

```powershell
# 1. Install dependency (frontend + server sekaligus)
pnpm install

# 2. Nyalakan PostgreSQL & Redis
pnpm db:up

# 3. Siapkan file environment backend, lalu edit JWT_SECRET & password Super Admin
copy server\.env.example server\.env

# 4. Buat tabel + data awal (role, negara, parameter bisnis, akun Super Admin)
pnpm db:setup

# 5. Jalankan frontend + backend bersamaan
pnpm dev:all
```

Data contoh (opsional, khusus lokal): `pnpm db:seed-demo` membuat 3 cabang, staf per cabang, nasabah, tiket helpdesk,
12 produk, penerimaan barang dan contoh transfer stok. Aman dijalankan ulang (bagian yang sudah ada dilewati).
Semua akun demo memakai password `DemoMasri2026`: `helpdesk@`, `bm@` & `bm2@` (Business Manager, 2 akun untuk komite), `wh@` (Warehouse Pusat), `sysadmin@` (System Admin),
`ao.jkt@`/`ao.bdg@`/`ao.pyk@` (Account Officer), `ksr.jkt@`/`ksr.bdg@`/`ksr.pyk@` (Kasir),
`drv.jkt@`/`drv.bdg@`/`drv.pyk@`/`drv.ho@` (Driver),
`mc.jkt@`/`mc.bdg@`/`mc.pyk@` (Manager Cabang), `admin.jkt@`/`admin.bdg@`/`admin.pyk@` (Admin Cabang) — domain `@masri-m.local`.

Buka http://localhost:3000 → **Login Portal** → kartu **Super Admin**.
Login dengan `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` dari `server\.env`
(default `superadmin@masri-m.local` / `GantiSegera#2026`). Sistem langsung meminta ganti password.

### Perintah lain

- `pnpm test` — tes otomatis API (butuh PostgreSQL dari docker-compose)


| Perintah | Fungsi |
|---|---|
| `pnpm dev` / `pnpm dev:server` | Jalankan frontend saja / backend saja |
| `pnpm db:generate` | Buat file migrasi baru setelah mengubah `server/src/db/schema.ts` |
| `pnpm db:migrate` | Terapkan migrasi |
| `pnpm db:seed` | Isi ulang data awal (idempoten, nilai parameter yang sudah diubah tidak ditimpa) |
| `pnpm db:seed-demo` | Data contoh cabang, staf, nasabah & tiket (hanya untuk lokal) |
| `pnpm --filter masrim-server db:studio` | Drizzle Studio untuk melihat isi database |
| `pnpm db:down` | Matikan container (data tetap tersimpan di volume) |
| `pnpm typecheck` | Cek TypeScript frontend + backend |

Reset total database: `docker compose down -v` lalu `pnpm db:up` dan `pnpm db:setup`.

## Struktur organisasi (multi-cabang)

| Kantor | Role | Fungsi |
|---|---|---|
| **Kantor Pusat** (satu) | Super Admin | Parameter bisnis, kantor & cabang, user internal |
| | Business Manager | Penetapan/keputusan kredit; Problem Status seluruh cabang |
| | Helpdesk Pusat | Pusat bantuan **satu pintu**, eskalasi ke Admin Cabang |
| | Warehouse Pusat, System Admin, Bookkeeping, Marketing | Operasional pusat |
| **Cabang** (banyak) | Manager Cabang | Pimpinan cabang, membawahi AO; Problem Status cabangnya |
| | Admin Cabang | Stok buffer cabang, pengiriman, pengeluaran operasional, tindak lanjut eskalasi |
| | Account Officer | Survei & verifikasi nasabah, di bawah Manager Cabang |
| Pusat / Cabang | Delivery, Cashier | Dapat ditempatkan di keduanya |

Setiap user internal wajib ditempatkan di satu kantor, dan sistem menolak penempatan yang tidak cocok
(mis. Admin Cabang di Kantor Pusat).

## Alur Helpdesk satu pintu

1. Nasabah menghubungi **Helpdesk Pusat** (telepon, WA, email, web, datang langsung) → tiket dibuat dengan target SLA
   sesuai prioritas (`helpdesk.sla_hours` di Parameter Bisnis).
2. Bila perlu tindakan di cabang, Helpdesk **mengeskalasi ke Admin Cabang**. Tembusan otomatis ke
   **Manager Cabang** cabang tersebut dan **Business Manager** (notifikasi lonceng di header).
3. Admin Cabang menindaklanjuti, memberi komentar perkembangan, lalu menandai **Selesai Ditangani Cabang**.
4. Helpdesk Pusat mengonfirmasi ke nasabah → **Selesai** → **Ditutup** (bisa dibuka ulang atau dieskalasi ulang).

Menu **Problem Status** (Business Manager: semua cabang, Manager Cabang: cabangnya) berisi KPI pending/terlambat SLA,
ringkasan pending per cabang, pending per tahap/kategori/umur, dan drill-down sampai detail tiket: data nasabah,
uraian masalah, instruksi eskalasi, penyelesaian, riwayat penanganan, dan tembusan.

## Katalog produk & stok multi-lokasi

- **System Admin** mengelola master produk (SKU, merek, kategori Elektronik/Furniture, spesifikasi, dimensi & berat
  untuk ongkir, garansi, butuh pemasangan) dan **harga tunai per negara**. Produk baru berstatus *draft* dan baru tampil
  di katalog setelah diaktifkan (wajib ada harga Indonesia).
- **Harga cicilan tidak diinput manual**: dihitung dari *Margin Murabahah per Tenor* dan *Uang Muka Minimum*
  di Parameter Bisnis (`harga jual = (harga tunai − DP) × (1 + margin)`, angsuran tetap = harga jual / tenor).
- Lokasi stok = Kantor Pusat (Gudang Pusat) + setiap cabang (buffer). Per lokasi dicatat **Fisik**, **Dipesan**
  (reservasi order) dan **Tersedia** = Fisik − Dipesan, serta batas stok menipis.
- Semua perubahan stok lewat **kartu stok** (append-only): penerimaan supplier, transfer keluar/masuk, opname,
  reservasi & pengeluaran order.

### Alur stok

| Langkah | Siapa | Keterangan |
|---|---|---|
| Penerimaan barang | Warehouse Pusat | Barang dari supplier masuk Gudang Pusat (No. GR) |
| Permintaan stok | Admin Cabang | Ajukan item & jumlah ke Gudang Pusat |
| Persetujuan | Manager Cabang | Setujui / tolak (bisa dimatikan: `stock.transfer_requires_branch_manager_approval`) |
| Pengiriman | Warehouse Pusat | Isi jumlah kirim (≤ tersedia) & no. armada/resi; stok Pusat berkurang |
| Penerimaan cabang | Admin Cabang | Isi jumlah diterima; selisih wajib diberi catatan & dinotifikasi ke Pusat + Manager Cabang |
| Dorong stok | Warehouse Pusat | Kirim langsung ke cabang tanpa permintaan |
| Stock opname | Warehouse (Pusat) / Admin Cabang (cabangnya) | Hasil hitung fisik vs sistem, rusak, hilang |

Katalog publik (`/api/catalog/...`) dipakai halaman depan dan menu **Toko** nasabah, lengkap dengan simulasi cicilan.

## Pembiayaan Murabahah (end-to-end)

| Tahap | Siapa | Keterangan |
|---|---|---|
| Pengajuan | Nasabah (web publik) / AO / Manager Cabang | Pilih produk, tenor & DP (simulasi langsung), data diri sesuai KTP, pekerjaan & penghasilan, cabang terdekat |
| Penugasan AO | Manager Cabang | AO cabang di bawah Manager Cabang; AO yang menginput sendiri otomatis ditugaskan |
| Verifikasi KYC | AO | Checklist KTP, selfie, KK, bukti penghasilan, bukti domisili |
| Survei lapangan | AO | Alamat, status tempat tinggal, penghasilan terverifikasi, cicilan lain, skor karakter, foto |
| Rekomendasi | AO | Layak / tidak layak + usulan tenor & DP; sistem menghitung **DSR** (batas `credit.max_dsr_pct`) |
| Review cabang | Manager Cabang | Teruskan ke Pusat / kembalikan ke AO / tolak |
| **Penetapan kredit** | **Business Manager Pusat** | Setujui (boleh ubah tenor/DP) / tolak / kembalikan. Di atas `credit.bizmgr_approval_limit` wajib **2 suara BM (komite)** |
| Reservasi stok | otomatis | Saat disetujui: stok cabang, atau Gudang Pusat bila cabang kosong |
| Akad & uang muka | AO / Manager Cabang | No. akad, DP diterima (≥ DP yang disetujui), metode & referensi |
| Serah terima | Admin Cabang | Stok keluar dari reservasi; **jadwal angsuran tetap** dibuat mulai bulan berikutnya |

Nasabah dapat **cek status** di website dengan nomor pengajuan + nomor HP (nama disamarkan).
Angsuran terakhir disesuaikan agar total angsuran = harga jual Murabahah.

## Order tunai, pengiriman 3 mode & pembayaran

**Order tunai (website):** ikon keranjang di header → checkout tanpa akun (nama & HP), pilih cabang, kota & alamat,
pengiriman, dan pembayaran (Virtual Account, QRIS, atau bayar di kasir). Stok direservasi saat checkout dan dilepas
otomatis bila tidak dibayar dalam `order.payment_expiry_hours`. Lacak pesanan lewat ikon paket di header.

**Pengiriman** dibuat otomatis saat order lunas atau saat akad kredit (DP + ongkir dibayar saat akad):

| Mode | Diproses oleh | Alur |
|---|---|---|
| Armada Masri-M (dalam kota lokasi stok) | Admin Cabang / Warehouse Pusat → Driver | Jadwal + driver + kendaraan → driver berangkat → bukti terima (nama, catatan, foto) |
| Kurir mitra (JNE, J&T, TIKI, SiCepat, AnterAja, Pos, kargo untuk barang besar) | Admin Cabang / Warehouse Pusat | Booking → nomor resi → status terkirim dari kurir |
| Ambil sendiri | Petugas lokasi stok | Siapkan barang → **kode pengambilan 6 digit** tampil hanya di halaman lacak nasabah → petugas mencocokkan kode + KTP |

Pengiriman yang diterima **mengaktifkan cicilan Murabahah** (atau menyelesaikan order & mengeluarkan stok).
Ongkir dihitung server (tidak bisa dimanipulasi dari browser); gratis armada internal di atas `shipping.free_shipping_min_order`.

**Pembayaran:**
- Kasir: terima angsuran tunai/transfer (dialokasikan ke angsuran tertua; ta'zir dicatat terpisah sebagai dana sosial),
  terima pembayaran order "bayar di kasir", laporan kas harian per metode.
- Nasabah: bayar angsuran via VA/QRIS dari halaman **Cek Status Pengajuan**; posisi sisa kewajiban & tunggakan tampil di sana.
- Collection (AO & Manager Cabang) diurutkan dari tunggakan terlama; **Pembayaran & Macet** (BM) menampilkan
  outstanding per kolektibilitas (lancar, 1–30, 31–60, 61–90, >90 hari) per cabang.
- Tugas berkala di server (tiap 5 menit): order & tagihan kedaluwarsa, persetujuan kredit yang tidak diakadkan
  dalam `credit.approval_valid_days`.

**Integrasi pihak ketiga (belum aktif):** kurir memakai `MockCourierProvider` (`server/src/lib/couriers.ts`) dan
pembayaran memakai `MockGateway` (`server/src/lib/payments.ts`). Untuk produksi, buat provider Biteship/RajaOngkir/EasyParcel
dan Midtrans/Xendit/Bayarind yang mengimplementasikan interface yang sama; webhook pembayaran sudah tersedia di
`POST /api/webhooks/payment` (header `x-callback-token` = `PAYMENT_WEBHOOK_TOKEN`).

**Simulasi lokal:** dengan `ENABLE_DEV_SIMULATION=true` di `server/.env`, tombol "Simulasi pembayaran" di halaman
lacak menandai VA/QRIS lunas, dan `POST /api/dev/shipments/:shipmentNo/courier-delivered` mensimulasikan kurir mitra.
**Jangan aktifkan di server publik.**

## Keuangan cabang & purna jual

| Fitur | Alur | Role |
|---|---|---|
| **Biaya operasional cabang** | Admin Cabang mengajukan (kategori, vendor, nota) → Manager Cabang menyetujui; di atas `finance.expense_mc_limit` diteruskan ke Business Manager → Kasir / Admin Cabang membayarkan (tunai dari shift atau transfer). Laporan per cabang & kategori vs `finance.expense_monthly_budget`. | Admin Cabang, Manager Cabang, BM, Kasir |
| **Shift kasir & setoran bank** | Buka shift (saldo awal) → semua transaksi **tunai** (angsuran, ta'zir, order, biaya, refund) tercatat di shift → tutup shift: hitung fisik, selisih (wajib catatan di atas `finance.cash_variance_tolerance`), setoran bank → Manager Cabang memverifikasi. Transaksi tunai ditolak bila belum buka shift (`finance.require_cashier_shift`). | Kasir / Admin Cabang, Manager Cabang |
| **Ta'zir otomatis** | Tugas berkala mengenakan ta'zir (`credit.late_tazir_flat`) satu kali per angsuran yang terlambat melewati `credit.grace_period_days`. Dicatat terpisah sebagai dana sosial; dapat **dibebaskan** Manager Cabang/BM untuk nasabah yang tidak mampu (menu Collection → klik nominal ta'zir). | otomatis, Kasir, MC/BM |
| **Pelunasan dipercepat & ibra'** | Sisa kewajiban − potongan ibra' (`credit.early_settlement_ibra_pct` × margin angsuran yang **belum jatuh tempo**). Tunggakan tetap dibayar penuh. Lewat kasir (tab "Pelunasan dipercepat") atau oleh nasabah via VA/QRIS di halaman Cek Status Pengajuan. | Kasir, nasabah |
| **Refund (pembatalan)** | Order lunas yang belum dikirim, atau akad yang barangnya belum diterima → pengajuan refund (tunai / transfer ke rekening nasabah) → disetujui Manager Cabang (order) / Business Manager (akad) → order/akad & pengirimannya dibatalkan, reservasi stok dilepas → Kasir membayarkan. | Admin Cabang, Kasir, Helpdesk, AO, MC, BM |
| **Retur barang** | Barang yang sudah diterima: rusak, tidak sesuai, cacat (garansi) → disetujui Manager Cabang → Admin Cabang menerima barang (kondisi baik masuk stok lagi) → penyelesaian otomatis: **ganti barang** (pengiriman pengganti dari stok cabang/Gudang Pusat, tanpa ongkir), **refund** (order tunai), atau **perbaikan**. | Admin Cabang, MC |
| **Kwitansi & bukti kas keluar** | Kwitansi (dengan terbilang) untuk order, uang muka akad, angsuran, pelunasan; bukti kas keluar untuk biaya & refund. Dicetak / disimpan PDF dari browser. Nasabah bisa mencetak kwitansinya sendiri dari halaman lacak (verifikasi nomor HP). | semua |

Uang muka + ongkir saat akad kini juga tercatat sebagai pembayaran (`kind = down_payment`) sehingga muncul di laporan kas dan bisa dicetak kwitansinya.
Data demo: Kasir Jakarta Timur sudah punya shift terbuka; ada 3 contoh biaya operasional (dibayar, menunggu MC, menunggu BM).

## Integrasi produksi (#5)

Semua integrasi punya mode **mock** untuk pengembangan, dan aktif cukup dengan mengisi `server/.env` lalu restart:

| Kebutuhan | Variabel `.env` | Catatan |
|---|---|---|
| **Payment gateway Midtrans** (VA BCA/BNI/BRI/Permata, QRIS) | `PAYMENT_PROVIDER=midtrans`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_IS_PRODUCTION` | Daftarkan *Payment Notification URL* `https://domain/api/webhooks/midtrans`. Notifikasi diverifikasi tanda tangan SHA512 **dan** dicek ulang ke API status Midtrans; nominal harus sama persis. Sandbox: bayar lewat simulator Midtrans. |
| **Kurir Biteship** (JNE, J&T, TIKI, SiCepat, AnterAja, Pos, Ninja, Lalamove, Deliveree) | `SHIPPING_PROVIDER=biteship`, `BITESHIP_API_KEY`, `BITESHIP_WEBHOOK_TOKEN` | Butuh **kode pos** cabang/gudang (menu Kantor & Cabang) dan alamat tujuan (checkout & akad). Webhook `https://domain/api/webhooks/biteship/<token>`; status diambil ulang dari API Biteship. "delivered" otomatis menyelesaikan order / mengaktifkan cicilan. |
| **WhatsApp** (Fonnte) | `WHATSAPP_PROVIDER=fonnte`, `FONNTE_TOKEN` | Tanpa ini pesan hanya dicatat di log server. |
| **Email** | `SMTP_URL`, `MAIL_FROM` | Lokal: Mailpit di docker-compose — buka http://localhost:8025 untuk melihat email. |
| **Penyimpanan file** | `STORAGE_DRIVER=local` (default, folder `server/uploads`) atau `s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | MinIO opsional: `docker compose --profile s3 up -d` (API http://localhost:19000, console http://localhost:19001). |
| **Rate limit** | `REDIS_URL` | Tanpa Redis memakai memori proses. |
| **Tautan di pesan** | `PUBLIC_WEB_URL` | Tautan `?lacak=ORD-…` / `?pengajuan=APP-…` membuka halaman lacak. |

**Notifikasi nasabah otomatis** (WhatsApp + email bila diisi): pesanan dibuat + instruksi bayar, pembayaran diterima, jadwal antar,
resi kurir, **kode pengambilan** (ambil sendiri), barang diterima, status pembiayaan (diterima, disetujui, ditolak, aktif, lunas, batal),
pengingat angsuran H-3 / hari H / H+1, refund dibayarkan. Pesan disimpan di *outbox* lalu dikirim ulang otomatis bila provider gagal.
Pantau di **Super Admin → Notifikasi Nasabah** (termasuk kirim pesan uji). Atur aktif/nonaktif & hari pengingat di Parameter Bisnis.

**Lampiran:** AO/cabang mengunggah KTP, selfie, KK, bukti penghasilan/alamat, foto survei, akad bertanda tangan (tab *Dokumen & Foto*);
driver/admin mengunggah foto bukti terima; nota biaya operasional; foto barang retur. File dicek dari isinya (JPG/PNG/WEBP/PDF, maks. 8 MB),
foto besar diperkecil otomatis di browser, dan hanya bisa dibuka staf yang berwenang.

**Keamanan:** rate limit login & endpoint publik, cek Origin untuk request yang mengubah data, kode pengambilan acak kriptografis,
peringatan saat produksi masih memakai mock / rahasia contoh.

**Tes otomatis:** `pnpm test` (Vitest) membuat ulang database `masrim_test`, lalu menguji alur Murabahah, keuangan & purna jual, akun nasabah (OTP), invarian akuntansi (jurnal seimbang, neraca, PSAK 102), Malaysia/Brunei (Billplz, EasyParcel, isolasi negara, bahasa), serta integrasi
Midtrans/Biteship/Fonnte terhadap server tiruan. CI GitHub Actions ada di `.github/workflows/ci.yml`.

**Deploy:** `docker compose -f docker-compose.prod.yml up -d --build` (Postgres, Redis, API, web nginx, backup harian `pg_dump` 14 hari).
Siapkan `server/.env.production` dari `.env.example` dan pasang HTTPS di depan service `web`.

## Deploy produksi (#9)

Panduan lengkap: **[docs/DEPLOY.md](docs/DEPLOY.md)** (VPS, HTTPS, backup, monitoring, update), **[docs/SANDBOX.md](docs/SANDBOX.md)**
(daftar akun Midtrans/Biteship/Fonnte/Billplz/EasyParcel + uji nyata), **[docs/KEPATUHAN.md](docs/KEPATUHAN.md)** (hukum, DPS, UU PDP).

```bash
cp deploy/.env.prod.example .env && cp deploy/env.production.example server/.env.production   # lalu isi
docker compose -f docker-compose.prod.yml up -d --build                  # Caddy + web + api + postgres + redis + minio + backup
docker compose -f docker-compose.prod.yml exec api node dist/scripts/smoke-integrations.js   # uji penyedia
./deploy/deploy.sh                                                       # update dengan rollback otomatis
```

- API menolak start di production bila ada konfigurasi berbahaya (gateway mock, secret contoh, tanpa HTTPS, WhatsApp kosong).
- Alert ke `ALERT_WHATSAPP`/`ALERT_EMAIL`: cadangan > 26 jam, lonjakan 5xx, tugas berkala gagal, notifikasi macet, crash.
- `pnpm --filter masrim-server smoke` — uji integrasi ke sandbox penyedia sungguhan dari laptop.
- `pnpm --filter masrim-server db:disable-demo` — nonaktifkan akun demo sebelum go-live.

## Akun nasabah (#6)

Nasabah masuk lewat tombol **Masuk / Akun Saya** di header dengan nomor WhatsApp — tanpa password. Kode 6 digit dikirim lewat
WhatsApp (Fonnte), berlaku 5 menit, maks. 5 kali salah, jeda 1 menit, maks. 3 kode per 15 menit; kode hanya disimpan sebagai hash.
Satu akun = semua data dengan nomor yang sama (`+62812…` dan `0812…` dianggap sama). Sesi 30 hari (cookie httpOnly terpisah dari sesi staf).

**Akun Saya:** ringkasan tagihan (angsuran berikutnya, tunggakan, ta'zir), detail pembiayaan + jadwal & riwayat, bayar angsuran
atau pelunasan dipercepat (VA/QRIS), **unduh akad Murabahah** (NIK disamarkan), kwitansi, status pengiriman, pesanan tunai, dan profil.
"Ajukan cicilan baru" mengisi otomatis data KYC terakhir. Staf bisa mencetak akad lengkap dari detail pengajuan (**Cetak Akad**).
Tautan langsung: `/?akun`.

**Mode pengembangan:** bila `WHATSAPP_PROVIDER=log` dan `ENABLE_DEV_SIMULATION=true`, kode OTP ditampilkan di layar masuk
(juga tercatat di log server dan halaman Notifikasi Nasabah Super Admin). Di produksi kode hanya dikirim via WhatsApp.

## Akuntansi syariah (#7, role Bookkeeping)

Login **acc@masri-m.local** (role Bookkeeping). Semua transaksi operasional dijurnal otomatis — tidak ada input ganda:

| Transaksi | Jurnal |
|---|---|
| Penerimaan barang | Persediaan / Hutang Dagang (harga beli dari dokumen; bila kosong diperkirakan `finance.fallback_cost_pct` × harga tunai) |
| Transfer stok | Persediaan dalam Perjalanan saat dikirim → Persediaan kantor tujuan saat diterima (RAK otomatis) |
| Stock opname | Persediaan / Selisih Persediaan |
| Bayar order tunai | Kas·Bank·Gateway / Uang Muka Penjualan; **pendapatan & HPP diakui saat barang keluar** |
| Akad Murabahah (DP + ongkir) | Kas / Uang Muka Murabahah |
| Serah terima barang kredit | Piutang Murabahah (sisa harga jual) + Uang Muka / Persediaan (harga perolehan), Pendapatan Ongkir, **Margin Ditangguhkan**; margin atas DP langsung diakui |
| Angsuran | Kas / Piutang; margin diakui **proporsional terhadap kas diterima** (PSAK 102); angsuran terakhir menghabiskan sisa margin |
| Pelunasan dipercepat | Ibra' mengurangi Margin Ditangguhkan (bukan beban) |
| Ta'zir | **Dana Kebajikan** (kewajiban), bukan pendapatan; penyalurannya dicatat di menu Dana Kebajikan |
| Biaya cabang, refund, tutup shift | Beban per kategori · Retur Penjualan / Uang Muka · setoran bank & selisih kas |

Setiap jurnal seimbang **per kantor**; selisih antar kantor otomatis ke Rekening Antar Kantor (RAK) sehingga neraca per cabang tetap
seimbang dan RAK bernilai nol saat konsolidasi. Posting berjalan setiap menit dan setiap laporan dibuka; idempoten (satu dokumen = satu jurnal).

**Menu:** ringkasan, jurnal (+ jurnal manual & pembalik), buku besar, neraca saldo, laba rugi & neraca (konsolidasi + kolom per kantor),
dana kebajikan (sumber & penggunaan), rekonsiliasi piutang per akad, bagan akun, tutup periode. Semua laporan bisa diunduh CSV.
Business Manager & Manager Cabang melihat **Laporan Keuangan** (baca saja; Manager Cabang hanya cabangnya).
Data lama otomatis dijurnal saat server pertama kali jalan setelah `pnpm db:migrate`.

## Kelompok 2: operasional & marketing
| Fitur | Role | Menu |
|---|---|---|
| Uang muka akad (tunai/transfer di kasir, atau VA/QRIS online oleh nasabah) | Kasir | Terima Uang Muka |
| Hutang pemasok: faktur atas penerimaan barang (selisih maks. 20% dari nilai GR), bayar sebagian, umur hutang | Bookkeeping (BM baca) | Hutang Pemasok |
| Rekonsiliasi bank: impor CSV BCA / Mandiri / BSI / umum, cocok otomatis, jurnal biaya bank, settlement gateway, bagi hasil | Bookkeeping | Rekonsiliasi Bank |
| Karantina barang rusak → perbaiki / klaim pemasok / hapus buku | Gudang, Admin & Manager Cabang, BM; klaim: Bookkeeping | Karantina Barang, Klaim Pemasok |
| Iqalah (batal akad setelah serah terima) + potongan nilai barang | MC/Admin ajukan → BM putuskan → Admin terima barang | Iqalah (Batal Akad) |
| Pengiriman terpisah bila stok tersebar di beberapa lokasi | otomatis | — |
| Kode promo, banner beranda, produk unggulan, kampanye WhatsApp/email (hanya nasabah yang setuju), laporan efektivitas | Marketing (`mkt@masri-m.local`) | 5 menu Marketing |

Penerimaan barang wajib memilih pemasok dan mengisi harga pokok per unit. Panduan lengkap: `docs/Panduan-Pengguna-Masri-M.docx` (Bab 3, 6–10, 14, 15).

## Go global Asia (#8): Indonesia, Malaysia, Brunei

**Nasabah** memilih negara & bahasa lewat tombol 🌐 di header (Bahasa Indonesia, Bahasa Melayu, English). Katalog, harga,
cabang, metode bayar, format nomor HP (+62/+60/+673) dan kode pos (ID/MY 5 digit, BN mis. BE3519) mengikuti negara. Halaman nasabah
(beranda, katalog, checkout, lacak, pengajuan cicilan, Akun Saya, Asisten Virtual) sudah tiga bahasa; pesan WhatsApp/email & akad
Murabahah dikirim/dicetak sesuai bahasa nasabah (MY/BN default Melayu). Dasbor staf tetap Bahasa Indonesia.

| | Indonesia | Malaysia | Brunei |
|---|---|---|---|
| Mata uang & pajak | IDR · PPN | MYR · SST (harga sudah termasuk) | BND · tanpa pajak penjualan |
| Pembayaran online | Midtrans (VA, QRIS) | **Billplz** (FPX, kartu, e-wallet) — `PAYMENT_PROVIDER_MY=billplz` | belum ada → bayar di kasir / transfer bank (rekening di parameter `general.bank_transfer_info`) |
| Kurir mitra | Biteship | **EasyParcel** (Pos Laju, J&T, City-Link, Ninja Van, DHL) — `SHIPPING_PROVIDER_MY=easyparcel`, status resi dicek tiap 30 menit | armada internal & ambil sendiri |
| Stok | Gudang Pusat → cabang | penerimaan barang langsung dari pemasok lokal oleh Admin Cabang (tanpa transfer lintas negara) | sama seperti Malaysia |
| Akuntansi | laporan per negara (satu mata uang); jurnal manual tidak boleh lintas negara | | |

**Aktivasi negara baru:** Super Admin → Parameter Bisnis → salin parameter dari ID (nilai khas negara seperti pajak, kurir, nominal
dalam mata uang lokal otomatis memakai default negara itu) → tinjau → aktifkan negara → buat cabang (negara MY/BN) & isi harga produk.
Untuk data contoh: `pnpm db:seed-asia` (setelah `db:seed-demo`) membuat Cawangan Kuala Lumpur & Bandar Seri Begawan, harga MYR/BND,
stok, staf (`mc.kul`, `admin.kul`, `ksr.kul`, `ao.kul`, `mc.bsb`, … password `DemoMasri2026`) dan modal awal.

> Catatan: nilai default MY/BN (ta'zir, plafon, SST) adalah titik awal — wajib ditinjau penasihat Syariah, legal & pajak setempat sebelum go-live.

## Asisten Virtual (Claude, pengganti Gemini)

Chat "Tanya Asisten" di website kini memakai **Claude (Anthropic)** yang dipanggil **dari backend** (`POST /api/assistant/chat`).
API key hanya ada di `server/.env` — tidak lagi dibundel ke JavaScript browser seperti versi Gemini.

**Mengaktifkan:**
1. Buat API key di <https://console.anthropic.com> → isi `ANTHROPIC_API_KEY=` di `server/.env`.
2. (Opsional) `ASSISTANT_MODEL=` — default `claude-haiku-4-5` (biaya rendah); ganti ke model Sonnet untuk jawaban lebih kaya.
3. Restart `pnpm dev:all`. Tanpa API key website tetap berjalan; chat menampilkan tombol WhatsApp CS & menu lacak.

**Yang bisa dilakukan asisten** (tool-calling ke endpoint publik API sendiri — tidak bisa melihat lebih dari yang boleh dilihat pengunjung):

| Tool | Fungsi |
|---|---|
| `search_products` | Cari produk, harga tunai, stok, cicilan termurah → tampil sebagai kartu produk (Beli Tunai / Ajukan Cicilan) |
| `get_product_installments` | Simulasi Murabahah resmi semua tenor (sesuai parameter bisnis) |
| `get_policies` | Margin, uang muka minimum, plafon, ongkir, WhatsApp CS, daftar cabang |
| `check_credit_application` | Status pengajuan/akad, sisa angsuran, tunggakan, pengiriman — **wajib no. pengajuan + HP** |
| `track_order` | Status order tunai & pengiriman — **wajib no. order + HP** |
| `create_helpdesk_ticket` | Keluhan yang sudah dikonfirmasi nasabah masuk antrian Helpdesk Pusat (kanal "Asisten Virtual") |

Pengaman: kode pengambilan barang & nomor VA tidak dikirim ke model; batas pesan per IP per jam, batas 3 tiket/jam per IP,
anggaran token harian (`assistant.*` di **Parameter Bisnis**), dan menu **Super Admin → Asisten Virtual** untuk memantau
pemakaian token, jumlah tool call, tiket, dan kegagalan per hari.

Daftar pekerjaan berikutnya dan catatan keterbatasan ada di **[ROADMAP.md](ROADMAP.md)**.

## Role Super Admin

Role yang memakai autentikasi nyata: Super Admin, Business Manager, Helpdesk Pusat, Manager Cabang, Admin Cabang,
Warehouse Pusat, System Admin, Account Officer, Delivery, Kasir (role lain masih mode simulasi).

- **Manajemen User Internal** – buat akun staf (password sementara ditampilkan sekali), ubah role/negara,
  nonaktifkan, buka kunci, reset password. Tidak bisa menonaktifkan / mengubah role akun sendiri,
  dan sistem selalu menyisakan minimal satu Super Admin aktif.
- **Parameter Bisnis per negara** – margin Murabahah per tenor, uang muka minimum, plafon, batas wewenang
  Business Manager, masa tenggang & ta'zir, PPN, tarif & radius ekspedisi internal, kurir mitra aktif,
  ambil sendiri di gudang, mode pemeliharaan. Negara baru (MY, BN) disalin dari Indonesia lalu disesuaikan;
  nominal uang otomatis di-nol-kan bila mata uang berbeda.
- **Role & Akses** – matriks role → modul.
- **Audit Log** – semua login, perubahan user dan parameter tercatat (sebelum/sesudah).
- **Keamanan** – sesi JWT di cookie httpOnly (8 jam), akun terkunci setelah 5x gagal login,
  password minimal 10 karakter dengan huruf besar, huruf kecil dan angka.

Parameter yang ditandai publik dapat dibaca website lewat `GET /api/config/public?country=ID`
(sudah dipakai keranjang untuk PPN & tarif ongkir).

## Keamanan

Ringkasan hardening (isolasi cabang, anti pembayaran ganda, lockout login, sesi, constraint DB, container) ada di
[docs/HARDENING.md](docs/HARDENING.md). Setelah menarik versi ini jalankan `pnpm install` dan `pnpm db:migrate`.

## Endpoint API

| Method | Path | Akses |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout`, `/api/auth/change-password`, `/api/auth/logout-all` | publik / login |
| GET | `/api/auth/me` | login |
| GET | `/api/config/public?country=ID` | publik |
| GET/POST/PATCH | `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/users/:id/reset-password` | Super Admin |
| GET | `/api/admin/roles`, `/api/admin/countries`, `/api/admin/stats` | Super Admin |
| GET/PUT/POST | `/api/admin/config`, `/api/admin/config/:key`, `/api/admin/config/copy` | Super Admin |
| PATCH | `/api/admin/countries/:code` | Super Admin |
| GET | `/api/admin/audit-logs` | Super Admin |
| GET/POST/PATCH | `/api/admin/branches`, `/api/admin/branches/:id` | Super Admin |
| GET | `/api/branches` | staf login |
| GET/POST | `/api/customers` | Helpdesk (buat), BM/MC/Admin Cabang (cari, sesuai cakupan) |
| GET/POST | `/api/helpdesk/tickets`, `/api/helpdesk/tickets/:id` | Helpdesk, BM, Manager & Admin Cabang (sesuai cakupan) |
| POST | `/api/helpdesk/tickets/:id/{start,escalate,branch-done,resolve,close,reopen,comments}` | sesuai role |
| GET | `/api/helpdesk/summary` | Problem Status |
| GET/POST | `/api/notifications`, `/api/notifications/:id/read`, `/api/notifications/read-all` | staf login |
| GET | `/api/credit/applications/:id/delivery-quote?city=` | AO / Manager Cabang (akad) |
| POST / GET | `/api/public/cart/quote`, `/api/public/orders`, `/api/public/orders/track` | publik |
| GET / POST | `/api/public/credit-applications/position`, `/api/public/credit-applications/pay` | publik (no. pengajuan + HP) |
| GET / POST | `/api/shipments`, `/api/shipments/:id/{schedule,book,prepare-pickup,dispatch,deliver,fail,change-mode}`, `/api/drivers` | lokasi stok / driver |
| GET / POST | `/api/cashier/credits`, `/api/cashier/credits/:id/pay`, `/api/orders`, `/api/orders/:id/{pay,cancel}`, `/api/payments` | Kasir dkk. |
| GET | `/api/collection`, `/api/portfolio` | AO / Manager Cabang / BM |
| POST | `/api/webhooks/payment` | payment gateway |
| GET / POST | `/api/assistant/status`, `/api/assistant/chat` | publik (Asisten Virtual) |
| GET / POST | `/api/shifts/current`, `/api/shifts/open`, `/api/shifts/:id/{close,verify}`, `/api/shifts` | Kasir / Admin Cabang, MC |
| GET / POST | `/api/expenses`, `/api/expenses/meta`, `/api/expenses/report`, `/api/expenses/:id/{decide,pay,cancel}` | Admin Cabang, MC, BM, Kasir |
| POST / GET | `/api/tazir/:id/waive`, `/api/credits/:id/settlement` | MC/BM, Kasir |
| GET / POST | `/api/aftersales/lookup`, `/api/refunds`, `/api/refunds/:id/{decide,pay}`, `/api/returns`, `/api/returns/:id/{decide,receive,complete}` | purna jual |
| GET | `/api/receipts/:paymentNo`, `/api/vouchers/{expense,refund}/:id`, `/api/public/receipts/:paymentNo?phone=` | staf / nasabah |
| POST | `/api/webhooks/midtrans`, `/api/webhooks/biteship/:token` | gateway / kurir |
| GET | `/api/public/payment-options` | publik |
| GET / POST | `/api/files?ownerType=&ownerId=`, `/api/files/:id/content` | staf berwenang |
| GET / POST | `/api/admin/notifications/{outbox,retry,test}` | Super Admin |
| GET | `/api/admin/assistant/usage` | Super Admin |
| POST | `/api/customer/auth/{request-otp,verify,logout}` | publik (nasabah) |
| GET / PATCH / POST | `/api/customer/me`, `/api/customer/orders`, `/api/customer/credits`, `/api/customer/credits/:id`, `/api/customer/credits/:id/{pay,contract}`, `/api/customer/receipts/:paymentNo` | nasabah login |
| GET | `/api/credit/applications/:id/contract-doc` | staf (cetak akad) |
| GET | `/api/public/payment-options?country=`, `/api/catalog/branches?country=` | publik |
| POST | `/api/webhooks/billplz` | Billplz (callback bertanda tangan X-Signature) |
| GET | `/api/accounting/{summary,journals,journals/:id,ledger,trial-balance,income-statement,balance-sheet,charity,reconciliation,periods,accounts}` | Bookkeeping, BM, Super Admin, Manager Cabang (cabangnya) |
| POST / PATCH | `/api/accounting/{journals,journals/:id/reverse,charity,accounts,accounts/:code,periods/:p/close,periods/:p/reopen,sync}` | Bookkeeping |
