import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { inputCls } from '../superadmin/ui';

/** Komponen kecil yang dipakai modul Kelompok 2 (hutang pemasok, rekonsiliasi bank, karantina, iqalah, marketing). */
export const CUR: Record<string, string> = { ID: 'IDR', MY: 'MYR', BN: 'BND' };
export const COUNTRIES: [string, string][] = [['ID', 'Indonesia'], ['MY', 'Malaysia'], ['BN', 'Brunei']];
export const money = (v: number | null | undefined, country = 'ID') => formatMoney(v, CUR[country] ?? 'IDR');
export const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export const errMsg = (e: unknown) => (e as ApiError)?.message ?? String(e);

export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setData(null);
    api.get<T>(path).then((d) => alive && setData(d)).catch((e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, setError, reload };
}

export const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button onClick={onClick} className={`px-3 py-1 rounded-full text-xs font-semibold border ${on ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{children}</button>
);

const TONE: Record<string, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  slate: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};
export const Pill: React.FC<{ map: Record<string, [string, keyof typeof TONE | string]>; s: string }> = ({ map, s }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONE[map[s]?.[1] ?? 'slate'] ?? TONE.slate}`}>{map[s]?.[0] ?? s}</span>
);

export const Flash: React.FC<{ msg: string | null; onClose?: () => void }> = ({ msg, onClose }) => msg ? (
  <div className="p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-900/20 dark:text-green-200 dark:border-green-800 flex justify-between gap-2">
    <span>{msg}</span>{onClose && <button onClick={onClose} className="text-xs opacity-70">tutup</button>}
  </div>
) : null;

export const CountrySelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <select className={`${inputCls.replace("w-full", "")} w-40`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Negara">
    {COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
  </select>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => <th className={`${right ? 'text-right' : 'text-left'} px-4 py-3 whitespace-nowrap`}>{children}</th>;
export const thead = 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase';
export const tbody = 'divide-y divide-slate-100 dark:divide-slate-700';
export const Empty: React.FC<{ children: React.ReactNode; cols: number }> = ({ children, cols }) => <tr><td colSpan={cols} className="px-4 py-10 text-center text-slate-500 text-sm">{children}</td></tr>;

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'red' | 'amber' | 'green' }> = ({ label, value, hint, tone }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
    <p className="text-xs text-slate-500 uppercase font-semibold">{label}</p>
    <p className={`text-lg font-bold mt-1 whitespace-nowrap ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-green-600' : 'text-slate-800 dark:text-white'}`}>{value}</p>
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
);

/** Input angka yang menerima format 1.250.000 / 1,250.50. */
export const num = (s: string) => { const t = s.replace(/\s/g, ''); if (!t) return NaN; const c = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); return Number(c.replace(/\.(?=\d{3}(\.|$))/g, '')); };
