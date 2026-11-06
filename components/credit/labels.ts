import { CreditStatus } from '../../types';

export const CREDIT_STATUS: Record<CreditStatus, { label: string; cls: string }> = {
  submitted: { label: 'Pengajuan Baru', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  assigned: { label: 'Verifikasi & Survei AO', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  branch_review: { label: 'Review Manager Cabang', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  hq_review: { label: 'Keputusan Pusat', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  approved: { label: 'Disetujui — Akad & Uang Muka', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  contracted: { label: 'Akad — Menunggu Serah Terima', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  active: { label: 'Pembiayaan Aktif', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  paid_off: { label: 'Lunas', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  rejected: { label: 'Ditolak', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Dibatalkan', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

export const KYC_LABEL: Record<string, string> = {
  ktp: 'KTP / identitas asli sesuai data', selfie: 'Foto selfie dengan KTP cocok', kk: 'Kartu Keluarga',
  income_proof: 'Bukti penghasilan (slip gaji / mutasi rekening / SKU)', address_proof: 'Bukti domisili (tagihan listrik/air)',
};

export const RESIDENCE_LABEL: Record<string, string> = { own: 'Milik sendiri', family: 'Milik keluarga', rent: 'Sewa / kontrak', official: 'Rumah dinas' };
export const MARITAL_LABEL: Record<string, string> = { single: 'Belum menikah', married: 'Menikah', widowed: 'Cerai / janda / duda' };
export const DP_METHOD_LABEL: Record<string, string> = { cash: 'Tunai di kasir', transfer: 'Transfer bank', qris: 'QRIS', va: 'Virtual Account' };
export const HANDOVER_LABEL: Record<string, string> = { pickup: 'Diambil sendiri di cabang', internal: 'Diantar armada Masri-M', partner: 'Kurir mitra' };

export const EVENT_LABEL: Record<string, string> = {
  submitted: 'mengajukan pembiayaan', assigned: 'menugaskan AO', kyc: 'memverifikasi KYC', survey: 'mencatat survei lapangan',
  ao_recommendation: 'memberi rekomendasi', mc_forward: 'meneruskan ke Pusat', mc_return: 'mengembalikan ke AO', mc_reject: 'menolak di cabang',
  committee_vote: 'memberi suara komite', hq_approve: 'MENYETUJUI', hq_reject: 'MENOLAK', hq_return: 'mengembalikan ke cabang',
  contract: 'mencatat akad', dp_paid: 'menerima uang muka', handover: 'mencatat serah terima barang', cancelled: 'membatalkan',
  iqalah_requested: 'mengajukan iqalah (pembatalan akad)', iqalah_approved: 'MENYETUJUI iqalah', iqalah_rejected: 'menolak iqalah', iqalah_completed: 'menerima barang iqalah & mengembalikan dana',
};
