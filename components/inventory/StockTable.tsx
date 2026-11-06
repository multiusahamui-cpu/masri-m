import React, { useCallback, useEffect, useState } from 'react';
import { Search, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { StockRow } from '../../types';
import { Card, ErrorBox, Spinner, inputCls, btnSecondary } from '../superadmin/ui';
import { StockCardModal } from './StockCardModal';

const PAGE = 50;

/** Tabel posisi stok satu lokasi. canEditMin: boleh ubah batas stok menipis. */
export const StockTable: React.FC<{ branchId: string; canEditMin?: boolean; refreshKey?: number }> = ({ branchId, canEditMin, refreshKey = 0 }) => {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<StockRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ stock: StockRow[]; total: number }>(`/inventory/stock${qs({ branchId, search, lowOnly: lowOnly ? 'true' : undefined, page, pageSize: PAGE })}`);
      setRows(r.stock); setTotal(r.total); setError(null);
    } catch (e) { setError((e as ApiError).message); } finally { setLoading(false); }
  }, [branchId, search, lowOnly, page]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [branchId, search, lowOnly]);

  const saveMin = async (r: StockRow, v: number) => {
    if (v === r.minStock || Number.isNaN(v)) return;
    try { await api.put('/inventory/min-stock', { productId: r.productId, branchId, minStock: v }); load(); }
    catch (e) { setError((e as ApiError).message); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="space-y-3">
      <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Cari nama / SKU / merek..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Hanya stok menipis
        </label>
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Produk</th>
                  <th className="text-right px-4 py-3">Fisik</th>
                  <th className="text-right px-4 py-3">Dipesan</th>
                  <th className="text-right px-4 py-3">Tersedia</th>
                  <th className="text-right px-4 py-3">Batas Menipis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((r) => (
                  <tr key={r.productId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3 cursor-pointer" onClick={() => setCard(r)}>
                      <p className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        {r.name}{r.isLow && <span title="Stok menipis"><AlertTriangle className="w-4 h-4 text-amber-500" /></span>}
                      </p>
                      <p className="text-xs text-slate-500"><span className="font-mono">{r.sku}</span> · {r.brand} · {r.categoryName}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">{r.onHand}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{r.reserved}</td>
                    <td className={`px-4 py-3 text-right font-bold ${r.isLow ? 'text-amber-600' : r.available > 0 ? 'text-masri-primary' : 'text-slate-400'}`}>{r.available}</td>
                    <td className="px-4 py-3 text-right">
                      {canEditMin ? (
                        <input type="number" min={0} defaultValue={r.minStock} key={`${r.productId}-${r.minStock}`}
                          onBlur={(e) => saveMin(r, parseInt(e.target.value, 10))}
                          className="w-20 px-2 py-1 text-right border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 dark:text-white" />
                      ) : <span className="text-slate-500">{r.minStock}</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && <tr><td colSpan={5} className="text-center py-10 text-slate-500">Tidak ada data.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
          <span>{total} produk · klik nama produk untuk kartu stok</span>
          <div className="flex items-center gap-2">
            <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
            <span>Hal. {page} / {totalPages}</span>
            <button className={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </Card>
      {card && <StockCardModal productId={card.productId} title={`${card.sku} — ${card.name}`} onClose={() => setCard(null)} />}
    </div>
  );
};
