# Laporan Hardening Masri-M — November 2026

Audit keamanan & ketahanan menyeluruh atas backend, frontend, dan konfigurasi deploy. Fokusnya
**otorisasi & isolasi cabang**, **race condition pada uang & stok**, **autentikasi**, **validasi input**, dan
**infrastruktur**. Semua perbaikan memiliki tes otomatis (`server/tests/hardening.test.ts` + tes modul yang ada).

Status: 54/54 tes lulus, typecheck & build lulus, `pnpm audit --prod` bersih. Selain itu, semua menu dari 11 role
diuji di browser di bawah Content-Security-Policy produksi tanpa error, termasuk cetak kwitansi.

## 1. Temuan & perbaikan

### Kritis
| Temuan | Perbaikan |
|---|---|
| **Pengambilalihan identitas nasabah**: pengajuan kredit publik dengan NIK milik nasabah lain bisa mengganti nomor HP nasabah tersebut, lalu penyerang login OTP ke akunnya. | Pengajuan publik ditolak (409) bila NIK/HP tidak cocok dengan data nasabah yang ada; hanya data non-identitas yang diperbarui. Perubahan identitas oleh staf mengembalikan status KYC ke "submitted". |

### Tinggi
| Temuan | Perbaikan |
|---|---|
| Pembayaran ganda: dua kasir/tab membayar order atau uang muka yang sama → 2 pembayaran "paid". | Pembayaran kasir dan konfirmasinya dalam **satu transaksi** dengan row lock. Status order/akad dikunci (`FOR UPDATE`). |
| Webhook terlambat (dana masuk setelah order kedaluwarsa/dibatalkan) hilang tanpa jejak. | Pembayaran ditandai **"PERLU DICEK"** + notifikasi Finance & Manager Cabang untuk refund manual. Hal yang sama berlaku untuk kelebihan bayar dan angsuran ke akad yang sudah tidak aktif. |
| Angsuran paralel bisa dialokasikan ganda. | Alokasi angsuran mengunci akad; unique index `(akad, urutan)`. |
| Transisi status tanpa penjagaan: approve/ship/receive transfer stok, refund, retur, klaim karantina, biaya, iqalah, pengiriman — dua klik bersamaan bisa memproses dua kali. | Semua transisi memakai **optimistic locking** (`UPDATE … WHERE status = <yang diharapkan>`), sehingga klik kedua mendapat 409. |
| Jurnal karantina dari iqalah mendebit persediaan dua kali. | Urutan pengecekan di `postStock` diperbaiki; tes memastikan jurnal tercatat sekali. |
| IDOR lintas cabang: detail akad kasir, settlement, preview iqalah, penerimaan barang, tim AO, driver bisa dibuka dengan ID cabang lain. | Pengecekan cakupan cabang (`loadAppInBranchScope`); data di luar cakupan → 404. Kwitansi dibatasi ke role yang relevan. |
| Sesi tetap berlaku setelah ganti password / reset / ganti role. | `session_version` di token; naik saat ganti/reset password, role, cabang, status. Ada endpoint baru **Keluar dari semua perangkat** (`POST /api/auth/logout-all`). |
| Token nasabah bisa dipakai sebagai token staf (secret sama). | Token staf ber-audience `staff` + algoritma dikunci HS256. |

### Sedang
- **Login**: kunci sementara 15 menit (bukan permanen) setelah salah berulang, limit 20 percobaan/jam per email, dan bcrypt
  tiruan untuk email tak dikenal (agar waktu respons tidak membocorkan email). Status akun hanya diungkap bila password benar.
- **OTP**: counter percobaan dinaikkan secara atomik sebelum dibandingkan, sehingga tebakan paralel tidak lolos. Ada limit per nomor HP (15/jam).
- **Promo**: kuota & batas per nasabah dicek ulang di dalam transaksi dengan row lock.
- **Kampanye**: bila pengiriman gagal di tengah jalan, status tidak menggantung.
- **Iqalah**: pembayaran/VA angsuran diblokir selama iqalah disetujui. Nilai refund dihitung ulang saat barang diterima.
- **VA angsuran** tidak boleh melebihi sisa tagihan dikurangi VA yang masih pending.
- **Refund**: pengaju tidak bisa menyetujui refund-nya sendiri (pemisahan tugas).
- **Gudang**: tidak bisa mengisi rekening bank pemasok (cegah fraud pembayaran) dan tidak bisa write-off karantina.
- **Kode ambil barang** tidak lagi tampil di halaman lacak publik, hanya di Akun Saya dan WhatsApp nasabah.
- **Retur order**: harga satuan diprorata dengan diskon & pajak order.
- **Simulasi kredit**: uang muka ≤ 90%, tenor dibatasi, angsuran terakhir harus positif.
- **Input URL** (foto, gambar banner, link promo) hanya menerima `http(s)`; `javascript:` ditolak.
- **Berhenti berlangganan** perlu klik konfirmasi (POST), agar pemindai link email tidak meng-unsubscribe otomatis.
- **File PDF** dikirim sebagai unduhan dengan CSP sandbox.
- **Ekspor CSV** aman dari formula injection (`=`, `+`, `-`, `@` diawali `'`).
- **Cetak** kwitansi/akad tanpa inline script, sehingga kompatibel dengan CSP ketat.
- **Error**: input tidak valid → 400, konflik database → 409, tidak lagi 500. Request-id dari klien divalidasi. Batas body JSON 200 KB (6 MB khusus impor mutasi bank).
- **Token monitor** dibandingkan dengan waktu konstan. Header Referer rusak tidak membuat server error.
- **Webhook generik** `/webhooks/payment` yang tidak dipakai dihapus.
- **Constraint database**: stok ≥ 0, nominal ≥ 0, satu shift terbuka per kasir, satu iqalah aktif per akad, satu faktur aktif per penerimaan barang.

### Infrastruktur
- Docker: `no-new-privileges`, batas memori. API read-only + `cap_drop: ALL` + tmpfs + batas proses. Redis memakai password.
- MinIO: service `minio-init` membuat bucket privat dan akun aplikasi bucket-only.
- Backup: permission file ketat (umask 077). Dump off-site dienkripsi `age`. Ada peringatan bila remote rclone tidak terenkripsi.
- Caddy: token webhook disamarkan di log akses.
- CI: `permissions: contents: read`, audit dependency wajib lulus, verifikasi fingerprint host SSH.
- Dependency diperbarui: zod 4.6.7, nodemailer 10.3, express 5.3. Hasil audit: 0 kerentanan.
- Tes: prefix nomor dokumen tidak lagi hardcode bulan (sebelumnya gagal setiap pergantian bulan).

## 2. Perubahan yang terlihat oleh pengguna
1. Lacak pesanan publik tidak menampilkan kode ambil barang; nasabah diarahkan ke WhatsApp / Akun Saya.
2. Akun staf terkunci **15 menit** setelah salah password berulang; setelah itu bisa dicoba lagi.
3. Setelah ganti password, reset oleh Super Admin, atau ganti role/cabang, sesi di perangkat lain otomatis keluar.
4. Role Gudang tidak melihat/mengisi rekening bank pemasok dan tidak punya opsi write-off karantina.
5. Pengaju refund tidak bisa menyetujui refund-nya sendiri.
6. Link berhenti berlangganan menampilkan tombol konfirmasi.
7. Pembayaran angsuran ditolak selama iqalah sudah disetujui.
8. VA angsuran baru ditolak bila nominalnya melebihi sisa tagihan dikurangi VA yang belum dibayar.
9. Uang muka maksimal 90%.
10. Klik ganda pada tombol proses kini menampilkan pesan "sudah diproses" (409), tidak memproses dua kali.

## 3. Langkah setelah update
```bash
pnpm install            # dependency baru
pnpm db:migrate         # migrasi 0014_hardening (kolom users + constraint)
pnpm db:seed-demo       # opsional: muat ulang data demo
```
Produksi: isi `REDIS_PASSWORD`, `MINIO_APP_USER/PASSWORD`, `BACKUP_AGE_RECIPIENT`, dan secret GitHub
`DEPLOY_HOST_FINGERPRINT` (lihat [DEPLOY.md](DEPLOY.md#10-pengamanan-hardening)).

## 4. Sisa pekerjaan (belum dikerjakan)
- Refund sebagian: sisa kewajiban/pendapatan belum dihitung ulang otomatis.
- Penomoran & jurnal memakai zona waktu WIB untuk semua negara (belum per negara).
- Satuan pembulatan diskon promo belum diseragamkan per mata uang.
- GitHub Actions & image Docker belum dikunci ke SHA/digest. Ini perlu dilakukan dari jaringan yang bisa mengakses GitHub API.
- Uptime Kuma terbuka publik (dilindungi login bawaannya); bisa dibatasi IP di Caddy.
- Token berhenti berlangganan masih ditandatangani langsung dengan `JWT_SECRET` (aman, tapi idealnya kunci turunan).
- Container web (nginx) belum read-only.
