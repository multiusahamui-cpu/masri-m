import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { cart } from '../lib/cart';
import { useLocale } from '../lib/i18n';

type L3 = Partial<Record<'id' | 'ms' | 'en', string>>;
export interface PublicBanner { id: string; title: L3; subtitle: L3; imageUrl: string | null; theme: string; linkType: string; linkValue: string | null }

export const BANNER_THEME: Record<string, string> = {
  emerald: 'from-emerald-700 to-emerald-500 text-white', gold: 'from-amber-500 to-yellow-400 text-slate-900', dark: 'from-slate-900 to-slate-700 text-white',
};

/** Tampilan satu banner (dipakai beranda & pratinjau di modul Marketing). */
export const BannerPreview: React.FC<{ b: Pick<PublicBanner, 'title' | 'subtitle' | 'imageUrl' | 'theme'>; lang?: 'id' | 'ms' | 'en'; cta?: React.ReactNode }> = ({ b, lang = 'id', cta }) => {
  const t = b.title[lang] || b.title.id || b.title.en || b.title.ms || '';
  const s = b.subtitle[lang] || b.subtitle.id || b.subtitle.en || b.subtitle.ms || '';
  return (
    <div className={`relative bg-gradient-to-r ${BANNER_THEME[b.theme] ?? BANNER_THEME.emerald} p-6 md:p-8 min-h-[140px] flex items-center overflow-hidden`}>
      {b.imageUrl && <img src={b.imageUrl} alt="" className="absolute right-0 top-0 h-full w-1/3 object-cover opacity-90" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <div className={`relative ${b.imageUrl ? 'max-w-[62%]' : ''}`}>
        <p className="text-xl md:text-3xl font-extrabold leading-tight">{t}</p>
        {s && <p className="text-sm md:text-base mt-1 opacity-90">{s}</p>}
        {cta}
      </div>
    </div>
  );
};

/** Banner promosi beranda (diatur role Marketing). Tidak tampil bila tidak ada banner aktif. */
export const HomeBanners: React.FC = () => {
  const { t, country, lang } = useLocale();
  const [items, setItems] = useState<PublicBanner[]>([]);
  const [i, setI] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { api.get<{ banners: PublicBanner[] }>(`/public/banners?country=${country}`).then((r) => { setItems(r.banners); setI(0); }).catch(() => setItems([])); }, [country]);
  useEffect(() => { if (items.length < 2) return; const h = setInterval(() => setI((k) => (k + 1) % items.length), 7000); return () => clearInterval(h); }, [items.length]);
  if (!items.length) return null;
  const b = items[i % items.length];
  const go = () => {
    const toCatalog = () => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
    if (b.linkType === 'promo' && b.linkValue) { cart.setPendingPromo(b.linkValue); setToast(t('banner.promoSaved', { code: b.linkValue })); setTimeout(() => setToast(null), 4000); toCatalog(); }
    else if (b.linkType === 'product' && b.linkValue) window.dispatchEvent(new CustomEvent('masri:open-product', { detail: b.linkValue }));
    else if (b.linkType === 'category') toCatalog();
    else if (b.linkType === 'url' && b.linkValue) { if (b.linkValue.startsWith('#')) document.getElementById(b.linkValue.slice(1))?.scrollIntoView({ behavior: 'smooth' }); else if (/^https:\/\//.test(b.linkValue)) window.open(b.linkValue, '_blank', 'noopener'); }
  };
  const cta = b.linkType !== 'none' && (
    <button onClick={go} className="mt-4 px-5 py-2 rounded-full bg-white/95 text-slate-900 text-sm font-bold hover:bg-white shadow">
      {b.linkType === 'promo' && b.linkValue ? t('banner.ctaPromo', { code: b.linkValue }) : t('banner.cta')}
    </button>
  );
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="relative rounded-2xl overflow-hidden shadow-lg">
        <BannerPreview b={b} lang={lang as 'id'} cta={cta} />
        {items.length > 1 && <>
          <button aria-label="Sebelumnya" onClick={() => setI((k) => (k - 1 + items.length) % items.length)} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/20 text-white hover:bg-black/40"><ChevronLeft className="w-5 h-5" /></button>
          <button aria-label="Berikutnya" onClick={() => setI((k) => (k + 1) % items.length)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/20 text-white hover:bg-black/40"><ChevronRight className="w-5 h-5" /></button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">{items.map((x, k) => <span key={x.id} className={`w-2 h-2 rounded-full ${k === i ? 'bg-white' : 'bg-white/40'}`} />)}</div>
        </>}
      </div>
      {toast && <p className="mt-2 text-sm text-center text-green-700 dark:text-green-400">{toast}</p>}
    </section>
  );
};
