import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Users, UserX, Lock, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { AuditLog, AuthUser, RoleInfo } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, formatDateTime } from './ui';
import { ACTION_LABEL } from './SuperAdminAudit';

interface Stats { byStatus: { status: string; n: number }[]; byRole: { roleCode: string; n: number }[] }

export const SuperAdminOverview: React.FC<{ currentUser: AuthUser; onNavigate: (menu: string) => void }> = ({ currentUser, onNavigate }) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Stats>('/admin/stats'),
      api.get<{ roles: RoleInfo[] }>('/admin/roles'),
      api.get<{ logs: AuditLog[] }>('/admin/audit-logs?pageSize=8'),
    ]).then(([s, r, l]) => { setStats(s); setRoles(r.roles); setLogs(l.logs); })
      .catch((e) => setError((e as ApiError).message));
  }, []);

  const n = (status: string) => stats?.byStatus.find((s) => s.status === status)?.n ?? 0;
  const total = stats?.byStatus.reduce((a, s) => a + s.n, 0) ?? 0;

  const tiles = [
    { label: 'Total User Internal', value: total, icon: <Users className="w-5 h-5" />, cls: 'text-masri-primary bg-masri-light dark:bg-emerald-900/30' },
    { label: 'Nonaktif', value: n('inactive'), icon: <UserX className="w-5 h-5" />, cls: 'text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300' },
    { label: 'Terkunci', value: n('locked'), icon: <Lock className="w-5 h-5" />, cls: 'text-red-600 bg-red-50 dark:bg-red-900/30' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<LayoutDashboard className="w-6 h-6" />} title={`Assalamualaikum, ${currentUser.fullName}`}
        subtitle="Pusat kendali tata kelola Masri-M: user internal, parameter bisnis, dan jejak audit." />
      <ErrorBox message={error} />
      {!stats ? <Spinner /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {tiles.map((t) => (
              <Card key={t.label} className="p-5 flex items-center gap-4">
                <div className={`p-3 rounded-xl ${t.cls}`}>{t.icon}</div>
                <div>
                  <p className="text-2xl font-bold text-slate-800 dark:text-white">{t.value}</p>
                  <p className="text-xs text-slate-500">{t.label}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">User per Role</h3>
                <button onClick={() => onNavigate('users')} className="text-sm text-masri-primary flex items-center gap-1 hover:underline">Kelola <ArrowRight className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                {roles.filter((r) => r.isInternal).map((r) => {
                  const count = stats.byRole.find((b) => b.roleCode === r.code)?.n ?? 0;
                  const pct = total ? (count / total) * 100 : 0;
                  return (
                    <div key={r.code} className="grid grid-cols-[140px_1fr_32px] items-center gap-3 text-sm">
                      <span className="text-slate-600 dark:text-slate-300 truncate">{r.name}</span>
                      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-masri-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-right font-semibold text-slate-700 dark:text-slate-200">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Aktivitas Terbaru</h3>
                <button onClick={() => onNavigate('audit')} className="text-sm text-masri-primary flex items-center gap-1 hover:underline">Semua <ArrowRight className="w-4 h-4" /></button>
              </div>
              <ul className="space-y-3">
                {logs.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-slate-700 dark:text-slate-300">
                      <strong>{ACTION_LABEL[l.action] ?? l.action}</strong>
                      <span className="text-slate-500"> · {l.actorEmail ?? 'tidak dikenal'}</span>
                    </span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{formatDateTime(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <button onClick={() => onNavigate('business-config')} className="w-full text-left">
            <Card className="p-5 flex items-center gap-4 hover:border-masri-primary transition-colors">
              <div className="p-3 rounded-xl text-masri-gold bg-amber-50 dark:bg-amber-900/30"><SlidersHorizontal className="w-5 h-5" /></div>
              <div className="flex-1">
                <p className="font-bold text-slate-800 dark:text-white">Parameter Bisnis</p>
                <p className="text-sm text-slate-500">Margin Murabahah per tenor, uang muka, PPN, tarif & mode pengiriman, per negara.</p>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-400" />
            </Card>
          </button>
        </>
      )}
    </div>
  );
};
