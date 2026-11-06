import { StockMovement, TransferStatus } from '../../types';

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; cls: string }> = {
  requested: { label: 'Menunggu Persetujuan', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Siap Dikirim', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  shipped: { label: 'Dalam Perjalanan', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  received: { label: 'Diterima', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Ditolak', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Dibatalkan', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

export const MOVEMENT_LABEL: Record<StockMovement['type'], string> = {
  receipt: 'Penerimaan supplier', transfer_out: 'Transfer keluar', transfer_in: 'Transfer masuk', adjustment: 'Penyesuaian / opname',
  reserve: 'Reservasi order', release: 'Batal reservasi', sale_out: 'Keluar ke nasabah', return_in: 'Retur masuk',
};

export const ADJ_REASON: Record<string, string> = {
  opname: 'Stock opname', damaged: 'Barang rusak', lost: 'Barang hilang', found: 'Selisih lebih (ditemukan)', other: 'Lainnya',
};
