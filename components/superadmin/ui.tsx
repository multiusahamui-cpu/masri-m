import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { UserStatus } from '../../types';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm ${className}`}>{children}</div>
);

export const PageHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; actions?: React.ReactNode }> = ({ icon, title, subtitle, actions }) => (
  <Card className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
    <div>
      <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
        <span className="text-masri-primary">{icon}</span>{title}
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{subtitle}</p>
    </div>
    {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
  </Card>
);

export const ErrorBox: React.FC<{ message: string | null; onClose?: () => void }> = ({ message, onClose }) =>
  message ? (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} aria-label="Tutup"><X className="w-4 h-4" /></button>}
    </div>
  ) : null;

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Memuat...' }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-slate-500 dark:text-slate-400 text-sm">
    <Loader2 className="w-5 h-5 animate-spin text-masri-primary" /> {label}
  </div>
);

// Dirender lewat portal ke <body> agar tidak terpengaruh margin/transform elemen induk.
export const Modal: React.FC<{ title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean | 'xl' }> = ({ title, onClose, children, wide }) => createPortal(
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200" onClick={onClose}>
    <div
      className={`w-full ${wide === 'xl' ? 'max-w-5xl' : wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-bold text-lg text-slate-800 dark:text-white">{title}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500" aria-label="Tutup"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>,
  document.body,
);

export const inputCls = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-masri-primary disabled:opacity-60';
export const labelCls = 'block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1';
export const btnPrimary = 'px-4 py-2 bg-masri-primary text-white text-sm font-bold rounded-lg hover:bg-masri-dark transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap';
export const btnSecondary = 'px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap';

const STATUS_STYLE: Record<UserStatus, { label: string; cls: string }> = {
  active: { label: 'Aktif', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  inactive: { label: 'Nonaktif', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  locked: { label: 'Terkunci', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

export const StatusBadge: React.FC<{ status: UserStatus }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status].cls}`}>{STATUS_STYLE[status].label}</span>
);

export const formatDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
