// Multi-bahasa (Indonesia, Melayu, Inggris) & negara layanan untuk halaman nasabah.
import { useEffect, useState } from 'react';
import { DICT } from './i18n-dict';

export type Lang = 'id' | 'ms' | 'en';
export type Country = 'ID' | 'MY' | 'BN';
export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID' }, { code: 'ms', label: 'Bahasa Melayu', short: 'MS' }, { code: 'en', label: 'English', short: 'EN' },
];
export const COUNTRIES: { code: Country; name: string; flag: string; currency: string; dial: string; lang: Lang; locale: string; phoneHint: string; postalHint: string }[] = [
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR', dial: '+62', lang: 'id', locale: 'id-ID', phoneHint: '0812xxxxxxx', postalHint: '40111' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR', dial: '+60', lang: 'ms', locale: 'ms-MY', phoneHint: '012-345 6789', postalHint: '50450' },
  { code: 'BN', name: 'Brunei', flag: '🇧🇳', currency: 'BND', dial: '+673', lang: 'ms', locale: 'ms-BN', phoneHint: '712 3456', postalHint: 'BS8811' },
];
export const countryInfo = (c: Country) => COUNTRIES.find((x) => x.code === c) ?? COUNTRIES[0];

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* mode privat */ } };

function initial(): { lang: Lang; country: Country } {
  const c = read('masri.country') as Country | null;
  const country: Country = c && COUNTRIES.some((x) => x.code === c) ? c : 'ID';
  const l = read('masri.lang') as Lang | null;
  if (l && LANGS.some((x) => x.code === l)) return { lang: l, country };
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'id').toLowerCase();
  const lang: Lang = nav.startsWith('ms') ? 'ms' : nav.startsWith('en') && country !== 'ID' ? 'en' : countryInfo(country).lang;
  return { lang, country };
}

let state = initial();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
if (typeof document !== 'undefined') document.documentElement.lang = state.lang;

export const locale = {
  get: () => state,
  setLang(lang: Lang) { state = { ...state, lang }; write('masri.lang', lang); document.documentElement.lang = lang; emit(); },
  /** Ganti negara: mata uang & katalog ikut berubah; bahasa ikut negara kecuali pengguna sudah memilih sendiri. */
  setCountry(country: Country) {
    const chosen = read('masri.lang');
    state = { country, lang: chosen ? state.lang : countryInfo(country).lang };
    write('masri.country', country); document.documentElement.lang = state.lang; emit();
  },
};

export function translate(lang: Lang, key: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICT[lang]?.[key] ?? DICT.id[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v == null ? '' : String(v));
  return s;
}
export const t = (key: string, vars?: Record<string, string | number | null | undefined>) => translate(state.lang, key, vars);

/** Hook bahasa & negara aktif; komponen dirender ulang saat berganti. */
export function useLocale() {
  const [, setTick] = useState(0);
  useEffect(() => { const f = () => setTick((x) => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const { lang, country } = state;
  const info = countryInfo(country);
  return {
    lang, country, info, currency: info.currency,
    t: (key: string, vars?: Record<string, string | number | null | undefined>) => translate(lang, key, vars),
    /** Format uang sesuai negara aktif (atau mata uang data). */
    money: (v: number | null | undefined, currency = info.currency) => v == null ? '—'
      : new Intl.NumberFormat(lang === 'en' ? 'en-MY' : info.locale, { style: 'currency', currency, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(v),
    date: (iso: string | null | undefined, withTime = false) => iso
      ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'ms' ? 'ms-MY' : 'id-ID', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso)) : '—',
  };
}
