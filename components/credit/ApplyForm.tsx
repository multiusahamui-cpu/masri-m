import React, { useEffect, useState } from 'react';
import { customerSession } from '../../lib/customer';
import { Search, ImageOff } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { CatalogProduct, InstallmentOption } from '../../types';
import { ErrorBox, inputCls, labelCls, btnPrimary } from '../superadmin/ui';
import { useLocale, countryInfo, type Country } from '../../lib/i18n';
import { ConsentText } from '../legal/LegalPages';
import { cart } from '../../lib/cart';

export interface ApplyPrefill { productId?: string; tenor?: number; dpPct?: number }

interface Props {
  mode: 'public' | 'staff';
  fixedBranch?: { id: string; name: string; countryCode?: string };     // staf: cabang sendiri
  prefill?: ApplyPrefill;
  onSubmitted: (r: { appNo: string; id?: string }) => void;
}

/** Formulir pengajuan pembiayaan Murabahah (web publik atau diinput staf cabang). */
export const ApplyForm: React.FC<Props> = ({ mode, fixedBranch, prefill, onSubmitted }) => {
  const [branches, setBranches] = useState<{ id: string; name: string; city: string }[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [product, setProduct] = useState<{ id: string; name: string; cashPrice: number; image?: string } | null>(null);
  const [qty, setQty] = useState(1);
  const [dpPct, setDpPct] = useState(prefill?.dpPct ?? 10);
  const [minDp, setMinDp] = useState(10);
  const [options, setOptions] = useState<InstallmentOption[]>([]);
  const [tenor, setTenor] = useState<number>(prefill?.tenor ?? 12);
  const [branchId, setBranchId] = useState(fixedBranch?.id ?? '');
  const [c, setC] = useState({ fullName: '', phone: '', email: '', nik: '', birthDate: '', city: '', address: '', occupation: '', employer: '', monthlyIncome: '', maritalStatus: 'married', dependents: '0' });
  const [purpose, setPurpose] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [promoInput, setPromoInput] = useState(() => cart.pendingPromo() ?? '');
  const [promo, setPromo] = useState<{ code: string; discount: number; error?: string } | null>(null);
  const [optIn, setOptIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const L = useLocale();
  const country = (fixedBranch?.countryCode ?? L.country) as Country;
  const ci = countryInfo(country);
  const formatMoney = (v: number) => L.money(v, ci.currency);
  const tr = L.t;

  const [prefilled, setPrefilled] = useState(false);
  // Nasabah yang sudah masuk Akun Saya: isi otomatis dari data tersimpan
  useEffect(() => {
    if (mode !== 'public') return;
    customerSession.get().then((me) => {
      if (!me) return;
      const p = me.profile, k = me.kyc;
      setC((x) => ({ ...x, fullName: p.needsName ? x.fullName : p.fullName, phone: p.phone, email: p.email ?? '', city: p.city || '', address: p.address || '',
        nik: k.nik ?? '', birthDate: k.birthDate ?? '', maritalStatus: k.maritalStatus ?? x.maritalStatus, dependents: k.dependents != null ? String(k.dependents) : x.dependents,
        occupation: k.occupation ?? '', employer: k.employer ?? '', monthlyIncome: k.monthlyIncome != null ? String(k.monthlyIncome) : '' }));
      setPrefilled(true);
    }).catch(() => undefined);
  }, [mode]);
  useEffect(() => { if (!fixedBranch) { setBranchId(''); api.get<{ branches: { id: string; name: string; city: string }[] }>(`/catalog/branches?country=${country}`).then((r) => setBranches(r.branches)).catch(() => undefined); } }, [fixedBranch, country]);
  useEffect(() => {
    if (!prefill?.productId) return;
    api.get<{ product: { id: string; name: string; cashPrice: number; images: string[] } }>(`/catalog/products/${prefill.productId}?country=${country}`)
      .then((r) => setProduct({ id: r.product.id, name: r.product.name, cashPrice: r.product.cashPrice, image: r.product.images[0] })).catch(() => undefined);
  }, [prefill?.productId, country]);
  useEffect(() => {
    if (product || search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api.get<{ products: CatalogProduct[] }>(`/catalog/products${qs({ country, search, pageSize: 8 })}`).then((r) => setResults(r.products)).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [search, product]);
  // Simulasi cicilan (harga × qty dihitung sederhana di sisi klien dari opsi per unit)
  useEffect(() => {
    if (!product) return;
    const t = setTimeout(() => api.get<{ installments: InstallmentOption[]; minDownPaymentPct: number }>(`/catalog/products/${product.id}?country=${country}&dpPct=${dpPct}`)
      .then((r) => { setOptions(r.installments); setMinDp(r.minDownPaymentPct); if (!r.installments.some((o) => o.tenor === tenor) && r.installments.length) setTenor(r.installments[0].tenor); }).catch(() => undefined), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, dpPct]);

  const chosen = options.find((o) => o.tenor === tenor);
  const checkPromo = async (code = promoInput) => {
    if (!product || code.length < 3) return;
    try {
      const r = await api.post<{ code: string; discount: number }>('/public/promo/check', { code, country, channel: 'credit', phone: c.phone.length >= 8 ? c.phone : null, items: [{ productId: product.id, qty }] });
      setPromo({ code: r.code, discount: r.discount });
    } catch (err) { setPromo({ code, discount: 0, error: (err as ApiError).message }); }
  };
  // produk / jumlah berubah → hitung ulang potongan
  useEffect(() => { if (promo && !promo.error) void checkPromo(promo.code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [product?.id, qty]);
  const set = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC({ ...c, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) { setError(tr('apply.pickProduct')); return; }
    setSaving(true); setError(null);
    const body = {
      customer: { ...c, email: c.email || null, employer: c.employer || null, monthlyIncome: Number(c.monthlyIncome), dependents: Number(c.dependents) },
      branchId, productId: product.id, qty, tenor, dpPct, purpose: purpose || null,
      promoCode: promo && !promo.error ? promo.code : null, ...(mode === 'public' ? { marketingOptIn: optIn } : {}),
    };
    try {
      if (mode === 'public') {
        const r = await api.post<{ appNo: string }>('/public/credit-applications', { ...body, consent, website });
        cart.setPendingPromo(null);
        onSubmitted({ appNo: r.appNo });
      } else {
        const r = await api.post<{ application: { id: string; appNo: string } }>('/credit/applications', body);
        onSubmitted({ appNo: r.application.appNo, id: r.application.id });
      }
    } catch (err) { setError((err as ApiError).message); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <ErrorBox message={error} onClose={() => setError(null)} />
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" />

      <section className="space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-white">1. {tr('apply.s1')}</h3>
        {product ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-masri-light dark:bg-emerald-900/20">
            <div className="w-14 h-14 rounded-lg bg-white overflow-hidden flex items-center justify-center">{product.image ? <img src={product.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" /> : <ImageOff className="w-5 h-5 text-slate-400" />}</div>
            <div className="flex-1"><p className="font-semibold text-slate-800 dark:text-white">{product.name}</p><p className="text-sm text-slate-500">{tr('catalog.cash')} {formatMoney(product.cashPrice)}</p></div>
            <label className="text-xs text-slate-500">{tr('apply.qty')}<input type="number" min={1} max={5} className={`${inputCls.replace("w-full", "")} w-16 shrink-0`} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(5, Number(e.target.value))))} /></label>
            <button type="button" className="text-sm text-masri-primary underline" onClick={() => { setProduct(null); setOptions([]); }}>{tr('apply.change')}</button>
          </div>
        ) : (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder={tr('apply.searchProduct')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                {results.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm flex justify-between"
                  onClick={() => { setProduct({ id: p.id, name: p.name, cashPrice: p.cashPrice, image: p.images[0] }); setSearch(''); }}>
                  <span className="text-slate-800 dark:text-white">{p.name}</span><span className="text-slate-500">{formatMoney(p.cashPrice)}</span></button></li>)}
              </ul>
            )}
          </div>
        )}
        {product && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
            <label className="block text-sm text-slate-700 dark:text-slate-300">{tr('product.dp')}: <strong>{dpPct}%</strong>
              <input type="range" min={minDp} max={50} step={5} value={dpPct} onChange={(e) => setDpPct(Number(e.target.value))} className="w-full accent-emerald-700" /></label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {options.map((o) => (
                <button type="button" key={o.tenor} onClick={() => setTenor(o.tenor)} className={`px-1 py-2 rounded-lg border text-center min-w-0 ${tenor === o.tenor ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                  <p className="text-xs">{o.tenor} {tr('product.mo')}</p><p className="text-xs font-bold truncate">{formatMoney(o.monthly * qty).replace(/^(Rp|RM|B?\$|BND)\s?/, '')}</p>
                </button>
              ))}
            </div>
            {chosen && <p className="text-sm text-slate-600 dark:text-slate-300">{tr('apply.estimate', { dp: formatMoney(chosen.downPayment * qty), monthly: formatMoney(chosen.monthly * qty), n: chosen.tenor, pct: chosen.marginPct })}</p>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-white">2. {tr(`apply.s2.${country}`)}</h3>
        {prefilled && <p className="text-xs p-2 rounded-lg bg-masri-light text-masri-dark dark:bg-emerald-900/20 dark:text-emerald-200">{tr('apply.prefilled')}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className={labelCls}>{tr('apply.fullName')}</label><input required className={inputCls} value={c.fullName} onChange={set('fullName')} /></div>
          <div><label className={labelCls}>{tr(`apply.idNo.${country}`)}</label><input required className={inputCls} value={c.nik} onChange={set('nik')} /></div>
          <div><label className={labelCls}>{tr('apply.birthDate')}</label><input required type="date" className={inputCls} value={c.birthDate} onChange={set('birthDate')} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>{tr('apply.marital')}</label><select className={inputCls} value={c.maritalStatus} onChange={set('maritalStatus')}>{['single', 'married', 'widowed'].map((k) => <option key={k} value={k}>{tr(`apply.marital.${k}`)}</option>)}</select></div>
            <div><label className={labelCls}>{tr('apply.dependents')}</label><input type="number" min={0} className={inputCls} value={c.dependents} onChange={set('dependents')} /></div>
          </div>
          <div><label className={labelCls}>{tr('common.phone')} <span className="font-normal text-slate-400">({ci.dial})</span></label><input required className={inputCls} value={c.phone} onChange={set('phone')} placeholder={ci.phoneHint} /></div>
          <div><label className={labelCls}>{tr('apply.email')}</label><input type="email" className={inputCls} value={c.email} onChange={set('email')} /></div>
          <div className="md:col-span-2"><label className={labelCls}>{tr('apply.address')}</label><input required className={inputCls} value={c.address} onChange={set('address')} /></div>
          <div><label className={labelCls}>{tr('apply.city')}</label><input required className={inputCls} value={c.city} onChange={set('city')} /></div>
          {fixedBranch ? <div><label className={labelCls}>{tr('apply.branch')}</label><input disabled className={inputCls} value={fixedBranch.name} /></div> : (
            <div><label className={labelCls}>{tr('apply.branchNearest')}</label><select required className={inputCls} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tr('checkout.branchPick')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.city})</option>)}</select></div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-white">3. {tr('apply.s3')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className={labelCls}>{tr('apply.occupation')}</label><input required className={inputCls} value={c.occupation} onChange={set('occupation')} /></div>
          <div><label className={labelCls}>{tr('apply.employer')}</label><input className={inputCls} value={c.employer} onChange={set('employer')} /></div>
          <div><label className={labelCls}>{tr('apply.income', { cur: ci.currency })}</label><input required type="number" min={0} className={inputCls} value={c.monthlyIncome} onChange={set('monthlyIncome')} /></div>
          <div className="md:col-span-3"><label className={labelCls}>{tr('apply.purpose')}</label><input className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
        </div>
      </section>

      {product && (
        <section className="space-y-2">
          <label className={labelCls}>{tr('promo.label')}</label>
          <div className="flex gap-2 max-w-md">
            <input className={`${inputCls} uppercase`} placeholder={tr('promo.placeholder')} value={promoInput} onChange={(e) => { setPromoInput(e.target.value.toUpperCase().replace(/\s/g, '')); setPromo(null); }} />
            <button type="button" className="px-3 rounded-lg border border-masri-primary text-masri-primary text-xs font-bold disabled:opacity-50" disabled={promoInput.length < 3} onClick={() => checkPromo()}>{tr('promo.apply')}</button>
          </div>
          {promo?.error && <p className="text-xs text-red-600">{promo.error}</p>}
          {promo && !promo.error && <p className="text-sm text-green-700 dark:text-green-400">{tr('promo.applied', { code: promo.code, amount: formatMoney(promo.discount) })}. <span className="text-xs text-slate-500">{tr('promo.creditNote')}</span></p>}
        </section>
      )}
      {mode === 'public' && (
        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-1" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />{tr('promo.optIn')}</label>
      )}
      {mode === 'public' && (
        <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input id="apply-consent" type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <label htmlFor="apply-consent"><ConsentText textKey="apply.consent" /></label>
        </div>
      )}
      <button type="submit" className={`${btnPrimary} w-full justify-center py-3`} disabled={saving || (mode === 'public' && !consent)}>{saving ? tr('common.sending') : tr('apply.submit')}</button>
    </form>
  );
};
