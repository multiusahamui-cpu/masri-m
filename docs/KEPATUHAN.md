# Kepatuhan: Hukum, Syariah & Pelindungan Data

Aplikasi sudah menyediakan perangkatnya (halaman S&K dan Kebijakan Privasi tiga bahasa, pencatatan
persetujuan, unduh data, permintaan penghapusan). Namun **keputusan hukum dan syariah harus diambil oleh
manusia yang berwenang**. Dokumen ini adalah daftar yang perlu dibawa ke konsultan hukum dan Dewan
Pengawas Syariah (DPS) sebelum go-live. Saya bukan konsultan hukum; isi halaman S&K dan Privasi di
aplikasi adalah **draf** yang disusun dari cara kerja sistem.

## 1. Yang wajib diisi di aplikasi (Super Admin → Parameter Bisnis → tiap negara)

| Parameter | Contoh | Dipakai di |
|---|---|---|
| Nama Badan Usaha (Legal) | PT Masri Mitra Syariah / Masri-M Sdn. Bhd. | S&K, Kebijakan Privasi |
| Alamat Kantor Terdaftar | Jl. ..., Jakarta | S&K, Kebijakan Privasi |
| Email Perlindungan Data | privacy@masri-m.com | Kebijakan Privasi (permintaan hak data) |
| Nomor WhatsApp CS | +62812... | S&K, website |
| Nama Perusahaan (Kwitansi) | Masri-M Syariah | Kwitansi, akad |

Selama belum diisi, halaman menampilkan "nama badan usaha akan dilengkapi".

## 2. Tinjauan konsultan hukum

**Indonesia**
- [ ] Bentuk izin usaha: penjualan barang secara cicilan oleh penjual sendiri vs. kegiatan **pembiayaan**
      yang memerlukan izin OJK (perusahaan pembiayaan syariah). Pastikan model Masri-M (membeli barang
      lalu menjual Murabahah dengan dana sendiri) tidak memerlukan izin OJK, atau siapkan perizinannya.
- [ ] Isi Syarat & Ketentuan (lib/legal.ts) dan klausul akad (server/src/lib/contract.ts).
- [ ] UU PDP No. 27/2022: penunjukan Pejabat/Petugas Pelindungan Data Pribadi (wajib untuk pemrosesan
      data skala besar/data keuangan), pencatatan aktivitas pemrosesan, dan penilaian dampak (DPIA) untuk
      data keuangan & foto KTP.
- [ ] Perjanjian pemrosesan data dengan penyedia: Midtrans, Biteship, Fonnte, penyedia email, VPS, Anthropic.
- [ ] Transfer data ke luar negeri (asisten AI Anthropic; VPS bila tidak di Indonesia).
- [ ] Masa simpan dokumen (UU Dokumen Perusahaan / perpajakan — umumnya 10 tahun).
- [ ] Penyelesaian sengketa: BASYARNAS / Pengadilan Agama.
- [ ] Kewajiban PSE (Penyelenggara Sistem Elektronik) Lingkup Privat — pendaftaran di Komdigi.

**Malaysia** (sebelum dibuka)
- [ ] Badan usaha lokal (Sdn. Bhd.) dan kewajiban lesen/pendaftaran pemberi kredit konsumen menurut aturan yang berlaku.
- [ ] PDPA 2010 (dengan pindaan 2024): Pegawai Perlindungan Data, notifikasi pelanggaran data.
- [ ] Penasihat Syariah; perlakuan *ta'widh* dan *gharamah* untuk keterlambatan mengikuti panduan BNM bila berlaku.
- [ ] e-Invois LHDN.

**Brunei** (sebelum dibuka)
- [ ] Badan usaha lokal, perizinan, dan aturan perlindungan data pribadi yang berlaku.
- [ ] Persetujuan syariah (Majlis Ugama Islam / penasihat syariah) atas akad.

## 3. Tinjauan Dewan Pengawas Syariah

Bawa dokumen berikut ke DPS:
- [ ] Alur akad: barang dibeli & dimiliki Masri-M **sebelum** akad Murabahah ditandatangani (sistem
      mewajibkan stok ada/dipesan; serah terima tercatat).
- [ ] Penetapan margin per tenor dan uang muka (urbun) — Parameter Bisnis.
- [ ] *Ta'zir* keterlambatan: nominal tetap setelah masa tenggang, **tidak** diakui sebagai pendapatan,
      dicatat sebagai kewajiban Dana Kebajikan (akun 2301) dan disalurkan untuk sosial.
- [ ] Penyaluran Dana Kebajikan: siapa yang menyetujui, batas nominal yang perlu persetujuan DPS.
- [ ] *Ibra'* pelunasan dipercepat (default 50% sisa margin) — dijanjikan di akad atau diberikan sebagai kebijakan.
- [ ] Pengakuan pendapatan margin secara proporsional terhadap kas angsuran (PSAK 102).
- [ ] Retur/pembatalan setelah serah terima.
- [ ] Opini/sertifikat kesesuaian syariah untuk ditampilkan di website.

## 4. Prosedur permintaan hak data pribadi (Helpdesk)

Permintaan dari **Akun Saya → Profil → Ajukan penghapusan data** masuk sebagai tiket Helpdesk kategori
*Akun & Aplikasi*, prioritas tinggi. Permintaan via email/WhatsApp dicatat manual sebagai tiket.

1. **Verifikasi identitas**: tiket dari Akun Saya sudah terverifikasi lewat kode WhatsApp. Permintaan via
   email/telepon → verifikasi nomor HP + nomor akad/pesanan.
2. **Akui** permintaan kepada nasabah paling lambat **3×24 jam**.
3. **Periksa kewajiban**:
   - Pembiayaan masih berjalan / ada tunggakan → data tetap disimpan sampai lunas; jelaskan kepada nasabah.
   - Dokumen transaksi & akuntansi → disimpan sesuai masa simpan wajib; data lain (foto KTP pengajuan
     yang ditolak, alamat, email) dapat dihapus/dianonimkan.
4. **Laksanakan** (saat ini manual oleh System Admin/DBA, dicatat di tiket): anonimkan nama/kontak pada
   tabel `customers`, hapus file KTP di penyimpanan, catat tindakan di tiket.
5. **Tutup tiket** dengan ringkasan tindakan dan kirim konfirmasi ke nasabah.

Salinan data (hak akses) dapat diunduh nasabah sendiri dari Akun Saya; foto dokumen dikirim melalui Helpdesk bila diminta.

## 5. Prosedur kegagalan pelindungan data (kebocoran)

1. Isolasi: ganti `JWT_SECRET` (semua sesi keluar), reset password staf terkait, blokir akses yang bocor.
2. Telusuri Audit Log dan log API (`docker compose logs api`) untuk ruang lingkup kejadian.
3. Indonesia: pemberitahuan tertulis kepada subjek data dan lembaga pelindungan data **paling lambat 3×24 jam**
   (UU PDP Pasal 46). Malaysia/Brunei: ikuti tenggat masing-masing.
4. Dokumentasikan kronologi, data yang terdampak, dan langkah perbaikan.

## 6. Bukti persetujuan

Tabel `consents` mencatat setiap persetujuan (dokumen, versi, waktu, IP, perangkat):
- masuk Akun Saya → `terms`, `privacy`
- pesanan tunai → `terms`, `privacy`
- pengajuan cicilan → `terms`, `privacy`, `credit_check`

Bila isi S&K/Privasi berubah, naikkan `LEGAL_VERSION` di `lib/legal.ts` **dan** `server/src/config/legal.ts`.
