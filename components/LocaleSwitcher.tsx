import React, { useEffect, useRef, useState } from 'react';
import { Globe, Check } from 'lucide-react';
import { COUNTRIES, LANGS, locale, useLocale, type Country } from '../lib/i18n';
import { cart } from '../lib/cart';

/** Pilih negara layanan (mata uang & katalog) dan bahasa. */
export const LocaleSwitcher: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { lang, country, info, t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, []);
  const pickCountry = (c: Country) => {
    if (c === country) { setOpen(false); return; }
    // Harga & stok berbeda per negara: keranjang dikosongkan
    if (cart.get().length && !window.confirm(t('locale.cartReset'))) return;
    cart.clear();
    locale.setCountry(c);
    setOpen(false);
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-label={t('locale.title')} title={t('locale.title')}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/20 hover:bg-black/30 border border-white/10 text-sm font-semibold">
        <span aria-hidden>{info.flag}</span>{!compact && <span>{lang.toUpperCase()}</span>}<Globe className="w-4 h-4 opacity-80" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl border border-slate-200 dark:border-slate-700 p-2 z-50">
          <p className="px-2 pt-1 pb-1 text-[11px] font-bold uppercase text-slate-500">{t('locale.country')}</p>
          {COUNTRIES.map((c) => (
            <button key={c.code} onClick={() => pickCountry(c.code)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-slate-700">
              <span>{c.flag}</span><span className="flex-1 text-left">{c.name}</span><span className="text-xs text-slate-400">{c.currency}</span>{country === c.code && <Check className="w-4 h-4 text-masri-primary" />}
            </button>
          ))}
          <p className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-slate-500 border-t border-slate-100 dark:border-slate-700 mt-1">{t('locale.language')}</p>
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => { locale.setLang(l.code); setOpen(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-slate-700">
              <span className="w-6 text-xs font-bold text-slate-400">{l.short}</span><span className="flex-1 text-left">{l.label}</span>{lang === l.code && <Check className="w-4 h-4 text-masri-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
