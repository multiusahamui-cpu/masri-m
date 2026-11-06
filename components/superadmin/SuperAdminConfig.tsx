import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Save, RotateCcw, CheckCircle, Globe, Copy, Plus, Trash2, Eye } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { BusinessConfig, Country } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, formatDateTime, inputCls, btnPrimary, btnSecondary } from './ui';

const CATEGORY_LABEL: Record<BusinessConfig['category'], string> = {
  credit: 'Pembiayaan Murabahah',
  tax: 'Pajak',
  shipping: 'Pengiriman (Internal, Kurir Mitra, Ambil Sendiri)',
  stock: 'Stok & Distribusi Cabang',
  finance: 'Keuangan Cabang & Kasir',
  notify: 'Notifikasi Nasabah (WhatsApp & Email)',
  helpdesk: 'Helpdesk & Eskalasi',
  assistant: 'Asisten Virtual (Claude)',
  general: 'Umum',
};
const CATEGORY_ORDER: BusinessConfig['category'][] = ['credit', 'tax', 'shipping', 'stock', 'finance', 'notify', 'helpdesk', 'assistant', 'general'];

export const SuperAdminConfig: React.FC = () => {
  const [countries, setCountries] = useState<Country[]>([]);
  const [country, setCountry] = useState('ID');
  const [configs, setConfigs] = useState<BusinessConfig[]>([]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = countries.find((c) => c.code === country);

  const loadCountries = useCallback(() =>
    api.get<{ countries: Country[] }>('/admin/countries').then((r) => setCountries(r.countries)), []);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ configs: BusinessConfig[] }>(`/admin/config?country=${country}`);
      setConfigs(r.configs);
      setDrafts({});
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => { loadCountries().catch((e) => setError((e as ApiError).message)); }, [loadCountries]);
  useEffect(() => { loadConfigs(); setNotice(null); }, [loadConfigs]);

  const grouped = useMemo(() => CATEGORY_ORDER
    .map((cat) => ({ cat, items: configs.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length), [configs]);

  const isDirty = (key: string) => key in drafts;

  const save = async (cfg: BusinessConfig) => {
    setSavingKey(cfg.key);
    setError(null);
    try {
      const r = await api.put<{ config: BusinessConfig }>(`/admin/config/${encodeURIComponent(cfg.key)}`, { countryCode: country, value: drafts[cfg.key] });
      setConfigs((prev) => prev.map((c) => (c.key === cfg.key ? r.config : c)));
      setDrafts(({ [cfg.key]: _omit, ...rest }) => rest);
      setSavedKey(cfg.key);
      setTimeout(() => setSavedKey(null), 2000);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSavingKey(null);
    }
  };

  const copyFromID = async () => {
    if (!window.confirm(`Salin semua parameter dari Indonesia ke ${current?.name}? Parameter yang sudah ada tidak ditimpa.`)) return;
    try {
      const r = await api.post<{ copied: number; moneyReset: boolean; currency: string }>('/admin/config/copy', { from: 'ID', to: country });
      setNotice(r.moneyReset
        ? `${r.copied} parameter disalin. Semua nominal uang di-reset ke 0 karena mata uang berbeda — isi ulang dalam ${r.currency}, lalu tinjau margin & pajak sesuai regulasi setempat.`
        : `${r.copied} parameter disalin.`);
      loadConfigs();
    } catch (e) { setError((e as ApiError).message); }
  };

  const toggleCountry = async () => {
    if (!current) return;
    const next = !current.isActive;
    if (!window.confirm(next
      ? `Aktifkan layanan untuk ${current.name}? Pastikan seluruh parameter (margin, pajak, pengiriman) sudah sesuai regulasi setempat.`
      : `Nonaktifkan layanan untuk ${current.name}?`)) return;
    try {
      await api.patch(`/admin/countries/${country}`, { isActive: next });
      loadCountries();
    } catch (e) { setError((e as ApiError).message); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={<SlidersHorizontal className="w-6 h-6" />}
        title="Parameter Bisnis"
        subtitle="Atur margin Murabahah, uang muka, pajak, dan pengiriman per negara. Setiap perubahan tercatat di Audit Log."
      />

      <Card className="p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><Globe className="w-4 h-4" /> Negara:</div>
        <div className="flex gap-2 flex-wrap">
          {countries.map((c) => (
            <button key={c.code} onClick={() => setCountry(c.code)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${country === c.code
                ? 'bg-masri-primary text-white border-masri-primary'
                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-masri-primary'}`}>
              {c.name} · {c.currency} {!c.isActive && <span className="opacity-70">(nonaktif)</span>}
            </button>
          ))}
        </div>
        {current && (
          <div className="md:ml-auto flex gap-2">
            {country !== 'ID' && <button className={btnSecondary} onClick={copyFromID}><Copy className="w-4 h-4" /> Salin dari Indonesia</button>}
            <button className={current.isActive ? btnSecondary : btnPrimary} onClick={toggleCountry}>
              {current.isActive ? 'Nonaktifkan Negara' : 'Aktifkan Negara'}
            </button>
          </div>
        )}
      </Card>

      <ErrorBox message={error} onClose={() => setError(null)} />
      {notice && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm flex justify-between gap-2">
          <span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Tutup">×</button>
        </div>
      )}

      {loading ? <Spinner /> : configs.length === 0 ? (
        <Card className="p-10 text-center text-slate-500">
          Belum ada parameter untuk {current?.name}. Gunakan <strong>Salin dari Indonesia</strong>, lalu sesuaikan dengan regulasi dan fatwa setempat.
        </Card>
      ) : grouped.map(({ cat, items }) => (
        <Card key={cat} className="overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
            {CATEGORY_LABEL[cat]}
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((cfg) => {
              const value = isDirty(cfg.key) ? drafts[cfg.key] : cfg.value;
              return (
                <div key={cfg.key} className="p-6 grid grid-cols-1 lg:grid-cols-5 gap-4">
                  <div className="lg:col-span-2">
                    <p className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                      {cfg.label}
                      {cfg.isPublic && <span title="Ditampilkan di website publik"><Eye className="w-3.5 h-3.5 text-slate-400" /></span>}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{cfg.description}</p>
                    <p className="text-[11px] text-slate-400 mt-2 font-mono">{cfg.key} · diubah {formatDateTime(cfg.updatedAt)}</p>
                  </div>
                  <div className="lg:col-span-2">
                    <ValueEditor cfg={cfg} value={value} currency={current?.currency ?? 'IDR'}
                      onChange={(v) => setDrafts((d) => ({ ...d, [cfg.key]: v }))} />
                  </div>
                  <div className="flex lg:flex-col lg:items-end gap-2">
                    {isDirty(cfg.key) && (
                      <>
                        <button className={btnPrimary} disabled={savingKey === cfg.key} onClick={() => save(cfg)}>
                          <Save className="w-4 h-4" /> {savingKey === cfg.key ? 'Menyimpan' : 'Simpan'}
                        </button>
                        <button className={btnSecondary} onClick={() => setDrafts(({ [cfg.key]: _o, ...rest }) => rest)}>
                          <RotateCcw className="w-4 h-4" /> Batal
                        </button>
                      </>
                    )}
                    {savedKey === cfg.key && <span className="text-green-600 text-sm flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Tersimpan</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Editor nilai sesuai tipe parameter
// ---------------------------------------------------------------------------

const ValueEditor: React.FC<{ cfg: BusinessConfig; value: unknown; currency: string; onChange: (v: unknown) => void }> = ({ cfg, value, currency, onChange }) => {
  const min = cfg.minValue !== null ? Number(cfg.minValue) : undefined;
  const max = cfg.maxValue !== null ? Number(cfg.maxValue) : undefined;

  if (cfg.key === 'credit.margin_by_tenor') return <TenorMarginEditor value={value as Record<string, number>} onChange={onChange} />;
  if (cfg.key === 'shipping.partner_couriers') return <TagListEditor value={value as string[]} onChange={onChange} />;
  if (cfg.key === 'helpdesk.sla_hours') return <SlaEditor value={value as Record<string, number>} onChange={onChange} />;

  switch (cfg.valueType) {
    case 'boolean':
      return (
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input type="checkbox" className="sr-only peer" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="w-11 h-6 bg-slate-300 rounded-full peer-checked:bg-masri-primary relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          <span className="text-sm text-slate-700 dark:text-slate-300">{value ? 'Aktif' : 'Nonaktif'}</span>
        </label>
      );
    case 'money':
    case 'number':
    case 'percent': {
      const prefix = cfg.valueType === 'money' ? currency : null;
      const suffix = cfg.unit ?? (cfg.valueType === 'percent' ? '%' : null);
      return (
        <div>
          <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden focus-within:border-masri-primary">
            {prefix && <span className="px-3 text-sm text-slate-500 bg-slate-50 dark:bg-slate-900/50 self-stretch flex items-center">{prefix}</span>}
            <input type="number" className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none"
              value={value === '' ? '' : String(value ?? '')} min={min} max={max} step={cfg.valueType === 'money' ? 1000 : 'any'}
              onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
            {suffix && <span className="px-3 text-sm text-slate-500 bg-slate-50 dark:bg-slate-900/50 self-stretch flex items-center">{suffix}</span>}
          </div>
          {cfg.valueType === 'money' && typeof value === 'number' && (
            <p className="text-xs text-slate-500 mt-1">{new Intl.NumberFormat('id-ID').format(value)} {currency}</p>
          )}
          {(min !== undefined || max !== undefined) && (
            <p className="text-[11px] text-slate-400 mt-1">Rentang: {min ?? '–'} s/d {max ?? '–'}</p>
          )}
        </div>
      );
    }
    case 'string':
      return <input className={inputCls} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <JsonEditor value={value} onChange={onChange} />;
  }
};

const TenorMarginEditor: React.FC<{ value: Record<string, number>; onChange: (v: Record<string, number>) => void }> = ({ value, onChange }) => {
  const rows = Object.entries(value ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const [newTenor, setNewTenor] = useState('');

  const update = (tenor: string, margin: number) => onChange({ ...value, [tenor]: margin });
  const remove = (tenor: string) => { const { [tenor]: _r, ...rest } = value; onChange(rest); };
  const add = () => {
    const t = String(parseInt(newTenor, 10));
    if (!t || t === 'NaN' || t in value) return;
    onChange({ ...value, [t]: 0 });
    setNewTenor('');
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-slate-500 uppercase">
        <span>Tenor</span><span>Margin (total)</span><span />
      </div>
      {rows.map(([tenor, margin]) => (
        <div key={tenor} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <span className="text-sm text-slate-700 dark:text-slate-300">{tenor} bulan</span>
          <div className="flex items-center gap-1">
            <input type="number" className={inputCls} value={margin} min={0} max={100} step="0.1"
              onChange={(e) => update(tenor, Number(e.target.value))} />
            <span className="text-sm text-slate-500">%</span>
          </div>
          <button onClick={() => remove(tenor)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Hapus tenor"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <input type="number" className={inputCls} placeholder="Tenor baru (bulan)" value={newTenor} min={1} onChange={(e) => setNewTenor(e.target.value)} />
        <button className={btnSecondary} onClick={add}><Plus className="w-4 h-4" /> Tambah</button>
      </div>
    </div>
  );
};

const SLA_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'Tinggi', normal: 'Normal', low: 'Rendah' };

const SlaEditor: React.FC<{ value: Record<string, number>; onChange: (v: Record<string, number>) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    {Object.keys(SLA_LABEL).map((k) => (
      <label key={k} className="text-xs text-slate-500">
        {SLA_LABEL[k]}
        <div className="flex items-center gap-1 mt-0.5">
          <input type="number" min={1} className={inputCls} value={value?.[k] ?? ''}
            onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} />
          <span className="text-sm">jam</span>
        </div>
      </label>
    ))}
  </div>
);

const TagListEditor: React.FC<{ value: string[]; onChange: (v: string[]) => void }> = ({ value, onChange }) => {
  const [input, setInput] = useState('');
  const list = Array.isArray(value) ? value : [];
  const add = () => {
    const v = input.trim().toLowerCase();
    if (v && !list.includes(v)) onChange([...list, v]);
    setInput('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-masri-light dark:bg-emerald-900/30 text-masri-dark dark:text-emerald-200 text-xs font-semibold uppercase">
            {t}
            <button onClick={() => onChange(list.filter((x) => x !== t))} className="hover:text-red-600" aria-label={`Hapus ${t}`}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Kode kurir, mis. ninja" value={input}
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className={btnSecondary} onClick={add}><Plus className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

const JsonEditor: React.FC<{ value: unknown; onChange: (v: unknown) => void }> = ({ value, onChange }) => {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <div>
      <textarea className={`${inputCls} font-mono text-xs h-28`} value={text}
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(JSON.parse(e.target.value)); setInvalid(false); } catch { setInvalid(true); }
        }} />
      {invalid && <p className="text-xs text-red-500 mt-1">JSON belum valid</p>}
    </div>
  );
};
