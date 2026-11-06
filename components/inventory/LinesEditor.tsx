import React, { useEffect, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { ProductRow } from '../../types';
import { inputCls } from '../superadmin/ui';

export interface Line { productId: string; sku: string; name: string; qty: number; extra?: number }

/** Cari produk aktif & tambahkan ke daftar baris (dipakai penerimaan, transfer, opname). */
export const ProductPicker: React.FC<{ onPick: (p: ProductRow) => void; exclude: string[] }> = ({ onPick, exclude }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<{ products: ProductRow[] }>(`/products${qs({ search, status: 'active', pageSize: 10 })}`)
        .then((r) => setResults(r.products.filter((p) => !exclude.includes(p.id)))).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, exclude]);
  return (
    <div className="relative">
      <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
      <input className={`${inputCls} pl-9`} placeholder="Cari produk (nama / SKU) untuk ditambahkan..." value={search} onChange={(e) => setSearch(e.target.value)} />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onPick(p); setSearch(''); setResults([]); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex justify-between gap-2">
                <span><span className="font-mono text-xs text-slate-400">{p.sku}</span> <span className="text-slate-800 dark:text-white">{p.name}</span></span>
                <span className="text-xs text-slate-500 whitespace-nowrap">total tersedia {p.totalAvailable}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const LinesEditor: React.FC<{ lines: Line[]; onChange: (l: Line[]) => void; qtyLabel?: string; min?: number; extraLabel?: string }> = ({ lines, onChange, qtyLabel = 'Jumlah', min = 1, extraLabel }) => (
  <div className="space-y-2">
    <ProductPicker exclude={lines.map((l) => l.productId)} onPick={(p) => onChange([...lines, { productId: p.id, sku: p.sku, name: p.name, qty: Math.max(min, 1) }])} />
    {lines.length > 0 && (
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr><th className="text-left py-1">Produk</th>{extraLabel && <th className="text-right py-1">{extraLabel}</th>}<th className="text-right py-1 w-28">{qtyLabel}</th><th className="w-8" /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {lines.map((l, i) => (
            <tr key={l.productId}>
              <td className="py-2"><span className="font-mono text-xs text-slate-400">{l.sku}</span> <span className="text-slate-800 dark:text-slate-200">{l.name}</span></td>
              {extraLabel && <td className="py-2 text-right text-slate-500">{l.extra ?? '—'}</td>}
              <td className="py-2"><input type="number" min={min} className={`${inputCls} text-right`} value={l.qty}
                onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(min, parseInt(e.target.value || '0', 10)) } : x)))} /></td>
              <td className="py-2 text-right"><button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" aria-label="Hapus"><Trash2 className="w-4 h-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);
