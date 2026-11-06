import React, { useEffect, useState } from 'react';
import { PieChart, Users2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser, CreditStatus, CreditSummary } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, formatDateTime } from '../superadmin/ui';
import { CREDIT_STATUS } from './labels';

const PIPELINE: CreditStatus[] = ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted', 'active'];

/** Ringkasan pipeline pembiayaan (BM: semua cabang, Manager Cabang: cabangnya). */
export const CreditAnalytics: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [s, setS] = useState<CreditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<CreditSummary>('/credit/summary').then(setS).catch((e) => setError((e as ApiError).message)); }, []);
  const isBranch = currentUser.roleCode === 'branch-manager';
  const n = (st: CreditStatus) => s?.byStatus.find((b) => b.status === st)?.n ?? 0;
  const max = Math.max(1, ...PIPELINE.map(n));
  const rate = s && s.kpi.decided30d ? Math.round((s.kpi.approved30d / s.kpi.decided30d) * 100) : null;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<PieChart className="w-6 h-6" />} title={isBranch ? `Dashboard Kredit ${currentUser.branch?.name ?? ''}` : 'Credit Analytics'}
        subtitle="Pipeline pengajuan pembiayaan Murabahah dari masuk hingga aktif." />
      <ErrorBox message={error} />
      {!s ? <Spinner /> : (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="Outstanding pembiayaan aktif" value={formatMoney(s.kpi.activeOutstanding)} />
          <Tile label="Approval rate 30 hari" value={rate !== null ? `${rate}%` : '—'} sub={`${s.kpi.approved30d} dari ${s.kpi.decided30d} diputuskan`} />
          <Tile label="Rata-rata waktu sampai keputusan" value={s.kpi.avgDaysToDecision !== null ? `${s.kpi.avgDaysToDecision} hari` : '—'} />
          <Tile label="Pembiayaan aktif" value={String(n('active'))} sub={`${n('contracted')} menunggu serah terima`} />
        </div>
        <Card className="p-5">
          <h4 className="font-bold text-slate-800 dark:text-white mb-4">Pipeline</h4>
          <div className="space-y-2.5">
            {PIPELINE.map((st) => (
              <div key={st} className="grid grid-cols-[200px_1fr_40px] items-center gap-3 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{CREDIT_STATUS[st].label}</span>
                <span className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden"><span className="block h-full bg-masri-primary rounded-full" style={{ width: `${(n(st) / max) * 100}%` }} /></span>
                <span className="text-right font-semibold text-slate-700 dark:text-slate-200">{n(st)}</span>
              </div>
            ))}
            <p className="text-xs text-slate-500 pt-2">Ditolak: {n('rejected')} · Dibatalkan: {n('cancelled')} · Lunas: {n('paid_off')}</p>
          </div>
        </Card>
        {!isBranch && (
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">Per Cabang</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr>
                <th className="text-left px-4 py-3">Cabang</th><th className="text-right px-4 py-3">Proses cabang</th><th className="text-right px-4 py-3">Review MC</th>
                <th className="text-right px-4 py-3">Di Pusat</th><th className="text-right px-4 py-3">Disetujui/akad</th><th className="text-right px-4 py-3">Aktif</th><th className="text-right px-4 py-3">Outstanding</th><th className="text-right px-4 py-3">Ditolak</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {s.byBranch.map((b) => (
                  <tr key={b.branchId}><td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{b.branchName}</td>
                    <td className="px-4 py-3 text-right">{b.submitted}</td><td className="px-4 py-3 text-right">{b.branchReview}</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-600">{b.hqReview}</td><td className="px-4 py-3 text-right">{b.approved}</td>
                    <td className="px-4 py-3 text-right text-green-700">{b.active}</td><td className="px-4 py-3 text-right">{formatMoney(b.activeFinanced)}</td><td className="px-4 py-3 text-right text-red-600">{b.rejected}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </>)}
    </div>
  );
};

const Tile: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <Card className="p-4"><p className="text-xl font-bold text-slate-800 dark:text-white">{value}</p><p className="text-xs text-slate-500">{label}</p>{sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}</Card>
);

/** Tim AO cabang & beban kerja (Manager Cabang). */
/** Kinerja AO. Manager Cabang: cabangnya sendiri. Business Manager: pilih cabang. */
export const AoTeam: React.FC<{ pickBranch?: boolean }> = ({ pickBranch }) => {
  const [team, setTeam] = useState<{ id: string; fullName: string; email: string; phone: string | null; status: string; lastLoginAt: string | null; open: number; needsAction: number; active: number; approved30d: number; rejected30d: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; type: string }[]>([]);
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    if (!pickBranch) return;
    api.get<{ branches: { id: string; name: string; type: string }[] }>('/branches').then((r) => {
      const list = r.branches.filter((b) => b.type !== 'head_office');
      setBranches(list); if (list[0]) setBranchId(list[0].id);
    }).catch((e) => setError((e as ApiError).message));
  }, [pickBranch]);
  useEffect(() => {
    if (pickBranch && !branchId) return;
    setTeam(null);
    api.get<{ team: NonNullable<typeof team> }>(`/credit/ao-team${pickBranch ? `?branchId=${branchId}` : ''}`).then((r) => setTeam(r.team)).catch((e) => setError((e as ApiError).message));
  }, [pickBranch, branchId]);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Users2 className="w-6 h-6" />} title={pickBranch ? 'Kinerja Tim AO per Cabang' : 'Tim Account Officer'} subtitle="Beban kerja dan hasil 30 hari terakhir. Penambahan AO melalui Super Admin." />
      {pickBranch && (
        <select className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <ErrorBox message={error} />
      {!team ? <Spinner /> : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr>
              <th className="text-left px-4 py-3">AO</th><th className="text-right px-4 py-3">Perlu dikerjakan</th><th className="text-right px-4 py-3">Berjalan</th>
              <th className="text-right px-4 py-3">Aktif (portofolio)</th><th className="text-right px-4 py-3">Disetujui 30h</th><th className="text-right px-4 py-3">Ditolak 30h</th><th className="text-left px-4 py-3">Login terakhir</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {team.map((t) => (
                <tr key={t.id}><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-white">{t.fullName}</p><p className="text-xs text-slate-500">{t.email}</p></td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{t.needsAction}</td><td className="px-4 py-3 text-right">{t.open}</td>
                  <td className="px-4 py-3 text-right text-green-700">{t.active}</td><td className="px-4 py-3 text-right">{t.approved30d}</td><td className="px-4 py-3 text-right text-red-600">{t.rejected30d}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(t.lastLoginAt)}</td></tr>
              ))}
              {team.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-slate-500">Belum ada AO di cabang ini.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};
