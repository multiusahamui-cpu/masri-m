import { HdCategory, HdChannel, HdPriority, HdStatus } from '../../types';

export const STATUS_META: Record<HdStatus, { label: string; cls: string }> = {
  open: { label: 'Baru', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  in_progress: { label: 'Ditangani Pusat', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  escalated: { label: 'Eskalasi Cabang', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  branch_done: { label: 'Selesai Cabang', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  resolved: { label: 'Selesai', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  closed: { label: 'Ditutup', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

export const CATEGORY_LABEL: Record<HdCategory, string> = {
  order: 'Pesanan', delivery: 'Pengiriman & Pemasangan', product: 'Produk / Garansi', credit: 'Pengajuan Kredit',
  payment: 'Pembayaran & Angsuran', account: 'Akun & Aplikasi', other: 'Lainnya',
};

export const PRIORITY_META: Record<HdPriority, { label: string; cls: string }> = {
  urgent: { label: 'Urgent', cls: 'text-red-600 dark:text-red-400' },
  high: { label: 'Tinggi', cls: 'text-orange-600 dark:text-orange-400' },
  normal: { label: 'Normal', cls: 'text-slate-600 dark:text-slate-300' },
  low: { label: 'Rendah', cls: 'text-slate-400' },
};

export const CHANNEL_LABEL: Record<HdChannel, string> = {
  web: 'Web / App', whatsapp: 'WhatsApp', phone: 'Telepon', email: 'Email', walk_in: 'Datang Langsung', chat: 'Asisten Virtual',
};

export const ROLE_SHORT: Record<string, string> = {
  support: 'Helpdesk Pusat', 'biz-mgr': 'Business Manager', 'branch-manager': 'Manager Cabang', 'branch-admin': 'Admin Cabang',
};

export const WATCHER_REASON: Record<string, string> = {
  assignee: 'Penanggung jawab', cc_branch_manager: 'Tembusan (Manager Cabang)', cc_biz_mgr: 'Tembusan (Business Manager)',
};

export function timeLeft(dueAt: string, done: boolean): { text: string; overdue: boolean } {
  if (done) return { text: '—', overdue: false };
  const diffH = (new Date(dueAt).getTime() - Date.now()) / 3600_000;
  const abs = Math.abs(diffH);
  const txt = abs >= 48 ? `${Math.round(abs / 24)} hari` : `${Math.max(1, Math.round(abs))} jam`;
  return diffH < 0 ? { text: `Lewat ${txt}`, overdue: true } : { text: `Sisa ${txt}`, overdue: false };
}

