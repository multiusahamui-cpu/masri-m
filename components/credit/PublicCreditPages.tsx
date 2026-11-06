import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, Search, Printer, BadgePercent } from 'lucide-react';
import { printReceipt } from '../../lib/print';
import { api, qs, ApiError } from '../../lib/api';
import { ErrorBox, inputCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { ApplyForm, ApplyPrefill } from './ApplyForm';
import { COUNTRY_OF_CURRENCY, PaymentBox, PayInfo, ShipmentPublic, ShipmentPublicView, usePaymentOptions } from '../shop/ShopPages';
import { useLocale } from '../../lib/i18n';

const Shell: React.FC<{ title: string; subtitle: string; onBack: () => void; children: React.ReactNode }> = ({ title, subtitle, onBack, children }) => {
  const { t } = useLocale();
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pt-24 pb-20 px-4">
      <div className="max-w-3xl mx-auto">
        <button onClick={onBack} className="flex items-center text-slate-600 dark:text-slate-300 hover:text-masri-primary font-medium mb-6"><ArrowLeft className="w-5 h-5 mr-2" /> {t('common.back')}</button>
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="bg-masri-primary p-6 md:p-8 text-white"><h1 className="text-2xl md:text-3xl font-bold mb-1">{title}</h1><p className="text-green-100">{subtitle}</p></div>
          <div className="p-6 md:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
};

/** Halaman publik pengajuan pembiayaan Murabahah. */
export const PublicCreditApplication: React.FC<{ onBack: () => void; onTrack: (appNo: string) => void; prefill?: ApplyPrefill }> = ({ onBack, onTrack, prefill }) => {
  const [done, setDone] = useState<string | null>(null);
  const { t } = useLocale();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <Shell title={t('apply.title')} subtitle={t('apply.subtitle')} onBack={onBack}>
      {done ? (
        <div className="text-center space-y-4 py-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto"><CheckCircle className="w-10 h-10 text-green-600" /></div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('apply.done')}</h2>
          <p className="text-slate-600 dark:text-slate-300">{t('apply.doneNo')}</p>
          <p className="text-2xl font-mono font-bold text-masri-primary">{done}</p>
          <p className="text-sm text-slate-500">{t('apply.doneNext')}</p>
          <button className={`${btnPrimary} mx-auto`} onClick={() => onTrack(done)}>{t('cta.track')}</button>
        </div>
      ) : <ApplyForm mode="public" prefill={prefill} onSubmitted={(r) => setDone(r.appNo)} />}
    </Shell>
  );
};

interface Track {
  appNo: string; statusLabel: string; status: string; customerName: string; product: string; branch: string; currency: string; submittedAt: string;
  terms: { tenor: number; downPayment: number; monthly: number; salePrice: number; marginPct: number } | null; contractNo: string | null;
  timeline: { status: string; label: string; at: string }[]; installments: { seq: number; dueDate: string; amount: number; status: string }[];
  dpDue: DpDueInfo | null;
}

/** Label langkah pengajuan sesuai bahasa (fallback ke label server). */
export const useStepLabel = () => {
  const { t } = useLocale();
  return (status: string, fallback: string) => { const k = `credit.status.${status}`; const v = t(k); return v === k ? fallback : v; };
};

/** Cek status pengajuan dengan nomor pengajuan + nomor HP. */
export const PublicCreditTrack: React.FC<{ onBack: () => void; initialAppNo?: string; initialPhone?: string }> = ({ onBack, initialAppNo, initialPhone }) => {
  const [appNo, setAppNo] = useState(initialAppNo ?? '');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [d, setD] = useState<Track | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, money, date } = useLocale();
  const step = useStepLabel();
  const load = async () => {
    setError(null);
    try {
      const [tr, ps] = await Promise.all([
        api.get<Track>(`/public/credit-applications/track${qs({ appNo, phone })}`),
        api.get<Position>(`/public/credit-applications/position${qs({ appNo, phone })}`),
      ]);
      setD(tr); setPos(ps);
    } catch (err) { setD(null); setError((err as ApiError).message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialAppNo && initialPhone) load(); }, []);
  const check = async (e: React.FormEvent) => { e.preventDefault(); await load(); };
  return (
    <Shell title={t('cta.track')} subtitle={t('ctrack.subtitle')} onBack={onBack}>
      <form onSubmit={check} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <input required className={`${inputCls} font-mono uppercase`} placeholder="APP-2610-00001" value={appNo} onChange={(e) => setAppNo(e.target.value)} />
        <input required className={inputCls} placeholder={t('common.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className={`${btnPrimary} justify-center`}><Search className="w-4 h-4" /> {t('ctrack.button')}</button>
      </form>
      <ErrorBox message={error} />
      {d && (
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-masri-light dark:bg-emerald-900/20">
            <p className="text-sm text-slate-500">{d.appNo} · {d.customerName}</p>
            <p className="text-xl font-bold text-masri-dark dark:text-emerald-200">{d.dpDue ? t('credit.status.dpDue') : step(d.status, d.statusLabel)}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{d.product} · {d.branch}</p>
          </div>
          {d.terms && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Box k={t('product.dp')} v={money(d.terms.downPayment, d.currency)} /><Box k={t('product.monthly')} v={`${money(d.terms.monthly, d.currency)} × ${d.terms.tenor}`} />
              <Box k={t('product.salePrice')} v={money(d.terms.salePrice, d.currency)} /><Box k={t('ctrack.contractNo')} v={d.contractNo ?? '—'} />
            </div>
          )}
          <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-3">
            {d.timeline.map((s, i) => <li key={i} className="ml-4"><span className="absolute -left-[7px] w-3 h-3 rounded-full bg-masri-primary" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{step(s.status, s.label)}</p><p className="text-xs text-slate-400">{date(s.at, true)}</p></li>)}
          </ol>
          {d.dpDue && <DpDueBox dp={d.dpDue} currency={d.currency} contractNo={d.contractNo} onPaid={load}
            onPay={async (method, bank) => { await api.post('/public/credit-applications/pay-dp', { appNo: d.appNo, phone, method, bank }); await load(); }} />}
          {pos?.shipment && <ShipmentPublicView s={pos.shipment} />}
          {pos?.position && d.status === 'active' && <PayInstallment appNo={d.appNo} phone={phone} currency={d.currency} pos={pos} onPaid={load} />}
          {!!pos?.receipts?.length && (
            <div className="space-y-1"><p className="text-xs font-bold uppercase text-slate-500">{t('ctrack.receipts')}</p>
              <div className="flex flex-wrap gap-2">{pos.receipts.map((r) => (
                <button key={r.paymentNo} className={btnSecondary} onClick={() => printReceipt(r.paymentNo, phone).catch((e) => setError((e as Error).message))}>
                  <Printer className="w-4 h-4" />{r.kind === 'down_payment' ? t('product.dp') : r.ibraAmount ? t('pay.settlement') : t('pay.installment')} · {money(r.amount + r.tazirAmount, d.currency)} · {date(r.paidAt, true)}</button>
              ))}</div></div>
          )}
          {d.installments.length > 0 && <ScheduleTable rows={d.installments} currency={d.currency} />}
        </div>
      )}
    </Shell>
  );
};

export const ScheduleTable: React.FC<{ rows: { seq: number; dueDate: string; amount: number; paidAmount?: number; status: string }[]; currency: string }> = ({ rows, currency }) => {
  const { t, money } = useLocale();
  const paidCol = rows.some((r) => r.paidAmount !== undefined);
  return (
    <table className="w-full text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="text-left py-1">{t('sched.no')}</th><th className="text-left py-1">{t('sched.due')}</th><th className="text-right py-1">{t('pay.installment')}</th>{paidCol && <th className="text-right py-1">{t('sched.paidAmount')}</th>}<th className="text-left py-1 pl-3">{t('sched.status')}</th></tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{rows.map((i) => (
        <tr key={i.seq}><td className="py-1">{i.seq}</td><td>{i.dueDate}</td><td className="text-right">{money(i.amount, currency)}</td>{paidCol && <td className="text-right">{i.paidAmount ? money(i.paidAmount, currency) : '—'}</td>}
          <td className={`pl-3 text-xs ${i.status === 'paid' ? 'text-green-700' : ''}`}>{t(`sched.${i.status}`) === `sched.${i.status}` ? t('sched.scheduled') : t(`sched.${i.status}`)}</td></tr>))}</tbody></table>
  );
};

const Box: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700"><p className="text-xs text-slate-500">{k}</p><p className="font-bold text-slate-800 dark:text-white">{v}</p></div>
);

export interface Position {
  position: { outstanding: number; overdueAmount: number; dpd: number; tazirDue: number; next: { seq: number; dueDate: string; amount: number } | null } | null;
  settlement: { payable: number; ibra: number; ibraPct: number; outstanding: number; validOn: string } | null;
  pendingPayments: (PayInfo & { tazirAmount: number; ibraAmount: number; expiresAt: string | null })[];
  shipment: ShipmentPublic | null;
  receipts: { paymentNo: string; kind: string; amount: number; tazirAmount: number; ibraAmount: number; method: string; paidAt: string }[];
}

export interface DpDueInfo { amount: number; downPayment: number | null; shippingFee: number | null; payment: (PayInfo & { channel: string; expiresAt: string | null }) | null }

/** Uang muka akad yang belum dibayar: bayar online atau di kasir cabang. */
export const DpDueBox: React.FC<{ dp: DpDueInfo; currency: string; contractNo: string | null; onPay: (method: 'va' | 'qris' | 'fpx', bank: string | null) => Promise<void>; onPaid: () => void }> = ({ dp, currency, contractNo, onPay, onPaid }) => {
  const { t, money } = useLocale();
  const payOpts = usePaymentOptions(COUNTRY_OF_CURRENCY[currency]);
  const methods = payOpts?.methods ?? [];
  const [method, setMethod] = useState<'va' | 'qris' | 'fpx'>('va');
  useEffect(() => { if (methods.length && !methods.includes(method)) setMethod(methods[0]); }, [methods, method]);
  const [bank, setBank] = useState('bca');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = dp.payment;
  const online = p && p.channel !== 'cashier';
  const pay = async () => { setBusy(true); setError(null); try { await onPay(method, method === 'va' ? bank : null); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); } };
  return (
    <div className="p-4 rounded-xl border-2 border-amber-300 dark:border-amber-700 space-y-3">
      <p className="font-semibold text-slate-800 dark:text-white">{t('dp.title', { no: contractNo ?? '' })}</p>
      <p className="text-sm">{t('dp.amount', { amount: money(dp.amount, currency), dp: money(dp.downPayment ?? 0, currency), fee: money(dp.shippingFee ?? 0, currency) })}</p>
      {online ? <PaymentBox payment={p} total={p.amount} currency={currency} expiresAt={p.expiresAt} onPaid={onPaid} />
        : <p className="text-sm p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20">{t('dp.atBranch', { no: contractNo ?? '' })}</p>}
      {methods.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end">
          <span className="text-xs text-slate-500 w-full">{online ? t('dp.changeMethod') : t('dp.payOnline')}</span>
          <select className={`${inputCls.replace('w-full', '')} w-40 shrink-0`} value={method} onChange={(e) => setMethod(e.target.value as 'va' | 'qris' | 'fpx')}>{methods.map((m) => <option key={m} value={m}>{t(`pay.method.${m}`)}</option>)}</select>
          {method === 'va' && <select className={`${inputCls.replace('w-full', '')} w-32 shrink-0`} value={bank} onChange={(e) => setBank(e.target.value)}>{(payOpts?.banks ?? []).map((b) => <option key={b.code} value={b.code}>VA {b.name}</option>)}</select>}
          <button className={btnPrimary} disabled={busy} onClick={pay}>{t('pay.payButton')}</button>
        </div>
      )}
      <ErrorBox message={error} />
    </div>
  );
};

/** Bayar angsuran via VA / QRIS / FPX dari halaman cek status atau Akun Saya. */
export const PayInstallment: React.FC<{ appNo: string; phone: string; currency: string; pos: Position; onPaid: () => void; payPath?: string }> = ({ appNo, phone, currency, pos, onPaid, payPath = '/public/credit-applications/pay' }) => {
  const p = pos.position!;
  const { t, money } = useLocale();
  const [amount, setAmount] = useState<number>(Math.max(p.overdueAmount, p.next?.amount ?? 0));
  const payOpts = usePaymentOptions(COUNTRY_OF_CURRENCY[currency]);
  const methods = payOpts?.methods ?? [];
  const [method, setMethod] = useState<'va' | 'qris' | 'fpx'>('va');
  useEffect(() => { if (methods.length && !methods.includes(method)) setMethod(methods[0]); }, [methods, method]);
  const [bank, setBank] = useState('bca');
  const [includeTazir, setIncludeTazir] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const create = async (settlement = false) => {
    setError(null);
    try { await api.post(payPath, { appNo, phone, amount, method, bank: method === 'va' ? bank : null, settlement, includeTazir: includeTazir && p.tazirDue > 0 }); onPaid(); } catch (e) { setError((e as ApiError).message); }
  };
  const s = pos.settlement;
  const pending = pos.pendingPayments[0];
  return (
    <div className="p-4 rounded-xl border border-masri-primary/40 space-y-3">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Box k={t('pay.outstanding')} v={money(p.outstanding, currency)} />
        <Box k={p.next ? t('pay.nextN', { n: p.next.seq, date: p.next.dueDate }) : t('pay.next')} v={p.next ? money(p.next.amount, currency) : '—'} />
        <Box k={p.dpd > 0 ? t('pay.overdueDays', { n: p.dpd }) : t('pay.overdue')} v={money(p.overdueAmount, currency)} />
      </div>
      {pending ? (<>
        {pending.ibraAmount > 0 && <p className="text-sm text-green-700">{t('pay.pendingIbra', { amount: money(pending.ibraAmount, currency) })}</p>}
        {pending.tazirAmount > 0 && <p className="text-xs text-amber-700">{t('pay.pendingTazir', { amount: money(pending.tazirAmount, currency) })}</p>}
        <PaymentBox payment={pending} total={pending.amount} currency={currency} expiresAt={pending.expiresAt} onPaid={onPaid} />
      </>) : methods.length === 0 ? (
        <p className="text-sm p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20">{t('pay.offlineOnly')}{payOpts?.transferInfo ? ` ${t('pay.transferInfo')}: ${payOpts.transferInfo}` : ''}</p>
      ) : (<>
        {p.tazirDue > 0 && (
          <label className="flex items-start gap-2 text-sm p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <input type="checkbox" className="mt-1" checked={includeTazir} onChange={(e) => setIncludeTazir(e.target.checked)} />
            <span>{t('pay.tazirNote', { amount: money(p.tazirDue, currency) })}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-500">{t('pay.amount')}<input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
          <select className={`${inputCls.replace("w-full", "")} w-40 shrink-0`} value={method} onChange={(e) => setMethod(e.target.value as 'va' | 'qris' | 'fpx')}>{methods.map((m) => <option key={m} value={m}>{t(`pay.method.${m}`)}</option>)}</select>
          {method === 'va' && <select className={`${inputCls.replace("w-full", "")} w-32 shrink-0`} value={bank} onChange={(e) => setBank(e.target.value)}>{(payOpts?.banks ?? []).map((b) => <option key={b.code} value={b.code}>VA {b.name}</option>)}</select>}
          <button className={btnPrimary} onClick={() => create(false)}>{t('pay.payButton')}</button>
        </div>
        {s && s.ibra > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm">
            <span><b>{t('pay.settleNow', { amount: money(s.payable, currency) })}</b> — {t('pay.settleSave', { amount: money(s.ibra, currency), pct: s.ibraPct })}</span>
            <button className={btnSecondary} onClick={() => create(true)}><BadgePercent className="w-4 h-4" />{t('pay.settleButton')}</button>
          </div>
        )}
      </>)}
      <ErrorBox message={error} />
    </div>
  );
};
