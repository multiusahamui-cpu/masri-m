import React, { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Search, Pencil, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Country, ProductCategory, ProductFull, ProductRow, ProductStatus, StockLocation } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, Modal, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

const STATUS: Record<ProductStatus, { label: string; cls: string }> = {
  active: { label: 'Aktif', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  draft: { label: 'Draft', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  inactive: { label: 'Nonaktif', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};
const PAGE = 20;

/** Master produk & harga (System Admin). */
export const ProductAdmin: React.FC = () => {
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ products: ProductRow[]; total: number }>(`/products${qs({ search, categoryId, status, page, pageSize: PAGE })}`)
      .then((r) => { setRows(r.products); setTotal(r.total); setError(null); }).catch((e) => setError((e as ApiError).message));
  }, [search, categoryId, status, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [search, categoryId, status]);
  useEffect(() => { api.get<{ categories: ProductCategory[] }>('/product-categories').then((r) => setCats(r.categories)).catch(() => undefined); }, []);
  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Package className="w-6 h-6" />} title="Produk" subtitle="Master produk elektronik & furniture: SKU, spesifikasi, dimensi (untuk ongkir), garansi, dan harga tunai per negara. Harga cicilan dihitung otomatis dari margin Murabahah."
        actions={<button className={btnPrimary} onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Produk Baru</button>} />
      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Cari nama / SKU / merek..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Semua kategori</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr><th className="text-left px-4 py-3">Produk</th><th className="text-left px-4 py-3">Kategori</th><th className="text-right px-4 py-3">Harga Tunai (ID)</th>
                  <th className="text-right px-4 py-3">Stok Tersedia</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden flex items-center justify-center flex-shrink-0">
                          {p.images[0] ? <img src={p.images[0]} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" /> : <ImageOff className="w-5 h-5 text-slate-400" />}
                        </div>
                        <div><p className="font-semibold text-slate-800 dark:text-white">{p.name}</p><p className="text-xs text-slate-500"><span className="font-mono">{p.sku}</span> · {p.brand}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{p.categoryName}<span className="block text-[11px] text-slate-400">{p.categoryGroup === 'electronics' ? 'Elektronik' : 'Furniture'}</span></td>
                    <td className="px-4 py-3 text-right text-slate-800 dark:text-slate-200">{formatMoney(p.cashPrice)}</td>
                    <td className="px-4 py-3 text-right"><span className={p.totalAvailable > 0 ? 'text-masri-primary font-semibold' : 'text-slate-400'}>{p.totalAvailable}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span></td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setEditing(p.id)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300" title="Ubah"><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Belum ada produk.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
          <span>{total} produk</span>
          <div className="flex items-center gap-2">
            <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
            <span>Hal. {page} / {totalPages}</span>
            <button className={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </Card>
      {editing && <ProductForm id={editing === 'new' ? null : editing} categories={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

const empty = {
  sku: '', name: '', brand: '', categoryId: '', description: '', specs: [] as string[], images: [] as string[],
  weightKg: 0, lengthCm: 0, widthCm: 0, heightCm: 0, isBulky: false, requiresInstallation: false, warrantyMonths: 12, status: 'draft' as ProductStatus,
};

const ProductForm: React.FC<{ id: string | null; categories: ProductCategory[]; onClose: () => void; onSaved: () => void }> = ({ id, categories, onClose, onSaved }) => {
  const [form, setForm] = useState({ ...empty });
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [countries, setCountries] = useState<Country[]>([]);
  const [stock, setStock] = useState<StockLocation[]>([]);
  const [specText, setSpecText] = useState('');
  const [imgText, setImgText] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ countries: Country[] }>('/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
    if (!id) return;
    api.get<{ product: ProductFull; prices: { countryCode: string; cashPrice: number }[]; stock: StockLocation[] }>(`/products/${id}`)
      .then((r) => {
        const { id: _i, ...p } = r.product;
        setForm({ ...empty, ...p });
        setSpecText(r.product.specs.join('\n'));
        setImgText(r.product.images.join('\n'));
        setPrices(Object.fromEntries(r.prices.map((x) => [x.countryCode, String(x.cashPrice)])));
        setStock(r.stock);
      }).catch((e) => setError((e as ApiError).message)).finally(() => setLoading(false));
  }, [id]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: 'weightKg' | 'lengthCm' | 'widthCm' | 'heightCm' | 'warrantyMonths') => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value || 0));

  const submit = async () => {
    setSaving(true); setError(null);
    const specs = specText.split('\n').map((s) => s.trim()).filter(Boolean);
    const images = imgText.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      let pid = id;
      const { sku, ...rest } = form;
      if (id) {
        // Simpan harga dulu agar aktivasi lolos validasi harga
        for (const [c, v] of Object.entries(prices)) if (v && Number(v) > 0) await api.put(`/products/${id}/prices/${c}`, { cashPrice: Number(v) });
        await api.patch(`/products/${id}`, { ...rest, specs, images });
      } else {
        const r = await api.post<{ product: { id: string } }>('/products', { ...form, specs, images, cashPriceID: prices.ID ? Number(prices.ID) : undefined });
        pid = r.product.id;
        for (const [c, v] of Object.entries(prices)) if (c !== 'ID' && v && Number(v) > 0) await api.put(`/products/${pid}/prices/${c}`, { cashPrice: Number(v) });
      }
      void sku;
      onSaved();
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  };

  return (
    <Modal title={id ? `Ubah Produk ${form.sku}` : 'Produk Baru'} onClose={onClose} wide="xl">
      {loading ? <Spinner /> : (
        <div className="space-y-4">
          <ErrorBox message={error} onClose={() => setError(null)} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><label className={labelCls}>SKU</label><input className={`${inputCls} uppercase`} value={form.sku} disabled={!!id} onChange={(e) => set('sku', e.target.value)} placeholder="TV-SAM-55CU" /></div>
            <div className="md:col-span-2"><label className={labelCls}>Nama produk</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>Merek</label><input className={inputCls} value={form.brand} onChange={(e) => set('brand', e.target.value)} /></div>
            <div><label className={labelCls}>Kategori</label>
              <select className={inputCls} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">— pilih —</option>
                {(['electronics', 'furniture'] as const).map((g) => (
                  <optgroup key={g} label={g === 'electronics' ? 'Elektronik' : 'Furniture'}>
                    {categories.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select></div>
            <div><label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as ProductStatus)}>
                <option value="draft">Draft</option><option value="active">Aktif (tampil di katalog)</option><option value="inactive">Nonaktif</option>
              </select></div>
            <div><label className={labelCls}>Garansi (bulan)</label><input type="number" className={inputCls} value={form.warrantyMonths} onChange={num('warrantyMonths')} /></div>
            <div className="flex flex-col justify-end gap-1 text-sm text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.isBulky} onChange={(e) => set('isBulky', e.target.checked)} /> Barang besar (kargo)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresInstallation} onChange={(e) => set('requiresInstallation', e.target.checked)} /> Perlu pemasangan/rakit</label>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={labelCls}>Berat (kg)</label><input type="number" step="0.1" className={inputCls} value={form.weightKg} onChange={num('weightKg')} /></div>
            <div><label className={labelCls}>Panjang (cm)</label><input type="number" className={inputCls} value={form.lengthCm} onChange={num('lengthCm')} /></div>
            <div><label className={labelCls}>Lebar (cm)</label><input type="number" className={inputCls} value={form.widthCm} onChange={num('widthCm')} /></div>
            <div><label className={labelCls}>Tinggi (cm)</label><input type="number" className={inputCls} value={form.heightCm} onChange={num('heightCm')} /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {countries.map((c) => (
              <div key={c.code}><label className={labelCls}>Harga tunai {c.name} ({c.currency}){c.code === 'ID' && ' *'}</label>
                <input type="number" min={0} className={inputCls} value={prices[c.code] ?? ''} onChange={(e) => setPrices({ ...prices, [c.code]: e.target.value })} />
                {c.code === 'ID' && prices.ID && <p className="text-xs text-slate-500 mt-1">{formatMoney(Number(prices.ID))}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className={labelCls}>Spesifikasi (satu per baris)</label><textarea className={`${inputCls} h-28`} value={specText} onChange={(e) => setSpecText(e.target.value)} /></div>
            <div><label className={labelCls}>URL gambar (satu per baris)</label><textarea className={`${inputCls} h-28 font-mono text-xs`} value={imgText} onChange={(e) => setImgText(e.target.value)} placeholder="https://..." /></div>
          </div>
          <div><label className={labelCls}>Deskripsi</label><textarea className={`${inputCls} h-20`} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>

          {stock.length > 0 && (
            <div className="text-xs text-slate-500">Stok: {stock.map((s) => `${s.branchCode} ${s.onHand - s.reserved}`).join(' · ')}</div>
          )}

          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={onClose}>Batal</button>
            <button className={btnPrimary} disabled={saving} onClick={submit}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
};
