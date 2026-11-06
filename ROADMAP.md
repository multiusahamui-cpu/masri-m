# Roadmap Masri-M

Catatan pekerjaan yang sudah selesai, yang berikutnya, dan keterbatasan yang diketahui.
Perbarui file ini setiap selesai satu tahap.

## Sudah selesai

| Tahap | Isi |
|---|---|
| Fondasi | Backend Express + PostgreSQL (Docker), Super Admin (parameter bisnis per negara, user internal, audit log), multi-cabang (1 Kantor Pusat + cabang), Helpdesk satu pintu + eskalasi + Problem Status |
| #1 | Katalog elektronik & furniture, stok multi-lokasi (Gudang Pusat + buffer cabang), penerimaan, transfer, opname |
| #2 | Pembiayaan Murabahah end-to-end: pengajuan → AO → Manager Cabang → keputusan Pusat (komite) → akad → serah terima → jadwal angsuran |
| #3 | Order tunai (keranjang & checkout), pengiriman 3 mode (armada internal, kurir mitra, ambil sendiri), pembayaran (VA/QRIS simulasi, kasir), collection, kualitas portofolio |
| #3b | Biaya operasional cabang + persetujuan berjenjang, shift kasir & setoran bank, ta'zir otomatis + pembebasan, pelunasan dipercepat dengan ibra', refund (pembatalan order/akad), retur (ganti/refund/perbaikan), kwitansi & bukti kas keluar |
| #4 | Asisten Virtual Claude lewat backend (tool-calling: produk, simulasi cicilan, status pengajuan/order, tiket helpdesk), pemantauan token oleh Super Admin; Gemini dihapus |
| #5 | Midtrans (VA/QRIS + webhook bertanda tangan), Biteship (ongkir, resi, webhook), notifikasi WhatsApp/email (outbox + pengingat angsuran), lampiran file (lokal/S3), rate limit & cek Origin, tes otomatis + CI, paket deploy Docker + backup |
| #6 | Akun nasabah: login OTP WhatsApp, Akun Saya (tagihan, bayar angsuran/pelunasan, jadwal, akad Murabahah & kwitansi, pesanan, profil), pengajuan ulang dengan data KYC tersimpan, cetak akad oleh staf |
| #7 | Akuntansi syariah: jurnal otomatis PSAK 102 (margin ditangguhkan & diakui proporsional, ibra'), dana kebajikan + penyaluran, RAK antar kantor, jurnal manual & pembalik, buku besar, neraca saldo, laba rugi & neraca konsolidasi/per cabang, rekonsiliasi piutang, tutup periode |
| #9 | Siap produksi: Tailwind dibangun lokal + font lokal + dashboard dimuat terpisah; stack Docker produksi (Caddy HTTPS otomatis, MinIO, Redis, backup harian + uji restore mingguan + off-site rclone); pemeriksaan konfigurasi production (API menolak start bila berbahaya); log JSON, alert WhatsApp/email (backup, error 5xx, tugas gagal, crash), Uptime Kuma, `/api/health/details`; CI build image + deploy SSH dengan rollback; skrip uji sandbox nyata; S&K & Kebijakan Privasi 3 bahasa per negara, bukti persetujuan, unduh data & permintaan penghapusan (UU PDP/PDPA). Panduan: docs/DEPLOY.md, docs/SANDBOX.md, docs/KEPATUHAN.md |
| #8 | Go global Asia: UI nasabah 3 bahasa (ID/MS/EN) + pilih negara, Malaysia (MYR, SST, Billplz FPX, EasyParcel) & Brunei (BND, bayar di cabang), nomor HP & kode pos per negara, parameter default per negara, stok & akuntansi terisolasi per negara, notifikasi & akad 3 bahasa |
| Kelompok 2 | Uang muka akad di kasir + VA/QRIS online; hutang pemasok (master pemasok, faktur atas GR ±20%, bayar sebagian, umur hutang); rekonsiliasi bank (impor CSV BCA/Mandiri/BSI/umum, cocok otomatis, jurnal biaya bank/settlement gateway/bagi hasil); karantina barang rusak + klaim pemasok (transfer/nota kredit); iqalah dengan potongan nilai barang; pengiriman terpisah dari beberapa lokasi; Marketing (kode promo, banner, produk unggulan, kampanye WA/email ber-opt-in + berhenti berlangganan, laporan efektivitas) |
| Hardening | Audit keamanan & race condition: cegah pengambilalihan NIK, pembayaran/alokasi ganda (lock + optimistic locking di semua transisi status), IDOR lintas cabang, session version + audience token, lockout sementara, OTP atomik, constraint DB, container read-only, Redis/MinIO berpassword & bucket-only, backup terenkripsi age, CI least-privilege. Detail: docs/HARDENING.md |

## Berikutnya (urutan prioritas)

### #5 lanjutan (perlu akun / server nyata)
- [ ] Jalankan `pnpm --filter masrim-server smoke` dengan akun sandbox Midtrans, Biteship, Fonnte (skrip & panduan siap: docs/SANDBOX.md)
- [ ] Deploy pertama ke VPS & uji MinIO di server (driver S3 sudah lulus uji terhadap API S3)
- [ ] Refund otomatis lewat API gateway; e-wallet (GoPay/ShopeePay/OVO); cetak label resi Biteship
- [ ] Agregasi log terpusat (Loki/Grafana) bila server > 1
- [ ] Template WhatsApp resmi (Meta WhatsApp Business API) bila volume besar

### #6 lanjutan
- [ ] Ganti nomor HP dengan verifikasi (saat ini lewat cabang)
- [ ] Unggah dokumen KYC oleh nasabah sendiri; tanda tangan akad elektronik
- [ ] Ajukan retur/keluhan dari Akun Saya (tersambung ke Helpdesk)
- [ ] Eksekusi penghapusan/anonimisasi data otomatis (saat ini lewat tiket Helpdesk + DBA, lihat docs/KEPATUHAN.md)

### #7 lanjutan
- [ ] Rekonsiliasi rekening koran bank & pencairan payment gateway (impor mutasi bank)
- [ ] Hutang pemasok per faktur (pembayaran ke supplier dari aplikasi, bukan jurnal manual)
- [ ] Laporan PPN & e-Faktur; aset tetap & penyusutan; anggaran vs realisasi
- [ ] Persetujuan Dewan Pengawas Syariah untuk penyaluran dana kebajikan di atas batas tertentu

### #8 lanjutan
- [ ] Dasbor staf multi-bahasa (cabang Malaysia/Brunei saat ini memakai Bahasa Indonesia)
- [ ] Nama kategori & deskripsi produk per bahasa; halaman Tentang/Syarat/Privasi per negara
- [ ] Gateway online Brunei (mis. BIBD / Baiduri) dan uji sandbox Billplz & EasyParcel dengan akun nyata
- [ ] Konsolidasi grup lintas mata uang (kurs IDR/MYR/BND) & e-Invoice LHDN Malaysia
- [ ] Tinjauan Syariah & legal setempat: ta'widh/gharamah (BNM), akta perlindungan pengguna, penasihat Syariah per negara

## Keterbatasan yang diketahui (untuk dikerjakan bertahap)
- Uang muka tunai saat akad dicatat oleh AO/Manager Cabang, belum lewat shift kasir.
- Harga perolehan memakai rata-rata tertimbang kumulatif dari penerimaan barang (bukan FIFO / moving average per lokasi).
- Order diambil dari satu lokasi stok; belum ada pemecahan pengiriman (split shipment) bila stok tersebar.
- Barang retur rusak tidak masuk stok; belum ada lokasi karantina & alur klaim ke pemasok.
- Retur barang kredit hanya ganti/perbaikan; pembatalan akad setelah barang diterima belum didukung.
- Belum ada restrukturisasi / penjadwalan ulang pembiayaan bermasalah dan hapus buku.
- Kutipan pelunasan dipercepat berlaku pada hari yang sama; VA pelunasan yang dibayar setelah posisi berubah dibukukan sebagai angsuran biasa.
- Laporan kas per metode menghitung nominal angsuran/order; ta'zir ditampilkan terpisah (kas shift sudah termasuk ta'zir).
- Halaman tidak otomatis menyegarkan status pembayaran (nasabah memuat ulang halaman lacak).
- Komponen prototipe lama masih ada dan bisa dihapus: `components/AdminSystemConfig.tsx`, `CashierExpenses.tsx`, `Courses.tsx`, `CourseDetail.tsx`, `Roadmap.tsx`, `BusinessModel.tsx`, `RegistrationSteps.tsx`, `RegistrationForm.tsx`, serta `package-lock.json` (proyek memakai pnpm).
- Hardening tersisa (detail di docs/HARDENING.md): residual refund sebagian, zona waktu per negara untuk penomoran/jurnal, pembulatan promo per mata uang, pin SHA GitHub Actions & digest image, batasi akses Uptime Kuma, kunci turunan untuk token unsubscribe, nginx read-only.
