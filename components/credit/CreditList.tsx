import React, { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Users2 } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { BranchOption, CreditRow } from '../../types';
import { Card, ErrorBox, Spinner, formatDateTime, inputCls, btnSecondary } from '../superadmin/ui';
import { CreditBadge } from './CreditBadge';

export interface CreditFilter { statuses?: string; branchId?: string; search?: string }

const PAGE = 20;

export const CreditList: React.FC<{
  filter: CreditFilter; onFilterChange: (f: CreditFilter) => void; chips: { label: string; statuses?: string }[];
  onOpen: (id: string) => void; branches?: BranchOption[]; refreshKey?: number; highlight?: (r: CreditRow) => boolean;
}> = ({ filter, onFilterChange, chips, onOpen, branches, refreshKey = 0, highlight }) => {
  const [rows, setRows] = useState<CreditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ applications: CreditRow[]; total: number }>(`/credit/applications${qs({ statuses: filter.statuses, branchId: filter.branchId, search: filter.search, page, pageSize: PAGE })}`)
      .then((r) => { setRows(r.applications); setTotal(r.total); setError(null); }).catch((e) => setError((e as ApiError).message));
  }, [filter, page]);
  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, refreshKey]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const set = (p: Partial<CreditFilter>) => onFilterChange({ ...filter, ...p });

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.label} onClick={() => set({ statuses: c.statuses })}
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${(filter.statuses ?? '') === (c.statuses ?? '') ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-masri-primary'}`}>{c.label}</button>
          ))}
        </div>
        <div className={`grid grid-cols-1 ${branches ? 'md:grid-cols-3' : ''} gap-3`}>
          <div className={`relative ${branches ? 'md:col-span-2' : ''}`}>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder="Cari no. pengajuan, nama / HP / NIK nasabah, produk..." value={filter.search ?? ''} onChange={(e) => set({ search: e.target.value || undefined })} />
          </div>
          {branches && (
            <select className={inputCls} value={filter.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}>
              <option value="">Semua cabang</option>
              {branches.filter((b) => b.type === 'branch').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr><th className="text-left px-4 py-3">Pengajuan</th><th className="text-left px-4 py-3">Nasabah</th><th className="text-left px-4 py-3">Produk</th>
                  <th className="text-right px-4 py-3">Nilai</th><th className="text-left px-4 py-3">Cabang / AO</th><th className="text-left px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => onOpen(r.id)} className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${highlight?.(r) ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-slate-600 dark:text-slate-300">{r.appNo}</span>
                      <span className="block text-[11px] text-slate-400">{r.channel === 'web' ? 'Web' : 'Cabang'} · {formatDateTime(r.createdAt)}</span></td>
                    <td className="px-4 py-3"><p className="text-slate-800 dark:text-white font-semibold">{r.customerName}</p><p className="text-xs text-slate-500">{r.customerPhone}</p></td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.productName}{r.qty > 1 ? ` × ${r.qty}` : ''}</td>
                    <td className="px-4 py-3 text-right">
                      {r.monthly ? <><p className="font-semibold text-slate-800 dark:text-white">{formatMoney(r.monthly, r.currency)}<span className="text-xs font-normal text-slate-500">/bln × {r.tenor}</span></p>
                        <p className="text-[11px] text-slate-400">pokok {formatMoney(r.financed, r.currency)}</p></>
                        : <><p className="text-slate-700 dark:text-slate-200">{formatMoney(r.cashPrice, r.currency)}</p><p className="text-[11px] text-slate-400">diminta {r.requestedTenor} bln</p></>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{r.branchName}<span className="block text-slate-400">{r.aoName ?? 'AO belum ditugaskan'}</span></td>
                    <td className="px-4 py-3"><div className="flex flex-col gap-1 items-start"><CreditBadge status={r.status} />
                      {r.requiresCommittee && ['hq_review'].includes(r.status) && <span className="text-[11px] text-orange-600 flex items-center gap-1"><Users2 className="w-3 h-3" />Komite</span>}
                      {r.aoRecommendation && r.status === 'branch_review' && <span className={`text-[11px] ${r.aoRecommendation === 'approve' ? 'text-green-600' : 'text-red-600'}`}>AO: {r.aoRecommendation === 'approve' ? 'layak' : 'tidak layak'}</span>}
                    </div></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Tidak ada pengajuan.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
          <span>{total} pengajuan</span>
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
