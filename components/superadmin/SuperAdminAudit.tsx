import React, { useCallback, useEffect, useState } from 'react';
import { FileText, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { AuditLog } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, formatDateTime, inputCls, btnSecondary } from './ui';

const ACTION_FILTERS = [
  { value: '', label: 'Semua aktivitas' },
  { value: 'auth.', label: 'Login & keamanan' },
  { value: 'user.', label: 'Manajemen user' },
  { value: 'config.', label: 'Parameter bisnis' },
  { value: 'country.', label: 'Negara' },
];

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Login berhasil',
  'auth.login_failed': 'Login gagal',
  'auth.account_locked': 'Akun terkunci',
  'auth.password_changed': 'Ganti password',
  'user.create': 'Buat user',
  'user.update': 'Ubah user',
  'user.reset_password': 'Reset password',
  'config.update': 'Ubah parameter',
  'config.copy': 'Salin parameter',
  'country.update': 'Ubah status negara',
};

const actionColor = (a: string) =>
  a.includes('failed') || a.includes('locked') ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  : a.startsWith('config') || a.startsWith('country') ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  : a.startsWith('user') ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';

const PAGE_SIZE = 25;

export const SuperAdminAudit: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ logs: AuditLog[]; total: number }>(`/admin/audit-logs${qs({ action, actor, page, pageSize: PAGE_SIZE })}`);
      setLogs(r.logs);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [action, actor, page]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<FileText className="w-6 h-6" />} title="Audit Log"
        subtitle="Jejak seluruh aktivitas sensitif: login, perubahan user, dan perubahan parameter bisnis. Data tidak dapat diubah atau dihapus."
        actions={<button className={btnSecondary} onClick={load}><RefreshCw className="w-4 h-4" /> Muat ulang</button>} />

      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <select className={inputCls} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          {ACTION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <input className={`${inputCls} md:col-span-2`} placeholder="Filter email pelaku..." value={actor}
          onChange={(e) => { setActor(e.target.value); setPage(1); }} />
      </Card>

      <ErrorBox message={error} onClose={() => setError(null)} />

      <Card className="overflow-hidden">
        {loading && logs.length === 0 ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Waktu</th>
                  <th className="text-left px-4 py-3">Aktivitas</th>
                  <th className="text-left px-4 py-3">Pelaku</th>
                  <th className="text-left px-4 py-3">Objek</th>
                  <th className="text-left px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {logs.map((l) => (
                  <React.Fragment key={l.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(l.action)}`}>{ACTION_LABEL[l.action] ?? l.action}</span></td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{l.actorEmail ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">{l.entityType ? `${l.entityType}:${l.entityId ?? ''}` : '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{l.ip}</td>
                    </tr>
                    {expanded === l.id && (l.before != null || l.after != null) && (
                      <tr className="bg-slate-50 dark:bg-slate-900/40">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid md:grid-cols-2 gap-3">
                            <div><p className="text-xs font-semibold text-slate-500 mb-1">Sebelum</p><pre className="text-xs bg-white dark:bg-slate-800 p-3 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">{JSON.stringify(l.before, null, 2) ?? '—'}</pre></div>
                            <div><p className="text-xs font-semibold text-slate-500 mb-1">Sesudah</p><pre className="text-xs bg-white dark:bg-slate-800 p-3 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">{JSON.stringify(l.after, null, 2) ?? '—'}</pre></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {logs.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-slate-500">Belum ada aktivitas.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
          <span>{total} entri</span>
          <div className="flex items-center gap-2">
            <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
            <span>Hal. {page} / {totalPages}</span>
            <button className={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </Card>
    </div>
  );
};
