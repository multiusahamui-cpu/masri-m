import React, { useEffect, useState } from 'react';
import { Search, ImageOff } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { CatalogProduct } from '../../types';
import { inputCls } from '../superadmin/ui';
import { useLocale } from '../../lib/i18n';

interface Cat { id: string; code: string; name: string; group: 'electronics' | 'furniture' }

/** Grid katalog dari API publik. Dipakai halaman depan (limit) dan Toko nasabah (dengan filter). */
export const CatalogGrid: React.FC<{ onOpen: (id: string) => void; limit?: number; withFilters?: boolean; onLoaded?: (ok: boolean) => void }> = ({ onOpen, limit = 24, withFilters, onLoaded }) => {
  const [items, setItems] = useState<CatalogProduct[] | null>(null);
  const [currency, setCurrency] = useState({ currency: 'IDR', locale: 'id-ID' });
  const [cats, setCats] = useState<Cat[]>([]);
  const [group, setGroup] = useState<'' | 'electronics' | 'furniture'>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const { t, country, money: fmtMoney } = useLocale();

  useEffect(() => { if (withFilters) api.get<{ categories: Cat[] }>('/catalog/categories').then((r) => setCats(r.categories)).catch(() => undefined); }, [withFilters]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get<{ products: CatalogProduct[]; country: { currency: string; locale: string } }>(`/catalog/products${qs({ country, group, category, search, pageSize: limit })}`)
        .then((r) => { setItems(r.products); setCurrency(r.country); onLoaded?.(true); })
        .catch(() => { setItems([]); onLoaded?.(false); });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, category, search, limit, country]);

  const money = (v: number) => fmtMoney(v, currency.currency);
  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition-colors ${active ? 'bg-masri-primary text-white border-masri-primary font-semibold' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-masri-primary'}`;

  return (
    <div className="space-y-5">
      {withFilters && (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} placeholder={t('catalog.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className={chip(group === '')} onClick={() => { setGroup(''); setCategory(''); }}>{t('catalog.all')}</button>
              <button className={chip(group === 'electronics')} onClick={() => { setGroup('electronics'); setCategory(''); }}>{t('catalog.electronics')}</button>
              <button className={chip(group === 'furniture')} onClick={() => { setGroup('furniture'); setCategory(''); }}>{t('catalog.furniture')}</button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {cats.filter((c) => !group || c.group === group).map((c) => (
              <button key={c.id} className={chip(category === c.code)} onClick={() => setCategory(category === c.code ? '' : c.code)}>{c.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {(items ?? []).map((p) => (
          <button key={p.id} onClick={() => onOpen(p.id)} className="text-left bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 group">
            <div className="relative h-48 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              {p.images[0] ? <img src={p.images[0]} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : <ImageOff className="w-8 h-8 text-slate-400" />}
              <span className="absolute top-2 right-2 bg-masri-gold text-white text-xs font-bold px-2 py-1 rounded">{p.categoryName}</span>
              {!p.inStock && <span className="absolute top-2 left-2 bg-slate-800/80 text-white text-xs font-bold px-2 py-1 rounded">{t('catalog.preorder')}</span>}
              {p.featured && <span className={`absolute bottom-2 left-2 text-xs font-bold px-2 py-1 rounded shadow ${p.featured === 'promo' ? 'bg-red-600 text-white' : p.featured === 'new' ? 'bg-blue-600 text-white' : 'bg-masri-primary text-white'}`}>{t(`shop.badge.${p.featured}`)}</span>}
            </div>
            <div className="p-5">
              <p className="text-xs text-slate-500">{p.brand}</p>
              <h3 className="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 min-h-[3rem]">{p.name}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t('catalog.cash')} <strong>{money(p.cashPrice)}</strong></p>
              {p.installmentFrom && (
                <div className="mt-2 bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-100 dark:border-green-800/50">
                  <p className="text-xs text-masri-primary dark:text-green-400 font-semibold">{t('catalog.from')}</p>
                  <p className="text-lg font-bold text-masri-dark dark:text-white">{money(p.installmentFrom.monthly)}<span className="text-xs font-normal text-slate-500"> {t('catalog.perMonth')} × {p.installmentFrom.tenor}</span></p>
                </div>
              )}
            </div>
          </button>
        ))}
        {items && items.length === 0 && <p className="col-span-full text-center text-slate-500 py-10">{t('catalog.empty')}</p>}
      </div>
    </div>
  );
};
