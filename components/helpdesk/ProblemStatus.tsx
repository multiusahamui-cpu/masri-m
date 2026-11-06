import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Siren, RefreshCw, AlertTriangle, Clock, ArrowUpRight, CheckCircle2, Timer, ChevronRight } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { AuthUser, BranchOption, HdStatus, HdSummary } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, btnSecondary } from '../superadmin/ui';
import { CATEGORY_LABEL, STATUS_META } from './labels';
import { TicketList, TicketFilter } from './TicketList';
import { TicketDetail } from './TicketDetail';

const PENDING_ORDER: HdStatus[] = ['open', 'in_progress', 'escalated', 'branch_done'];

/**
 * Problem Status — dashboard masalah & eskalasi.
 * Business Manager / Helpdesk: semua cabang. Manager Cabang: hanya cabangnya.
 * Klik angka / baris cabang untuk drill-down ke daftar tiket, lalu klik tiket untuk melihat nasabah & penyelesaiannya.
 */
export const ProblemStatus: React.FC<{ currentUser: AuthUser; focusTicketId?: string | null; onFocusHandled?: () => void }> = ({ currentUser, focusTicketId, onFocusHandled }) => {
  const [summary, setSummary] = useState<HdSummary | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TicketFilter>({ status: 'pending' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const isBranchScope = currentUser.roleCode === 'branch-manager';

  const load = useCallback(async () => {
    try {
      setSummary(await api.get<HdSummary>('/helpdesk/summary'));
      setError(null);
    } catch (e) { setError((e as ApiError).message); }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { if (!isBranchScope) api.get<{ branches: BranchOption[] }>('/branches').then((r) => setBranches(r.branches)).catch(() => undefined); }, [isBranchScope]);
  useEffect(() => { if (focusTicketId) { setOpenId(focusTicketId); onFocusHandled?.(); } }, [focusTicketId, onFocusHandled]);

  const drill = (f: TicketFilter) => {
    setFilter(f);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const k = summary?.kpi;
  const statusN = (s: HdStatus) => summary?.byStatus.find((x) => x.status === s)?.n ?? 0;
  const pendingMax = Math.max(1, ...PENDING_ORDER.map(statusN));
  const catMax = Math.max(1, ...(summary?.byCategory.map((c) => c.n) ?? [1]));
  const agingRows = summary ? [
    { label: '< 1 hari', n: summary.aging.lt1d, cls: 'bg-emerald-500' },
    { label: '1–3 hari', n: summary.aging.d1to3, cls: 'bg-amber-400' },
    { label: '3–7 hari', n: summary.aging.d3to7, cls: 'bg-orange-500' },
    { label: '> 7 hari', n: summary.aging.gt7d, cls: 'bg-red-600' },
  ] : [];
  const agingMax = Math.max(1, ...agingRows.map((a) => a.n));
  const slaPct = k && k.resolved30d ? Math.round((k.slaMet30d / k.resolved30d) * 100) : null;

  const tiles = k ? [
    { label: 'Pending', value: k.pending, icon: <Clock className="w-5 h-5" />, cls: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30', f: { status: 'pending' } },
    { label: 'Terlambat SLA', value: k.overdue, icon: <AlertTriangle className="w-5 h-5" />, cls: 'text-red-600 bg-red-50 dark:bg-red-900/30', f: { status: 'overdue' } },
    { label: 'Eskalasi di Cabang', value: k.escalatedOpen, icon: <ArrowUpRight className="w-5 h-5" />, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30', f: { status: 'escalated' } },
    { label: `Selesai 30 hari${slaPct !== null ? ` · ${slaPct}% tepat SLA` : ''}`, value: k.resolved30d, icon: <CheckCircle2 className="w-5 h-5" />, cls: 'text-green-600 bg-green-50 dark:bg-green-900/30', f: { status: 'resolved' } },
    { label: 'Rata-rata penyelesaian', value: k.avgResolveHours30d !== null ? `${k.avgResolveHours30d} jam` : '—', icon: <Timer className="w-5 h-5" />, cls: 'text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300', f: null },
  ] : [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Siren className="w-6 h-6" />} title="Problem Status"
        subtitle={isBranchScope
          ? `Masalah & eskalasi nasabah ${currentUser.branch?.name ?? 'cabang Anda'}. Klik angka untuk melihat rincian tiket.`
          : 'Masalah & eskalasi nasabah seluruh cabang. Klik angka atau baris cabang untuk drill-down sampai ke data nasabah.'}
        actions={<button className={btnSecondary} onClick={() => setRefreshKey((x) => x + 1)}><RefreshCw className="w-4 h-4" /> Muat ulang</button>} />

      <ErrorBox message={error} onClose={() => setError(null)} />
      {!summary ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {tiles.map((t) => (
              <button key={t.label} disabled={!t.f} onClick={() => t.f && drill({ ...filter, ...t.f })} className="text-left disabled:cursor-default">
                <Card className={`p-4 h-full flex items-center gap-3 ${t.f ? 'hover:border-masri-primary transition-colors' : ''}`}>
                  <div className={`p-2.5 rounded-xl ${t.cls}`}>{t.icon}</div>
                  <div>
                    <p className="text-2xl font-bold text-slate-800 dark:text-white">{t.value}</p>
                    <p className="text-xs text-slate-500">{t.label}</p>
                  </div>
                </Card>
              </button>
            ))}
          </div>

          {/* Ringkasan per cabang */}
          <Card className="overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
              Ringkasan Pending per Cabang
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Cabang</th>
                    <th className="text-right px-4 py-3">Pending</th>
                    <th className="text-right px-4 py-3">Eskalasi</th>
                    <th className="text-right px-4 py-3" title="Sudah ditangani cabang, menunggu konfirmasi Helpdesk Pusat">Selesai Cabang</th>
                    <th className="text-right px-4 py-3">Terlambat</th>
                    <th className="text-right px-4 py-3">Selesai 30 hari</th>
                    <th className="px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {summary.byBranch.map((b) => {
                    const bid = b.branchId ?? 'none';
                    return (
                      <tr key={bid} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => drill({ status: 'pending', branchId: isBranchScope ? undefined : bid })}>
                        <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{b.branchName ?? <span className="text-slate-400 font-normal">Belum ditentukan</span>}
                          {b.branchCode && <span className="ml-2 font-mono text-xs text-slate-400">{b.branchCode}</span>}</td>
                        <Num v={b.pending} onClick={() => drill({ status: 'pending', branchId: isBranchScope ? undefined : bid })} />
                        <Num v={b.escalated} cls="text-amber-600" onClick={() => drill({ status: 'escalated', branchId: isBranchScope ? undefined : bid })} />
                        <Num v={b.branchDone} cls="text-teal-600" onClick={() => drill({ status: 'branch_done', branchId: isBranchScope ? undefined : bid })} />
                        <Num v={b.overdue} cls="text-red-600 font-bold" onClick={() => drill({ status: 'overdue', branchId: isBranchScope ? undefined : bid })} />
                        <Num v={b.resolved30d} cls="text-green-600" onClick={() => drill({ status: 'resolved', branchId: isBranchScope ? undefined : bid })} />
                        <td className="px-2 text-slate-400"><ChevronRight className="w-4 h-4" /></td>
                      </tr>
                    );
                  })}
                  {summary.byBranch.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-slate-500">Belum ada tiket.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <BarCard title="Pending per Tahap" rows={PENDING_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, n: statusN(s), max: pendingMax, cls: 'bg-masri-primary', onClick: () => drill({ ...filter, status: s }) }))} />
            <BarCard title="Pending per Kategori" rows={[...summary.byCategory].sort((a, b) => b.n - a.n).map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], n: c.n, max: catMax, cls: 'bg-masri-gold', onClick: () => drill({ ...filter, status: 'pending', category: c.category }) }))} empty="Tidak ada tiket pending" />
            <BarCard title="Umur Tiket Pending" rows={agingRows.map((a) => ({ key: a.label, label: a.label, n: a.n, max: agingMax, cls: a.cls }))} />
          </div>
        </>
      )}

      <div ref={listRef} className="space-y-3 scroll-mt-24">
        <h3 className="font-bold text-slate-800 dark:text-white">Rincian Tiket</h3>
        <TicketList filter={filter} onFilterChange={setFilter} onOpen={setOpenId} refreshKey={refreshKey}
          branches={isBranchScope ? undefined : branches} />
      </div>

      {openId && (
        <TicketDetail ticketId={openId} currentUser={currentUser} branches={branches}
          onClose={() => setOpenId(null)} onChanged={() => setRefreshKey((x) => x + 1)} />
      )}
    </div>
  );
};

const Num: React.FC<{ v: number; cls?: string; onClick: () => void }> = ({ v, cls = 'text-slate-700 dark:text-slate-200', onClick }) => (
  <td className="px-4 py-3 text-right">
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={!v}
      className={`min-w-8 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-600 ${v ? cls : 'text-slate-300 dark:text-slate-600'}`}>{v}</button>
  </td>
);

interface BarRow { key: string; label: string; n: number; max: number; cls: string; onClick?: () => void }
const BarCard: React.FC<{ title: string; rows: BarRow[]; empty?: string }> = ({ title, rows, empty }) => (
  <Card className="p-5">
    <h4 className="font-bold text-slate-800 dark:text-white mb-4">{title}</h4>
    {rows.length === 0 ? <p className="text-sm text-slate-400">{empty}</p> : (
      <div className="space-y-2.5">
        {rows.map((r) => (
          <button key={r.key} onClick={r.onClick} disabled={!r.onClick || !r.n}
            className="w-full grid grid-cols-[120px_1fr_28px] items-center gap-2 text-sm text-left disabled:cursor-default group">
            <span className="text-slate-600 dark:text-slate-300 truncate group-enabled:group-hover:text-masri-primary">{r.label}</span>
            <span className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <span className={`block h-full rounded-full ${r.cls}`} style={{ width: `${(r.n / r.max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold text-slate-700 dark:text-slate-200">{r.n}</span>
          </button>
        ))}
      </div>
    )}
  </Card>
);
