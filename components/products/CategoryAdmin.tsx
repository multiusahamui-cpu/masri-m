import React, { useCallback, useEffect, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { ProductCategory } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, inputCls, btnPrimary } from '../superadmin/ui';

/** Kategori produk, dikelompokkan Elektronik / Furniture. */
export const CategoryAdmin: React.FC = () => {
  const [rows, setRows] = useState<ProductCategory[] | null>(null);
  const [form, setForm] = useState({ code: '', name: '', group: 'electronics' as 'electronics' | 'furniture' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.get<{ categories: ProductCategory[] }>('/product-categories').then((r) => setRows(r.categories)).catch((e) => setError((e as ApiError).message)); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setError(null);
    try { await api.post('/product-categories', { ...form, sortOrder: rows?.length ?? 0 }); setForm({ ...form, code: '', name: '' }); load(); }
    catch (e) { setError((e as ApiError).message); }
  };
  const toggle = async (c: ProductCategory) => {
    try { await api.patch(`/product-categories/${c.id}`, { isActive: !c.isActive }); load(); } catch (e) { setError((e as ApiError).message); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Layers className="w-6 h-6" />} title="Kategori Produk" subtitle="Kategori yang dinonaktifkan tidak tampil di katalog nasabah." />
      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input className={`${inputCls} uppercase`} placeholder="Kode (mis. KIPAS)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input className={inputCls} placeholder="Nama kategori" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className={inputCls} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value as 'electronics' | 'furniture' })}>
          <option value="electronics">Elektronik</option><option value="furniture">Furniture</option>
        </select>
        <button className={`${btnPrimary} justify-center`} disabled={!form.code || !form.name} onClick={add}><Plus className="w-4 h-4" /> Tambah</button>
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!rows ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['electronics', 'furniture'] as const).map((g) => (
            <Card key={g} className="overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">{g === 'electronics' ? 'Elektronik' : 'Furniture'}</div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.filter((c) => c.group === g).map((c) => (
                  <li key={c.id} className={`px-5 py-3 flex items-center justify-between ${c.isActive ? '' : 'opacity-50'}`}>
                    <div><p className="font-semibold text-slate-800 dark:text-white">{c.name}</p><p className="text-xs text-slate-500"><span className="font-mono">{c.code}</span> · {c.productCount ?? 0} produk</p></div>
                    <button onClick={() => toggle(c)} className="text-xs text-masri-primary hover:underline">{c.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
