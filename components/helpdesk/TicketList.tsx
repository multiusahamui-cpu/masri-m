import React, { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { BranchOption, HdCategory, HdTicketRow } from '../../types';
import { Card, ErrorBox, Spinner, formatDateTime, inputCls, btnSecondary } from '../superadmin/ui';
import { CATEGORY_LABEL, timeLeft } from './labels';
import { HdPriorityText, HdStatusBadge } from './HdBadges';

export interface TicketFilter {
  status?: string;
  branchId?: string;
  category?: HdCategory | '';
  search?: string;
}

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Terlambat SLA' },
  { value: 'open', label: 'Baru' },
  { value: 'in_progress', label: 'Ditangani Pusat' },
  { value: 'escalated', label: 'Eskalasi Cabang' },
  { value: 'branch_done', label: 'Selesai Cabang' },
  { value: 'resolved', label: 'Selesai' },
  { value: 'closed', label: 'Ditutup' },
  { value: '', label: 'Semua' },
];

interface Props {
  filter: TicketFilter;
  onFilterChange: (f: TicketFilter) => void;
  onOpen: (id: string) => void;
  branches?: BranchOption[]; // tampilkan filter cabang bila diisi
  refreshKey?: number;
  hideStatuses?: string[];
}

const PAGE_SIZE = 15;

export const TicketList: React.FC<Props> = ({ filter, onFilterChange, onOpen, branches, refreshKey = 0, hideStatuses = [] }) => {
  const [rows, setRows] = useState<HdTicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ tickets: HdTicketRow[]; total: number }>(`/helpdesk/tickets${qs({
        status: filter.status, branchId: filter.branchId, category: filter.category || undefined, search: filter.search, page, pageSize: PAGE_SIZE,
      })}`);
      setRows(r.tickets);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, refreshKey]);

  const set = (patch: Partial<TicketFilter>) => onFilterChange({ ...filter, ...patch });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.filter((c) => !hideStatuses.includes(c.value)).map((c) => (
            <button key={c.value || 'all'} onClick={() => set({ status: c.value || undefined })}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${(filter.status ?? '') === c.value
                ? 'bg-masri-primary text-white border-masri-primary'
                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-masri-primary'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className={`grid grid-cols-1 ${branches ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder="Cari no. tiket, judul, nama/telepon nasabah, no. order..."
              value={filter.search ?? ''} onChange={(e) => set({ search: e.target.value || undefined })} />
          </div>
          {branches && (
            <select className={inputCls} value={filter.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}>
              <option value="">Semua cabang</option>
              {branches.filter((b) => b.type === 'branch').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="none">Belum ditentukan cabang</option>
            </select>
          )}
          <select className={inputCls} value={filter.category ?? ''} onChange={(e) => set({ category: (e.target.value || '') as HdCategory | '' })}>
            <option value="">Semua kategori</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Card>

      <ErrorBox message={error} onClose={() => setError(null)} />

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Tiket</th>
                  <th className="text-left px-4 py-3">Nasabah</th>
                  <th className="text-left px-4 py-3">Cabang</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((t) => {
                  const done = t.status === 'resolved' || t.status === 'closed';
                  const sla = timeLeft(t.dueAt, done);
                  return (
                    <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{t.ticketNo}</span>
                          <HdPriorityText priority={t.priority} />
                        </div>
                        <p className="font-semibold text-slate-800 dark:text-white">{t.subject}</p>
                        <p className="text-xs text-slate-500">{CATEGORY_LABEL[t.category]} · {formatDateTime(t.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        {t.customerName ? (
                          <>
                            <p className="text-slate-800 dark:text-slate-200">{t.customerName}</p>
                            <p className="text-xs text-slate-500">{t.customerPhone} · {t.customerNo}</p>
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{t.branchName ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-3"><HdStatusBadge status={t.status} /></td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold flex items-center gap-1 ${sla.overdue ? 'text-red-600' : 'text-slate-500'}`}>
                          {sla.overdue && <AlertCircle className="w-3.5 h-3.5" />}{sla.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !loading && <tr><td colSpan={5} className="text-center py-12 text-slate-500">Tidak ada tiket sesuai filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
          <span>{total} tiket</span>
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
