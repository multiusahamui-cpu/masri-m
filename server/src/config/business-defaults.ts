import { z } from 'zod';

export type ConfigValueType = 'number' | 'percent' | 'money' | 'boolean' | 'string' | 'json';

export interface ConfigDefinition {
  key: string;
  category: 'credit' | 'tax' | 'shipping' | 'stock' | 'finance' | 'notify' | 'helpdesk' | 'assistant' | 'general';
  label: string;
  description: string;
  valueType: ConfigValueType;
  defaultValue: unknown;
  min?: number;
  max?: number;
  unit?: string;
  isPublic?: boolean;
  /** Validasi tambahan untuk tipe json */
  jsonSchema?: z.ZodType;
}

const tenorMarginSchema = z
  .record(z.string(), z.number('Margin harus angka').min(0, 'Margin minimal 0%').max(100, 'Margin maksimal 100%'))
  .refine((v) => Object.keys(v).every((k) => /^[1-9]\d{0,2}$/.test(k)), 'Tenor harus berupa angka bulan (1-999)')
  .refine((v) => Object.keys(v).length > 0, 'Minimal satu tenor');

/**
 * Parameter bisnis default (Indonesia). Negara lain disalin dari sini lewat
 * menu Super Admin lalu disesuaikan dengan regulasi setempat.
 */
export const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  // ----- Kredit Murabahah -----
  {
    key: 'credit.margin_by_tenor', category: 'credit', label: 'Margin Murabahah per Tenor',
    description: 'Margin jual-beli (flat, total akad) per tenor dalam bulan. Disepakati di awal akad dan tetap sampai lunas.',
    valueType: 'json', defaultValue: { '3': 5, '6': 8, '12': 15, '18': 20, '24': 25 }, unit: '%', isPublic: true,
    jsonSchema: tenorMarginSchema,
  },
  {
    key: 'credit.min_down_payment_pct', category: 'credit', label: 'Uang Muka (Urbun) Minimum',
    description: 'Persentase minimum uang muka dari harga barang.', valueType: 'percent', defaultValue: 10, min: 0, max: 90, unit: '%', isPublic: true,
  },
  {
    key: 'credit.max_financing_amount', category: 'credit', label: 'Plafon Pembiayaan Maksimum',
    description: 'Nilai pembiayaan maksimum per nasabah (setelah uang muka).', valueType: 'money', defaultValue: 50_000_000, min: 0, isPublic: true,
  },
  {
    key: 'credit.bizmgr_approval_limit', category: 'credit', label: 'Batas Wewenang Business Manager',
    description: 'Pengajuan di atas nilai ini wajib disetujui komite pembiayaan.', valueType: 'money', defaultValue: 25_000_000, min: 0,
  },
  {
    key: 'credit.max_dsr_pct', category: 'credit', label: 'Batas Rasio Angsuran terhadap Penghasilan (DSR)',
    description: 'Total angsuran (termasuk cicilan lain) maksimal sekian persen dari penghasilan terverifikasi. Di atas batas ditandai berisiko.',
    valueType: 'percent', defaultValue: 35, min: 5, max: 80, unit: '%',
  },
  {
    key: 'credit.approval_valid_days', category: 'credit', label: 'Masa Berlaku Persetujuan',
    description: 'Batas waktu akad setelah disetujui; lewat dari ini reservasi stok dilepas dan pengajuan dibatalkan.',
    valueType: 'number', defaultValue: 14, min: 1, max: 90, unit: 'hari',
  },
  {
    key: 'credit.grace_period_days', category: 'credit', label: 'Masa Tenggang Angsuran',
    description: 'Jumlah hari setelah jatuh tempo sebelum ta\'zir dikenakan.', valueType: 'number', defaultValue: 3, min: 0, max: 30, unit: 'hari',
  },
  {
    key: 'credit.late_tazir_flat', category: 'credit', label: 'Ta\'zir Keterlambatan (flat)',
    description: 'Denda keterlambatan bagi nasabah mampu yang menunda. Tidak diakui sebagai pendapatan, disalurkan ke dana sosial.',
    valueType: 'money', defaultValue: 50_000, min: 0,
  },
  {
    key: 'credit.tazir_enabled', category: 'credit', label: "Ta'zir Otomatis",
    description: "Kenakan ta'zir otomatis untuk setiap angsuran yang terlambat melewati masa tenggang (satu kali per angsuran). Ta'zir dicatat sebagai dana sosial dan dapat dibebaskan Manager Cabang untuk nasabah yang tidak mampu.",
    valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'credit.early_settlement_ibra_pct', category: 'credit', label: "Potongan Pelunasan Dipercepat (Ibra')",
    description: "Persentase margin yang belum jatuh tempo yang dibebaskan saat nasabah melunasi lebih cepat. Angsuran yang sudah menunggak tetap dibayar penuh.",
    valueType: 'percent', defaultValue: 50, min: 0, max: 100, unit: '%', isPublic: true,
  },
  {
    key: 'credit.installment_starts_on_handover', category: 'credit', label: 'Angsuran Mulai Setelah Serah Terima',
    description: 'Jadwal angsuran aktif hanya setelah barang diterima nasabah (POD / scan QR pickup).',
    valueType: 'boolean', defaultValue: true,
  },

  // ----- Pajak -----
  {
    key: 'tax.vat_rate', category: 'tax', label: 'Tarif PPN',
    description: 'Tarif pajak pertambahan nilai untuk barang kena pajak.', valueType: 'percent', defaultValue: 11, min: 0, max: 50, unit: '%', isPublic: true,
  },
  {
    key: 'tax.prices_include_vat', category: 'tax', label: 'Harga Katalog Sudah Termasuk PPN',
    description: 'Jika aktif (umum di ritel Indonesia), PPN tidak ditambahkan lagi saat checkout. Jika nonaktif, PPN ditambahkan di atas harga katalog.', valueType: 'boolean', defaultValue: true, isPublic: true,
  },

  // ----- Pengiriman -----
  {
    key: 'shipping.internal_rate_per_km', category: 'shipping', label: 'Tarif Ekspedisi Internal per KM',
    description: 'Biaya antar armada internal Masri-M per kilometer.', valueType: 'money', defaultValue: 2_500, min: 0, isPublic: true,
  },
  {
    key: 'shipping.internal_max_distance_km', category: 'shipping', label: 'Radius Maksimum Ekspedisi Internal',
    description: 'Di luar radius ini, nasabah ditawari kurir mitra.', valueType: 'number', defaultValue: 25, min: 1, max: 500, unit: 'km', isPublic: true,
  },
  {
    key: 'shipping.free_shipping_min_order', category: 'shipping', label: 'Minimum Order Gratis Ongkir (Internal)',
    description: 'Belanja di atas nilai ini gratis ongkir armada internal. Isi 0 untuk menonaktifkan.', valueType: 'money', defaultValue: 5_000_000, min: 0, isPublic: true,
  },
  {
    key: 'shipping.internal_flat_fee', category: 'shipping', label: 'Ongkir Armada Internal (dalam kota)',
    description: 'Biaya antar armada internal untuk alamat satu kota dengan cabang (bila jarak tidak diukur). Gratis bila melewati minimum order.',
    valueType: 'money', defaultValue: 75_000, min: 0, isPublic: true,
  },
  {
    key: 'shipping.installation_fee', category: 'shipping', label: 'Biaya Pemasangan / Perakitan',
    description: 'Biaya per barang yang memerlukan pemasangan (AC, TV bracket, furniture knock-down). Isi 0 bila gratis.',
    valueType: 'money', defaultValue: 0, min: 0, isPublic: true,
  },
  {
    key: 'shipping.partner_couriers', category: 'shipping', label: 'Kurir Mitra Aktif',
    description: 'Kode kurir mitra yang ditampilkan di checkout (via agregator, mis. Biteship/RajaOngkir).',
    valueType: 'json', defaultValue: ['jne', 'jnt', 'tiki', 'sicepat', 'anteraja', 'pos'], isPublic: true,
    jsonSchema: z.array(z.string().regex(/^[a-z0-9_-]+$/)).max(30),
  },
  {
    key: 'shipping.pickup_enabled', category: 'shipping', label: 'Ambil Sendiri di Gudang/Toko',
    description: 'Izinkan nasabah mengambil barang sendiri (click & collect).', valueType: 'boolean', defaultValue: true, isPublic: true,
  },
  {
    key: 'shipping.pickup_hold_days', category: 'shipping', label: 'Batas Waktu Pengambilan',
    description: 'Lama barang disimpan menunggu diambil sebelum order ditinjau ulang.', valueType: 'number', defaultValue: 7, min: 1, max: 30, unit: 'hari', isPublic: true,
  },

  // ----- Order & pembayaran -----
  {
    key: 'order.payment_expiry_hours', category: 'general', label: 'Batas Waktu Pembayaran Order Tunai',
    description: 'Order yang belum dibayar setelah batas ini dibatalkan otomatis dan reservasi stok dilepas.',
    valueType: 'number', defaultValue: 24, min: 1, max: 168, unit: 'jam', isPublic: true,
  },

  // ----- Stok -----
  {
    key: 'stock.transfer_requires_branch_manager_approval', category: 'stock', label: 'Permintaan Stok Cabang Perlu Persetujuan Manager Cabang',
    description: 'Jika aktif, permintaan stok dari Admin Cabang harus disetujui Manager Cabang sebelum diproses Gudang Pusat.',
    valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'stock.default_min_stock_branch', category: 'stock', label: 'Batas Stok Menipis Default (Cabang)',
    description: 'Batas stok menipis untuk produk baru di cabang. Dapat diubah per produk per lokasi.',
    valueType: 'number', defaultValue: 2, min: 0, max: 1000, unit: 'unit',
  },

  // ----- Helpdesk -----
  {
    key: 'helpdesk.sla_hours', category: 'helpdesk', label: 'Target SLA Penyelesaian Tiket',
    description: 'Batas waktu penyelesaian tiket (jam) per prioritas. Tiket melewati batas ditandai terlambat di Problem Status.',
    valueType: 'json', defaultValue: { urgent: 4, high: 24, normal: 72, low: 120 }, unit: 'jam',
    jsonSchema: z.object({
      urgent: z.number().positive(), high: z.number().positive(), normal: z.number().positive(), low: z.number().positive(),
    }, 'Harus berisi urgent, high, normal, low'),
  },

  // ----- Umum -----
  // ----- Keuangan cabang & kasir -----
  {
    key: 'finance.expense_mc_limit', category: 'finance', label: 'Batas Wewenang Manager Cabang (Biaya)',
    description: 'Biaya operasional di atas nilai ini wajib disetujui Business Manager setelah Manager Cabang.',
    valueType: 'money', defaultValue: 5_000_000, min: 0,
  },
  {
    key: 'finance.expense_monthly_budget', category: 'finance', label: 'Anggaran Biaya Operasional per Cabang / Bulan',
    description: 'Dipakai sebagai pembanding di laporan biaya. Pengajuan yang membuat realisasi melewati anggaran diberi tanda peringatan.',
    valueType: 'money', defaultValue: 25_000_000, min: 0,
  },
  {
    key: 'finance.require_cashier_shift', category: 'finance', label: 'Transaksi Tunai Wajib dalam Shift Kasir',
    description: 'Penerimaan & pengeluaran tunai hanya bisa dicatat bila petugas sudah membuka shift (saldo awal kas).',
    valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'finance.cash_variance_tolerance', category: 'finance', label: 'Toleransi Selisih Kas',
    description: 'Selisih hitung fisik dengan saldo sistem di atas nilai ini wajib diberi penjelasan saat tutup shift.',
    valueType: 'money', defaultValue: 10_000, min: 0,
  },
  {
    key: 'finance.fallback_cost_pct', category: 'finance', label: 'Estimasi HPP bila Harga Beli Kosong',
    description: 'Akuntansi: bila penerimaan barang tidak mencantumkan harga beli, nilai persediaan & HPP diperkirakan sebesar persentase ini dari harga tunai.',
    valueType: 'percent', defaultValue: 80, min: 1, max: 100, unit: '%',
  },
  // ----- Notifikasi nasabah -----
  {
    key: 'notify.whatsapp_enabled', category: 'notify', label: 'Kirim Notifikasi WhatsApp',
    description: 'Konfirmasi pesanan, pembayaran, pengiriman, kode pengambilan, status pembiayaan & pengingat angsuran. Provider diatur di server (.env).',
    valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'notify.email_enabled', category: 'notify', label: 'Kirim Notifikasi Email',
    description: 'Salinan notifikasi ke email nasabah (bila diisi). Server SMTP diatur di .env.', valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'notify.reminder_days_before', category: 'notify', label: 'Pengingat Angsuran (hari sebelum jatuh tempo)',
    description: 'Pengingat dikirim H-n, pada hari jatuh tempo, dan H+1 bila belum dibayar.', valueType: 'number', defaultValue: 3, min: 1, max: 14, unit: 'hari',
  },
  // ----- Asisten Virtual (Claude) -----
  {
    key: 'assistant.enabled', category: 'assistant', label: 'Aktifkan Asisten Virtual',
    description: 'Tampilkan chat Asisten Virtual di website. API key Anthropic tetap diatur di server (.env), bukan di sini.',
    valueType: 'boolean', defaultValue: true, isPublic: true,
  },
  {
    key: 'assistant.messages_per_hour', category: 'assistant', label: 'Batas Pesan per Pengunjung',
    description: 'Jumlah pesan maksimum per alamat IP per jam (mencegah penyalahgunaan & biaya berlebih).',
    valueType: 'number', defaultValue: 30, min: 5, max: 500, unit: 'pesan',
  },
  {
    key: 'assistant.daily_token_budget', category: 'assistant', label: 'Anggaran Token Harian',
    description: 'Total token (input + output) per hari. Jika terlampaui, asisten menampilkan kontak CS sampai besok. 0 = tanpa batas.',
    valueType: 'number', defaultValue: 2_000_000, min: 0, unit: 'token',
  },
  {
    key: 'assistant.can_create_ticket', category: 'assistant', label: 'Asisten Boleh Membuat Tiket Helpdesk',
    description: 'Keluhan yang dikonfirmasi nasabah di chat langsung masuk antrian Helpdesk Pusat (kanal "Asisten Virtual").',
    valueType: 'boolean', defaultValue: true,
  },
  {
    key: 'general.maintenance_mode', category: 'general', label: 'Mode Pemeliharaan',
    description: 'Tutup sementara checkout & pengajuan kredit baru.', valueType: 'boolean', defaultValue: false, isPublic: true,
  },
  {
    key: 'general.company_name', category: 'general', label: 'Nama Perusahaan (Kwitansi)',
    description: 'Dicetak di kop kwitansi, bukti kas keluar, dan dokumen nasabah.', valueType: 'string', defaultValue: 'Masri-M Syariah', isPublic: true,
  },
  {
    key: 'general.bank_transfer_info', category: 'general', label: 'Rekening Transfer Bank (bayar di cabang)',
    description: 'Ditampilkan kepada nasabah yang memilih bayar di cabang / transfer bank, mis. "Bank Islam Brunei Darussalam 00-01-02-123456 a.n. Masri-M". Kosongkan bila tidak menerima transfer.',
    valueType: 'string', defaultValue: '', isPublic: true,
  },
  {
    key: 'general.support_whatsapp', category: 'general', label: 'Nomor WhatsApp CS',
    description: 'Nomor layanan pelanggan (format internasional).', valueType: 'string', defaultValue: '+6281200000000', isPublic: true,
  },
  {
    key: 'marketing.min_days_between', category: 'notify', label: 'Jeda Minimum Pesan Promo per Nasabah',
    description: 'Nasabah yang menerima promo dalam jangka ini dilewati pada kampanye berikutnya (mencegah spam).', valueType: 'number', defaultValue: 3, min: 1, max: 60, unit: 'hari',
  },
  {
    key: 'general.legal_name', category: 'general', label: 'Nama Badan Usaha (Legal)',
    description: 'Nama resmi badan usaha di negara ini (mis. "PT ... " / "... Sdn. Bhd."). Ditampilkan di Syarat & Ketentuan dan Kebijakan Privasi.',
    valueType: 'string', defaultValue: '', isPublic: true,
  },
  {
    key: 'general.legal_address', category: 'general', label: 'Alamat Kantor Terdaftar',
    description: 'Alamat resmi badan usaha untuk dokumen hukum dan korespondensi nasabah.', valueType: 'string', defaultValue: '', isPublic: true,
  },
  {
    key: 'general.privacy_email', category: 'general', label: 'Email Perlindungan Data',
    description: 'Alamat email untuk permintaan akses, koreksi, atau penghapusan data pribadi (pejabat/petugas pelindungan data).',
    valueType: 'string', defaultValue: '', isPublic: true,
  },
];

export const CONFIG_BY_KEY = new Map(CONFIG_DEFINITIONS.map((d) => [d.key, d]));

/**
 * Nilai awal per negara yang berbeda dari Indonesia (mata uang, pajak, kurir). Dipakai sebagai cadangan bila
 * parameter negara belum disimpan, dan saat Super Admin menyalin parameter ke negara baru.
 * Nominal dalam mata uang negara tersebut — tetap wajib ditinjau tim legal & keuangan setempat sebelum aktivasi.
 */
export const COUNTRY_DEFAULTS: Record<string, Record<string, unknown>> = {
  MY: {
    'credit.max_financing_amount': 20_000, 'credit.bizmgr_approval_limit': 8_000, 'credit.late_tazir_flat': 10,
    'tax.vat_rate': 10, 'tax.prices_include_vat': true,
    'shipping.internal_rate_per_km': 1.5, 'shipping.free_shipping_min_order': 1_500, 'shipping.internal_flat_fee': 25, 'shipping.installation_fee': 0,
    'shipping.partner_couriers': ['poslaju', 'jnt', 'citylink', 'ninjavan', 'dhl'],
    'finance.expense_mc_limit': 1_500, 'finance.expense_monthly_budget': 8_000, 'finance.cash_variance_tolerance': 5,
    'general.support_whatsapp': '+60123000000',
  },
  BN: {
    'credit.max_financing_amount': 8_000, 'credit.bizmgr_approval_limit': 3_000, 'credit.late_tazir_flat': 5,
    'tax.vat_rate': 0, 'tax.prices_include_vat': true,
    'shipping.internal_rate_per_km': 0.5, 'shipping.free_shipping_min_order': 500, 'shipping.internal_flat_fee': 10, 'shipping.installation_fee': 0,
    'shipping.partner_couriers': [],
    'finance.expense_mc_limit': 500, 'finance.expense_monthly_budget': 3_000, 'finance.cash_variance_tolerance': 2,
    'general.support_whatsapp': '+6737000000',
  },
};
export const defaultFor = (key: string, country = 'ID') =>
  COUNTRY_DEFAULTS[country] && key in COUNTRY_DEFAULTS[country] ? COUNTRY_DEFAULTS[country][key] : CONFIG_BY_KEY.get(key)?.defaultValue;

/** Validasi nilai baru sesuai definisi. Mengembalikan pesan error atau null. */
export function validateConfigValue(def: Pick<ConfigDefinition, 'valueType' | 'min' | 'max' | 'jsonSchema'>, value: unknown): string | null {
  switch (def.valueType) {
    case 'number':
    case 'percent':
    case 'money': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Nilai harus berupa angka';
      if (def.min !== undefined && value < def.min) return `Nilai minimal ${def.min}`;
      if (def.max !== undefined && value > def.max) return `Nilai maksimal ${def.max}`;
      if (def.valueType === 'money' && !Number.isInteger(value)) return 'Nominal uang harus bilangan bulat';
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Nilai harus true/false';
    case 'string':
      return typeof value === 'string' && value.length <= 500 ? null : 'Nilai harus teks (maks. 500 karakter)';
    case 'json': {
      if (value === null || typeof value !== 'object') return 'Nilai harus objek/array JSON';
      if (def.jsonSchema) {
        const r = def.jsonSchema.safeParse(value);
        if (!r.success) return r.error.issues.map((i) => i.message).join('; ');
      }
      return null;
    }
  }
}
