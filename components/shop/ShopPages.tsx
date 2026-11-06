import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, Minus, Plus, Trash2, Search, Truck, Store, Package, Copy, ImageOff, Printer } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { cart, useCart } from '../../lib/cart';
import { printReceipt } from '../../lib/print';
import QRCode from 'qrcode';
import { ErrorBox, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { t as tr, useLocale } from '../../lib/i18n';
import { ConsentText } from '../legal/LegalPages';

interface Option { mode: 'internal' | 'partner' | 'pickup'; label: string; courierCode?: string; service?: string; etd: string; fee: number; note?: string }
interface Quote { currency: string; subtotal: number; tax: number; available: boolean; from: { name: string; city: string } | null; options: Option[]; courierNote?: string | null;
  split?: boolean; locations?: string[]; promo?: { code: string; discount: number; tax: number; error: string | null } | null }

export const Shell: React.FC<{ title: string; subtitle?: string; onBack: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, subtitle, onBack, children, wide }) => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pt-24 pb-20 px-4">
    <div className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} mx-auto`}>
      <button onClick={onBack} className="flex items-center text-slate-600 dark:text-slate-300 hover:text-masri-primary font-medium mb-6"><ArrowLeft className="w-5 h-5 mr-2" /> {tr('common.back')}</button>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-masri-primary p-6 md:p-8 text-white"><h1 className="text-2xl md:text-3xl font-bold mb-1">{title}</h1>{subtitle && <p className="text-green-100">{subtitle}</p>}</div>
        <div className="p-6 md:p-8">{children}</div>
      </div>
    </div>
  </div>
);

/** Teks opsi pengiriman dari server (Bahasa Indonesia) → bahasa aktif. */
const DELIVERY_TR: Record<'ms' | 'en', [RegExp, string][]> = {
  ms: [[/Armada Masri-M/g, 'Armada Masri-M'], [/Sesuai jadwal \(1-2 hari\)/g, 'Mengikut jadual (1-2 hari)'], [/Gratis ongkir/g, 'Penghantaran percuma'], [/termasuk pemasangan/g, 'termasuk pemasangan'],
    [/cocok untuk barang besar/g, 'sesuai untuk barang besar'], [/Ambil sendiri di/g, 'Ambil sendiri di'], [/Setelah barang disiapkan/g, 'Selepas barang disediakan'], [/Reguler/g, 'Biasa'], [/Kargo/g, 'Kargo'],
    [/Hari ini/g, 'Hari ini'], [/(\d+(?:-\d+)?) hari/g, '$1 hari'], [/(\d+(?:-\d+)?) jam/g, '$1 jam']],
  en: [[/Armada Masri-M/g, 'Masri-M fleet'], [/Sesuai jadwal \(1-2 hari\)/g, 'Scheduled (1-2 days)'], [/Gratis ongkir/g, 'Free delivery'], [/termasuk pemasangan/g, 'installation included'],
    [/cocok untuk barang besar/g, 'suitable for large items'], [/Ambil sendiri di/g, 'Self-collect at'], [/Setelah barang disiapkan/g, 'Once the goods are prepared'], [/Reguler/g, 'Regular'], [/Kargo/g, 'Cargo'],
    [/Hari ini/g, 'Today'], [/(\d+(?:-\d+)?) hari/g, '$1 days'], [/(\d+(?:-\d+)?) jam/g, '$1 hours'], [/Isi kode pos untuk melihat ongkir kurir mitra/g, 'Enter a postcode to see courier rates']],
};
const trDelivery = (s: string | undefined, lang: string) => (s && lang !== 'id' ? (DELIVERY_TR[lang as 'ms' | 'en'] ?? []).reduce((x, [re, to]) => x.replace(re, to), s) : s ?? '');

const optKey = (o: Option) => `${o.mode}|${o.courierCode ?? ''}|${o.service ?? ''}`;
const ModeIcon = ({ m }: { m: Option['mode'] }) => (m === 'pickup' ? <Store className="w-4 h-4" /> : m === 'internal' ? <Truck className="w-4 h-4" /> : <Package className="w-4 h-4" />);

/** Keranjang & checkout tunai (guest). */
export const CheckoutPage: React.FC<{ onBack: () => void; onTrack: (orderNo: string) => void }> = ({ onBack, onTrack }) => {
  const lines = useCart();
  const [branches, setBranches] = useState<{ id: string; name: string; city: string }[]>([]);
  const [branchId, setBranchId] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [bank, setBank] = useState('bca');
  const payOpts = usePaymentOptions();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [opt, setOpt] = useState('');
  const [cust, setCust] = useState({ fullName: '', phone: '', email: '' });
  const { t, country, info, money: fmt, lang } = useLocale();
  const [pay, setPay] = useState<'va' | 'qris' | 'fpx' | 'cashier'>('cashier');
  const [note, setNote] = useState('');
  const [promoInput, setPromoInput] = useState(() => cart.pendingPromo() ?? '');
  const [promoCode, setPromoCode] = useState(() => cart.pendingPromo() ?? '');
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderNo: string; total: number; currency: string; expiresAt: string; payment: PayInfo | null } | null>(null);

  useEffect(() => { window.scrollTo(0, 0); setBranchId(''); api.get<{ branches: { id: string; name: string; city: string }[] }>(`/catalog/branches?country=${country}`).then((r) => setBranches(r.branches)).catch(() => undefined); }, [country]);
  useEffect(() => { if (payOpts) setPay(payOpts.methods[0] ?? 'cashier'); }, [payOpts]);
  useEffect(() => {
    if (!branchId || city.trim().length < 2 || !lines.length) { setQuote(null); return; }
    const t = setTimeout(() => api.post<Quote>('/public/cart/quote', { branchId, city, postalCode: /^(\d{5}|[A-Z]{2}\d{4})$/.test(postalCode) ? postalCode : null, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      promoCode: promoCode || null, phone: cust.phone.length >= 8 ? cust.phone : null })
      .then((q) => { setQuote(q); setError(null); if (!q.options.some((o) => optKey(o) === opt)) setOpt(q.options[0] ? optKey(q.options[0]) : ''); })
      .catch((e) => setError((e as ApiError).message)), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, city, postalCode, lines, promoCode, cust.phone.length >= 8]);

  const chosen = quote?.options.find((o) => optKey(o) === opt);
  const money = (v: number) => fmt(v, quote?.currency ?? info.currency);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const promoOk = quote?.promo && !quote.promo.error ? quote.promo : null;
  const total = (quote?.subtotal ?? subtotal) - (promoOk?.discount ?? 0) + (quote?.tax ?? 0) + (chosen?.fee ?? 0);

  const submit = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<NonNullable<typeof done>>('/public/orders', {
        customer: { ...cust, email: cust.email || null }, branchId, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        delivery: { mode: chosen.mode, address, city, postalCode: postalCode || null, courierCode: chosen.courierCode ?? null, service: chosen.service ?? null }, paymentMethod: pay, bank: pay === 'va' ? bank : null, note: note || null,
        promoCode: promoOk ? promoOk.code : null, marketingOptIn: optIn,
      });
      cart.clear(); cart.setPendingPromo(null); setDone(r);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  if (done) return (
    <Shell title={t('checkout.done')} onBack={onBack}>
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto"><CheckCircle className="w-10 h-10 text-green-600" /></div>
        <p className="text-slate-600 dark:text-slate-300">{t('checkout.orderNo')}</p>
        <p className="text-2xl font-mono font-bold text-masri-primary">{done.orderNo}</p>
        <PaymentBox payment={done.payment} total={done.total} currency={done.currency} expiresAt={done.expiresAt} />
        <button className={`${btnPrimary} mx-auto`} onClick={() => onTrack(done.orderNo)}>{t('checkout.track')}</button>
      </div>
    </Shell>
  );

  return (
    <Shell title={t('checkout.title')} subtitle={t(`checkout.subtitle.${country}`)} onBack={onBack} wide>
      {lines.length === 0 ? <p className="text-center text-slate-500 py-10">{t('checkout.empty')}</p> : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            <ErrorBox message={error} onClose={() => setError(null)} />
            <p className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{t('checkout.creditHint')}</p>
            <section className="space-y-2">
              {lines.map((l) => (
                <div key={l.productId} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="w-14 h-14 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden flex items-center justify-center">{l.image ? <img src={l.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" /> : <ImageOff className="w-5 h-5 text-slate-400" />}</div>
                  <div className="flex-1"><p className="font-semibold text-slate-800 dark:text-white">{l.name}</p><p className="text-sm text-slate-500">{fmt(l.unitPrice)}</p></div>
                  <div className="flex items-center gap-1">
                    <button className="p-1 rounded border dark:border-slate-600" onClick={() => cart.setQty(l.productId, l.qty - 1)} aria-label={t('common.less')}><Minus className="w-3 h-3" /></button>
                    <span className="w-8 text-center">{l.qty}</span>
                    <button className="p-1 rounded border dark:border-slate-600" onClick={() => cart.setQty(l.productId, l.qty + 1)} aria-label={t('common.more')}><Plus className="w-3 h-3" /></button>
                  </div>
                  <button className="p-2 text-red-500" onClick={() => cart.remove(l.productId)} aria-label={t('common.remove')}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </section>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className={labelCls}>{t('checkout.name')}</label><input className={inputCls} value={cust.fullName} onChange={(e) => setCust({ ...cust, fullName: e.target.value })} /></div>
              <div><label className={labelCls}>{t('common.phone')} <span className="font-normal text-slate-400">({info.dial})</span></label><input className={inputCls} placeholder={info.phoneHint} inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></div>
              <div><label className={labelCls}>{t('checkout.branch')}</label><select className={inputCls} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{t('checkout.branchPick')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.city})</option>)}</select></div>
              <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><label className={labelCls}>{t('checkout.city')}</label><input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} /></div>
                <div><label className={labelCls}>{t('common.postal')}</label><input className={inputCls} value={postalCode} maxLength={6} onChange={(e) => setPostalCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))} placeholder={info.postalHint} /></div></div>
              <div className="md:col-span-2"><label className={labelCls}>{t('checkout.address')}</label><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('checkout.addressHint')} /></div>
            </section>
            {quote && (
              <section className="space-y-2">
                <h3 className="font-bold text-slate-800 dark:text-white">{t('checkout.delivery')} {quote.from && <span className="text-sm font-normal text-slate-500">· {t('checkout.from', { name: quote.from.name })}</span>}</h3>
                {!quote.available && <p className="text-sm text-red-600">{t('checkout.noStock')}</p>}
                {quote.courierNote && <p className="text-xs text-amber-700">{trDelivery(quote.courierNote, lang)}</p>}
                {quote.split && <p className="text-xs text-blue-700 dark:text-blue-300">{t('shop.split', { locations: (quote.locations ?? []).join(', ') })}</p>}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {quote.options.map((o) => (
                    <label key={optKey(o)} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${opt === optKey(o) ? 'border-masri-primary bg-masri-light/60 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                      <input type="radio" checked={opt === optKey(o)} onChange={() => setOpt(optKey(o))} />
                      <span className="text-masri-primary"><ModeIcon m={o.mode} /></span>
                      <span className="flex-1"><span className="font-semibold text-slate-800 dark:text-white">{trDelivery(o.label, lang)}</span><span className="block text-xs text-slate-500">{trDelivery(o.etd, lang)}{o.note ? ` · ${trDelivery(o.note, lang)}` : ''}</span></span>
                      <span className="font-semibold text-slate-800 dark:text-white">{o.fee ? money(o.fee) : t('common.free')}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}
            <section className="space-y-2">
              <h3 className="font-bold text-slate-800 dark:text-white">{t('checkout.payment')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {[...(payOpts?.methods ?? []), 'cashier' as const].map((k) => [k, t(`pay.method.${k}`)] as const).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setPay(k)} className={`p-3 rounded-xl border text-sm font-semibold ${pay === k ? 'border-masri-primary bg-masri-light/60 dark:bg-emerald-900/20 text-masri-dark dark:text-emerald-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{v}</button>
                ))}
              </div>
              {pay === 'va' && payOpts && (
                <div className="flex flex-wrap gap-2">{payOpts.banks.map((b) => (
                  <button key={b.code} type="button" onClick={() => setBank(b.code)} className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${bank === b.code ? 'border-masri-primary text-masri-dark bg-masri-light/60 dark:bg-emerald-900/20 dark:text-emerald-200' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>VA {b.name}</button>
                ))}</div>
              )}
              {pay === 'cashier' && payOpts?.transferInfo && <p className="text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">{t('pay.transferInfo')}: <b>{payOpts.transferInfo}</b></p>}
              <input className={inputCls} placeholder={t('checkout.note')} value={note} onChange={(e) => setNote(e.target.value)} />
            </section>
          </div>
          <aside className="lg:col-span-2">
            <div className="sticky top-24 p-5 rounded-2xl bg-slate-50 dark:bg-slate-900/40 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('common.subtotal')}</span><span>{money(quote?.subtotal ?? subtotal)}</span></div>
              {promoOk && <div className="flex justify-between text-green-700 dark:text-green-400"><span>{t('promo.discount', { code: promoOk.code })}</span><span>−{money(promoOk.discount)}</span></div>}
              {!!quote?.tax && <div className="flex justify-between"><span className="text-slate-500">{t(`tax.${country}`)}</span><span>{money(quote.tax)}</span></div>}
              <div className="flex justify-between"><span className="text-slate-500">{t('common.shipping')}</span><span>{chosen ? (chosen.fee ? money(chosen.fee) : t('common.free')) : '—'}</span></div>
              <div className="flex justify-between text-lg font-bold border-t border-slate-200 dark:border-slate-700 pt-2"><span>{t('common.total')}</span><span>{money(total)}</span></div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('promo.label')}</label>
                {promoCode && promoOk ? (
                  <div className="flex items-center justify-between mt-1 text-xs"><span className="text-green-700 dark:text-green-400">{t('promo.applied', { code: promoOk.code, amount: money(promoOk.discount) })}</span>
                    <button className="text-slate-500 underline" onClick={() => { setPromoCode(''); setPromoInput(''); cart.setPendingPromo(null); }}>{t('promo.remove')}</button></div>
                ) : (
                  <div className="flex gap-2 mt-1">
                    <input className={`${inputCls} uppercase`} placeholder={t('promo.placeholder')} value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase().replace(/\s/g, ''))} />
                    <button type="button" className="px-3 rounded-lg border border-masri-primary text-masri-primary text-xs font-bold disabled:opacity-50" disabled={promoInput.length < 3} onClick={() => setPromoCode(promoInput)}>{t('promo.apply')}</button>
                  </div>
                )}
                {promoCode && quote?.promo?.error && <p className="text-xs text-red-600 mt-1">{quote.promo.error}</p>}
                {promoCode && !quote && <p className="text-xs text-slate-500 mt-1">{t('promo.needQuote')}</p>}
              </div>
              <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1"><input type="checkbox" className="mt-0.5" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />{t('promo.optIn')}</label>
              <button className={`${btnPrimary} w-full justify-center py-3`} disabled={busy || !chosen || !quote?.available || !cust.fullName || !cust.phone} onClick={submit}>{busy ? t('common.processing') : t('checkout.submit')}</button>
              <p className="text-xs text-slate-500 text-center mt-2"><ConsentText textKey="legal.consentOrder" /></p>
              <p className="text-[11px] text-slate-500">{t('checkout.footnote')}</p>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
};

export interface PayInfo { paymentNo: string; method: string; vaNumber: string | null; bank?: string | null; qrString?: string | null; qrUrl?: string | null; payUrl?: string | null; amount: number }
interface PayOptions { provider: string; methods: ('va' | 'qris' | 'fpx')[]; banks: { code: string; name: string }[]; qris: boolean; fpx: boolean; transferInfo: string | null; simulation: boolean }
const payOptsCache = new Map<string, Promise<PayOptions>>();
/** Metode pembayaran online yang tersedia di negara aktif. */
export function usePaymentOptions(override?: string) {
  const { country: active } = useLocale();
  const country = override ?? active;
  const [o, setO] = useState<PayOptions | null>(null);
  useEffect(() => {
    let p = payOptsCache.get(country);
    if (!p) { p = api.get<PayOptions>(`/public/payment-options?country=${country}`); payOptsCache.set(country, p); }
    p.then(setO).catch(() => { payOptsCache.delete(country); });
  }, [country]);
  return o;
}
const BANK_NAME: Record<string, string> = { bca: 'BCA', bni: 'BNI', bri: 'BRI', permata: 'Permata' };

/** Gambar QRIS: pakai URL gambar dari gateway bila ada, selain itu dirender dari payload QR. */
const QrImage: React.FC<{ qrString?: string | null; qrUrl?: string | null }> = ({ qrString, qrUrl }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (qrString) QRCode.toDataURL(qrString, { width: 240, margin: 1 }).then(setSrc).catch(() => setSrc(null)); }, [qrString]);
  const url = src ?? (qrString ? null : qrUrl);
  return url ? <img src={url} alt="QRIS" className="w-56 h-56 bg-white p-2 rounded-lg border border-slate-200" /> : <p className="text-xs text-slate-500">{tr('pay.qrPending')}</p>;
};

export const COUNTRY_OF_CURRENCY: Record<string, string> = { IDR: 'ID', MYR: 'MY', BND: 'BN' };
export const PaymentBox: React.FC<{ payment: PayInfo | null; total: number; currency: string; expiresAt?: string | null; onPaid?: () => void }> = ({ payment, total, currency, expiresAt, onPaid }) => {
  const [msg, setMsg] = useState<string | null>(null);
  const opts = usePaymentOptions(COUNTRY_OF_CURRENCY[currency]);
  const { t, money, date } = useLocale();
  const before = expiresAt ? ` ${t('pay.before', { date: date(expiresAt, true) })}` : '';
  if (!payment) return (
    <div className="text-sm text-slate-600 dark:text-slate-300 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-left space-y-1">
      <p>{t('pay.atBranch', { amount: money(total, currency) })}{before}. {t('pay.mentionOrder')}</p>
      {opts?.transferInfo && <p className="text-xs">{t('pay.transferInfo')}: <b>{opts.transferInfo}</b></p>}
    </div>
  );
  const simulate = async () => {
    try { await api.post(`/dev/payments/${payment.paymentNo}/pay`); setMsg(t('pay.simulated')); onPaid?.(); }
    catch (e) { setMsg((e as ApiError).message); }
  };
  const isVa = payment.method === 'va', isFpx = payment.method === 'fpx';
  return (
    <div className="p-4 rounded-xl bg-masri-light dark:bg-emerald-900/20 text-left space-y-2">
      <p className="text-sm text-slate-600 dark:text-slate-300">{isVa ? t('pay.vaTitle', { bank: BANK_NAME[payment.bank ?? ''] ?? '' }) : isFpx ? t('pay.fpxTitle') : t('pay.qrisTitle')}{before}</p>
      {isVa ? (
        <div className="flex items-center gap-2"><code className="flex-1 text-lg font-mono font-bold text-masri-dark dark:text-emerald-200">{payment.vaNumber}</code>
          <button className={btnSecondary} onClick={() => navigator.clipboard?.writeText(payment.vaNumber ?? '').catch(() => undefined)} aria-label={t('common.copy')}><Copy className="w-4 h-4" /></button></div>
      ) : isFpx ? (
        payment.payUrl ? <a href={payment.payUrl} target="_blank" rel="noreferrer" className={`${btnPrimary} inline-flex`}>{t('pay.fpxButton')}</a> : <p className="text-xs text-slate-500">{t('pay.fpxPending')}</p>
      ) : <QrImage qrString={payment.qrString} qrUrl={payment.qrUrl} />}
      <p className="text-sm">{t('pay.amount')}: <strong>{money(payment.amount, currency)}</strong> {isVa && <span className="text-xs text-slate-500">({t('pay.exact')})</span>}</p>
      <p className="text-xs text-slate-500">{t('pay.auto')}</p>
      {opts?.simulation && <button onClick={simulate} className="text-xs text-slate-500 underline">{t('pay.simulate')}</button>}
      {msg && <p className="text-xs text-masri-primary">{msg}</p>}
    </div>
  );
};

interface OrderTrack {
  orderNo: string; status: string; statusLabel: string; currency: string; subtotal: number; tax: number; shippingFee: number; total: number; expiresAt: string; createdAt: string;
  items: { name: string; qty: number; unitPrice: number }[];
  payments: (PayInfo & { status: string; expiresAt: string | null })[];
  shipment: ShipmentPublic | null; branch: { name: string; address: string; phone: string | null };
}
export interface ShipmentPublic {
  shipmentNo: string; status: string; mode: string; modeLabel: string; trackingNo: string | null; scheduledDate: string | null; scheduledSlot: string | null;
  pickupCode: string | null; pickupCodeSent?: boolean; pickupExpiresAt: string | null; pickupLocation: { name: string; address: string; city: string; phone: string | null };
  deliveredAt: string | null; podName: string | null; events: { status: string; message: string | null; createdAt: string }[];
}

export const ShipmentPublicView: React.FC<{ s: ShipmentPublic }> = ({ s }) => {
  const { t, date } = useLocale();
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
      <div className="flex justify-between flex-wrap gap-2">
        <p className="font-bold text-slate-800 dark:text-white">{t('ship.title')} · {s.modeLabel}</p>
        <span className="font-mono text-xs text-slate-500">{s.shipmentNo}{s.trackingNo ? ` · ${t('ship.awb')} ${s.trackingNo}` : ''}</span>
      </div>
      {s.pickupCode && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('ship.ready')} <strong>{s.pickupLocation.name}</strong> ({s.pickupLocation.address || s.pickupLocation.city})</p>
          <p className="text-xs text-slate-500">{t('ship.showCode')}{s.pickupExpiresAt ? ` · ${t('ship.validUntil', { date: date(s.pickupExpiresAt, true) })}` : ''}</p>
          <p className="text-4xl font-mono font-bold tracking-[0.3em] text-masri-dark dark:text-amber-200 mt-2">{s.pickupCode}</p>
        </div>
      )}
      {!s.pickupCode && s.pickupCodeSent && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-center text-sm text-slate-700 dark:text-slate-200">
          {t('ship.ready')} <strong>{s.pickupLocation.name}</strong> ({s.pickupLocation.address || s.pickupLocation.city}). {t('ship.codeSent')}
        </div>
      )}
      {s.scheduledDate && s.status !== 'delivered' && <p className="text-sm text-slate-600 dark:text-slate-300">{t('ship.schedule')}: <strong>{s.scheduledDate}</strong> ({s.scheduledSlot})</p>}
      <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-2">
        {s.events.map((e, i) => <li key={i} className="ml-4"><span className="absolute -left-[7px] w-3 h-3 rounded-full bg-masri-primary" />
          <p className="text-sm text-slate-700 dark:text-slate-200">{e.message}</p><p className="text-[11px] text-slate-400">{date(e.createdAt, true)}</p></li>)}
      </ol>
    </div>
  );
};

/** Lacak pesanan tunai: status, pembayaran, pengiriman, kode pickup. */
export const OrderTrackPage: React.FC<{ onBack: () => void; initialOrderNo?: string; initialPhone?: string }> = ({ onBack, initialOrderNo, initialPhone }) => {
  const [orderNo, setOrderNo] = useState(initialOrderNo ?? '');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [t, setT] = useState<OrderTrack | null>(null);
  const L = useLocale();
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setError(null);
    try { setT(await api.get<OrderTrack>(`/public/orders/track${qs({ orderNo, phone })}`)); } catch (err) { setT(null); setError((err as ApiError).message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialOrderNo && initialPhone) load(); }, []);
  const pending = t?.payments.find((p) => p.status === 'pending');
  return (
    <Shell title={L.t('track.title')} subtitle={L.t('track.subtitle')} onBack={onBack}>
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <input required className={`${inputCls} font-mono uppercase`} placeholder="ORD-2610-00001" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
        <input required className={inputCls} placeholder={L.t('common.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className={`${btnPrimary} justify-center`}><Search className="w-4 h-4" /> {L.t('track.button')}</button>
      </form>
      <ErrorBox message={error} />
      {t && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-masri-light dark:bg-emerald-900/20"><p className="text-sm text-slate-500">{t.orderNo} · {L.date(t.createdAt, true)}</p>
            <p className="text-xl font-bold text-masri-dark dark:text-emerald-200">{L.t(`order.status.${t.status}`) === `order.status.${t.status}` ? t.statusLabel : L.t(`order.status.${t.status}`)}</p><p className="text-sm text-slate-600 dark:text-slate-300">{t.branch.name}</p></div>
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {t.items.map((i) => <tr key={i.name}><td className="py-1">{i.name} × {i.qty}</td><td className="text-right">{L.money(i.unitPrice * i.qty, t.currency)}</td></tr>)}
            {!!t.tax && <tr><td className="py-1 text-slate-500">{L.t('tax.' + ({ IDR: 'ID', MYR: 'MY', BND: 'BN' }[t.currency] ?? 'ID'))}</td><td className="text-right">{L.money(t.tax, t.currency)}</td></tr>}
            <tr><td className="py-1 text-slate-500">{L.t('common.shipping')}</td><td className="text-right">{L.money(t.shippingFee, t.currency)}</td></tr>
            <tr className="font-bold"><td className="py-1">{L.t('common.total')}</td><td className="text-right">{L.money(t.total, t.currency)}</td></tr>
          </tbody></table>
          {t.status === 'awaiting_payment' && <PaymentBox payment={pending ?? null} total={t.total} currency={t.currency} expiresAt={t.expiresAt} onPaid={load} />}
          {t.payments.filter((p) => p.status === 'paid').map((p) => (
            <button key={p.paymentNo} className={btnSecondary} onClick={() => printReceipt(p.paymentNo, phone).catch((e) => setError((e as Error).message))}><Printer className="w-4 h-4" />{L.t('common.receipt')} {p.paymentNo}</button>
          ))}
          {t.shipment && <ShipmentPublicView s={t.shipment} />}
        </div>
      )}
    </Shell>
  );
};
