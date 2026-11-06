import React, { useCallback, useEffect, useState } from 'react';
import { User, FileSignature, ShoppingBag, LogOut, Printer, CalendarClock, AlertTriangle, CheckCircle2, ChevronRight, PlusCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { printContract, printFrom } from '../../lib/print';
import { customerSession, useCustomer } from '../../lib/customer';
import { ErrorBox, Spinner, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { useLocale } from '../../lib/i18n';
import { PayInfo, PaymentBox, Shell, ShipmentPublic, ShipmentPublicView } from '../shop/ShopPages';
import { DpDueBox, DpDueInfo, PayInstallment, Position, ScheduleTable, useStepLabel } from '../credit/PublicCreditPages';
import { CustomerLogin } from './CustomerLogin';

interface CreditRow { id: string; appNo: string; contractNo: string | null; status: string; statusLabel: string; product: string; branch: string; currency: string; monthly: number | null; tenor: number | null; createdAt: string; dpDue: DpDueInfo | null;
  position: { outstanding: number; overdueAmount: number; dpd: number; tazirDue: number; paidCount: number; next: { seq: number; dueDate: string; amount: number } | null } | null }
interface OrderRow { id: string; orderNo: string; status: string; statusLabel: string; currency: string; total: number; createdAt: string; expiresAt: string; items: { name: string; qty: number; unitPrice: number }[];
  payments: (PayInfo & { status: string; expiresAt: string | null; paidAt: string | null })[]; shipment: ShipmentPublic | null }
interface CreditDetail extends Position {
  dpDue: DpDueInfo | null;
  credit: { id: string; appNo: string; contractNo: string | null; status: string; statusLabel: string; currency: string; product: string; image: string | null;
    terms: { tenor: number; downPayment: number; monthly: number; salePrice: number; marginPct: number; cashPrice: number } | null; settledEarlyAt: string | null; ibraAmount: number };
  timeline: { status: string; label: string; at: string }[];
  installments: { seq: number; dueDate: string; amount: number; paidAmount: number; status: string }[];
}
type Tab = 'home' | 'credits' | 'orders' | 'profile';
const ACTIVE = ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted', 'active'];

/** Akun Saya: ringkasan, pembiayaan, pesanan, profil. */
export const CustomerAccount: React.FC<{ onBack: () => void; onApply: () => void }> = ({ onBack, onApply }) => {
  const me = useCustomer();
  const { t, money: formatMoney, date } = useLocale();
  const formatDateTime = (v: string | null) => date(v, true);
  const [tab, setTab] = useState<Tab>('home');
  const [credits, setCredits] = useState<CreditRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [openCredit, setOpenCredit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ credits: CreditRow[] }>('/customer/credits').then((r) => setCredits(r.credits)).catch((e) => setError((e as ApiError).message));
    api.get<{ orders: OrderRow[] }>('/customer/orders').then((r) => setOrders(r.orders)).catch((e) => setError((e as ApiError).message));
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (me === undefined) return <Shell title={t('nav.account')} onBack={onBack}><Spinner /></Shell>;
  if (me === null) return (
    <Shell title={t('nav.account')} subtitle={t('acct.subtitle')} onBack={onBack}>
      <div className="text-center space-y-4 py-6">
        <User className="w-12 h-12 mx-auto text-masri-primary" />
        <p className="text-slate-600 dark:text-slate-300">{t('acct.signinLead')}</p>
        <LoginButton />
      </div>
    </Shell>
  );

  const p = me.profile;
  const tabs: [Tab, string, React.ReactNode][] = [['home', t('acct.tab.home'), <User key="h" className="w-4 h-4" />], ['credits', t('acct.tab.credits'), <FileSignature key="c" className="w-4 h-4" />], ['orders', t('acct.tab.orders'), <ShoppingBag key="o" className="w-4 h-4" />], ['profile', t('acct.tab.profile'), <User key="p" className="w-4 h-4" />]];
  const activeCredits = credits?.filter((c) => c.status === 'active') ?? [];
  const pendingOrders = orders?.filter((o) => o.status === 'awaiting_payment') ?? [];

  return (
    <Shell title={`Assalamualaikum, ${p.needsName ? t('acct.customer') : p.fullName.split(' ')[0]}`} subtitle={`+${p.phone.replace(/^\+/, '')} · ${p.customerNo}`} onBack={onBack} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 items-center">
          {tabs.map(([k, l, i]) => <button key={k} onClick={() => { setTab(k); setOpenCredit(null); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border ${tab === k ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{i}{l}</button>)}
          <button className="ml-auto text-sm text-slate-500 inline-flex items-center gap-1 hover:text-red-600" onClick={() => customerSession.logout().then(onBack)}><LogOut className="w-4 h-4" />{t('acct.logout')}</button>
        </div>
        <ErrorBox message={error} onClose={() => setError(null)} />
        {p.needsName && tab !== 'profile' && <div className="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm dark:bg-amber-900/20 dark:text-amber-200">{t('acct.needName')} <button className="underline font-semibold" onClick={() => setTab('profile')}>{t('acct.tab.profile')}</button>.</div>}

        {tab === 'home' && (!credits || !orders ? <Spinner /> : (
          <div className="space-y-4">
            {activeCredits.map((c) => <CreditCard key={c.id} c={c} onOpen={() => { setTab('credits'); setOpenCredit(c.id); }} />)}
            {pendingOrders.map((o) => (
              <div key={o.id} className="p-4 rounded-xl border border-amber-300 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-800 flex items-center justify-between gap-3">
                <div><p className="font-semibold">{t('acct.awaiting', { no: o.orderNo })}</p><p className="text-sm text-slate-600 dark:text-slate-300">{formatMoney(o.total, o.currency)} · {t('acct.deadline')} {formatDateTime(o.expiresAt)}</p></div>
                <button className={btnPrimary} onClick={() => setTab('orders')}>{t('acct.pay')}</button>
              </div>
            ))}
            {!activeCredits.length && !pendingOrders.length && <p className="text-sm text-slate-500 text-center py-6">{t('acct.noBills')}</p>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <Stat k={t('acct.activeCredits')} v={String(activeCredits.length)} /><Stat k={t('pay.outstanding')} v={formatMoney(activeCredits.reduce((s, c) => s + (c.position?.outstanding ?? 0), 0), activeCredits[0]?.currency)} />
              <Stat k={t('acct.inProcess')} v={String(credits.filter((c) => ACTIVE.slice(0, 6).includes(c.status)).length)} /><Stat k={t('acct.tab.orders')} v={String(orders.length)} />
            </div>
            <button className={`${btnSecondary} mx-auto`} onClick={onApply}><PlusCircle className="w-4 h-4" />{t('acct.applyNewPrefill')}</button>
          </div>
        ))}

        {tab === 'credits' && (openCredit ? <CreditPanel id={openCredit} phone={p.phone} onBack={() => { setOpenCredit(null); load(); }} /> : !credits ? <Spinner /> : (
          <div className="space-y-3">
            {credits.map((c) => <CreditCard key={c.id} c={c} onOpen={() => setOpenCredit(c.id)} />)}
            {!credits.length && <p className="text-sm text-slate-500 text-center py-6">{t('acct.noCredits')}</p>}
            <button className={`${btnSecondary} mx-auto`} onClick={onApply}><PlusCircle className="w-4 h-4" />{t('acct.applyNew')}</button>
          </div>
        ))}

        {tab === 'orders' && (!orders ? <Spinner /> : (
          <div className="space-y-3">
            {orders.map((o) => <OrderCard key={o.id} o={o} onChanged={load} />)}
            {!orders.length && <p className="text-sm text-slate-500 text-center py-6">{t('acct.noOrders')}</p>}
          </div>
        ))}

        {tab === 'profile' && <ProfileForm me={me} />}
      </div>
    </Shell>
  );
};

export const LoginButton: React.FC<{ className?: string; label?: string; onDone?: () => void }> = ({ className = btnPrimary, label, onDone }) => {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  label ??= t('acct.signinWa');
  return <>
    <button className={`${className} mx-auto`} onClick={() => setOpen(true)}>{label}</button>
    {open && <CustomerLogin onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone?.(); }} />}
  </>;
};

const Stat: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700"><p className="font-bold text-slate-800 dark:text-white">{v}</p><p className="text-xs text-slate-500">{k}</p></div>
);

const CreditCard: React.FC<{ c: CreditRow; onOpen: () => void }> = ({ c, onOpen }) => {
  const pos = c.position;
  const { t, money: formatMoney, date } = useLocale();
  const formatDateTime = (v: string | null) => date(v, true);
  const step = useStepLabel();
  return (
    <button onClick={onOpen} className="w-full text-left p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-masri-primary transition-colors flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 dark:text-white truncate">{c.product}</p>
        <p className="text-xs text-slate-500">{c.contractNo ?? c.appNo} · {c.dpDue ? t('credit.status.dpDue') : step(c.status, c.statusLabel)}</p>
        {c.dpDue && <p className="text-sm text-amber-700 mt-1">{t('dp.title', { no: c.contractNo ?? '' })}: {formatMoney(c.dpDue.amount, c.currency)}</p>}
        {pos && (pos.dpd > 0
          ? <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('pay.overdue')} {formatMoney(pos.overdueAmount, c.currency)} ({t('acct.days', { n: pos.dpd })}){pos.tazirDue ? ` + ta'zir ${formatMoney(pos.tazirDue, c.currency)}` : ''}</p>
          : pos.next && <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 flex items-center gap-1"><CalendarClock className="w-4 h-4" />{t('acct.nextN', { n: pos.next.seq })} {formatMoney(pos.next.amount, c.currency)} · {pos.next.dueDate}</p>)}
        {c.status === 'paid_off' && <p className="text-sm text-green-700 mt-1 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{t('sched.paid_off')}</p>}
      </div>
      {pos && <div className="text-right"><p className="text-xs text-slate-500">{t('acct.remaining')}</p><p className="font-bold">{formatMoney(pos.outstanding, c.currency)}</p><p className="text-[11px] text-slate-400">{pos.paidCount}/{c.tenor} {t('acct.paidCount')}</p></div>}
      <ChevronRight className="w-5 h-5 text-slate-400" />
    </button>
  );
};

const CreditPanel: React.FC<{ id: string; phone: string; onBack: () => void }> = ({ id, phone, onBack }) => {
  const [d, setD] = useState<CreditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, money: formatMoney, date, lang } = useLocale();
  const formatDateTime = (v: string | null) => date(v, true);
  const step = useStepLabel();
  const load = useCallback(() => { api.get<CreditDetail>(`/customer/credits/${id}`).then(setD).catch((e) => setError((e as ApiError).message)); }, [id]);
  useEffect(load, [load]);
  if (!d) return error ? <ErrorBox message={error} /> : <Spinner />;
  const c = d.credit, cur = c.currency;
  return (
    <div className="space-y-4">
      <button className="text-sm text-slate-500 underline" onClick={onBack}>← {t('acct.allCredits')}</button>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <div className="p-4 rounded-xl bg-masri-light dark:bg-emerald-900/20 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">{c.contractNo ?? c.appNo}</p><p className="text-xl font-bold text-masri-dark dark:text-emerald-200">{c.product}</p><p className="text-sm">{d.dpDue ? t('credit.status.dpDue') : step(c.status, c.statusLabel)}{c.settledEarlyAt ? ` · ${t('acct.settledEarly', { amount: formatMoney(c.ibraAmount, cur) })}` : ''}</p></div>
        {c.contractNo && <button className={btnSecondary} onClick={() => printContract(`/customer/credits/${c.id}/contract?lang=${lang}`).catch((e) => setError((e as Error).message))}><Printer className="w-4 h-4" />{t('acct.contract')}</button>}
      </div>
      {c.terms && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat k={t('product.dp')} v={formatMoney(c.terms.downPayment, cur)} /><Stat k={t('product.monthly')} v={`${formatMoney(c.terms.monthly, cur)} × ${c.terms.tenor}`} />
          <Stat k={t('product.salePrice')} v={formatMoney(c.terms.salePrice, cur)} /><Stat k={t('acct.marginAgreed')} v={`${c.terms.marginPct}%`} />
        </div>
      )}
      {d.dpDue && <DpDueBox dp={d.dpDue} currency={cur} contractNo={c.contractNo} onPaid={load}
        onPay={async (method, bank) => { await api.post(`/customer/credits/${c.id}/pay-dp`, { method, bank }); await load(); }} />}
      {d.position && c.status === 'active' && <PayInstallment appNo={c.appNo} phone={phone} currency={cur} pos={d} onPaid={load} payPath={`/customer/credits/${c.id}/pay`} />}
      {d.shipment && <ShipmentPublicView s={d.shipment} />}
      {!!d.receipts?.length && (
        <div className="space-y-1"><p className="text-xs font-bold uppercase text-slate-500">{t('common.receipt')}</p>
          <div className="flex flex-wrap gap-2">{d.receipts.map((r) => (
            <button key={r.paymentNo} className={btnSecondary} onClick={() => printFrom(`/customer/receipts/${r.paymentNo}`).catch((e) => setError((e as Error).message))}>
              <Printer className="w-4 h-4" />{r.kind === 'down_payment' ? t('product.dp') : r.ibraAmount ? t('pay.settlement') : t('pay.installment')} · {formatMoney(r.amount + r.tazirAmount, cur)} · {formatDateTime(r.paidAt)}</button>))}</div></div>
      )}
      {d.installments.length > 0 && <ScheduleTable rows={d.installments} currency={cur} />}
      <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-2">
        {d.timeline.map((tl, i) => <li key={i} className="ml-4"><span className="absolute -left-[7px] w-3 h-3 rounded-full bg-masri-primary" /><p className="text-sm font-semibold">{step(tl.status, tl.label)}</p><p className="text-xs text-slate-400">{formatDateTime(tl.at)}</p></li>)}
      </ol>
    </div>
  );
};

const OrderCard: React.FC<{ o: OrderRow; onChanged: () => void }> = ({ o, onChanged }) => {
  const pending = o.payments.find((p) => p.status === 'pending');
  const { t, money: formatMoney, date } = useLocale();
  const formatDateTime = (v: string | null) => date(v, true);
  const statusLabel = t(`order.status.${o.status}`) === `order.status.${o.status}` ? o.statusLabel : t(`order.status.${o.status}`);
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{o.orderNo} <span className="text-sm font-normal text-slate-500">· {formatDateTime(o.createdAt)}</span></p><p className="text-sm font-semibold text-masri-dark dark:text-emerald-200">{statusLabel}</p></div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')} · <b>{formatMoney(o.total, o.currency)}</b></p>
      {o.status === 'awaiting_payment' && <PaymentBox payment={pending ?? null} total={o.total} currency={o.currency} expiresAt={o.expiresAt} onPaid={onChanged} />}
      {o.shipment && <ShipmentPublicView s={o.shipment} />}
      <div className="flex flex-wrap gap-2">{o.payments.filter((p) => p.status === 'paid').map((p) => (
        <button key={p.paymentNo} className={btnSecondary} onClick={() => printFrom(`/customer/receipts/${p.paymentNo}`)}><Printer className="w-4 h-4" />{t('common.receipt')} {p.paymentNo}</button>))}</div>
    </div>
  );
};

const ProfileForm: React.FC<{ me: NonNullable<ReturnType<typeof useCustomer>> }> = ({ me }) => {
  const p = me.profile;
  const [f, setF] = useState({ fullName: p.needsName ? '' : p.fullName, email: p.email ?? '', city: p.city, address: p.address });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  const save = async () => {
    setError(null); setMsg(null);
    try { await api.patch('/customer/me', { ...f, fullName: f.fullName || undefined, email: f.email || null }); await customerSession.refresh(); setMsg(t('acct.saved')); } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <div className="space-y-3 max-w-xl">
      <ErrorBox message={error} />
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div><label className={labelCls}>{t('apply.fullName')} {p.kycVerified && <span className="text-xs text-green-700">({t('acct.kycVerified')})</span>}</label><input className={inputCls} disabled={p.kycVerified} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
      <div><label className={labelCls}>{t('acct.email')}</label><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-2"><div><label className={labelCls}>{t('apply.city')}</label><input className={inputCls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        <div className="col-span-2"><label className={labelCls}>{t('apply.address')}</label><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div></div>
      <p className="text-xs text-slate-500">{t('acct.phoneNote', { phone: `+${p.phone.replace(/^\+/, '')}` })}</p>
      <button className={btnPrimary} onClick={save}>{t('common.save')}</button>
      <OptInToggle initial={!!p.marketingOptIn} />
      <PrivacyBox />
    </div>
  );
};

/** Persetujuan menerima promo (bisa dicabut kapan saja; dicatat sebagai bukti persetujuan). */
const OptInToggle: React.FC<{ initial: boolean }> = ({ initial }) => {
  const { t } = useLocale();
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const change = async (v: boolean) => {
    setOn(v); setMsg(null);
    try { await api.patch('/customer/me', { marketingOptIn: v }); await customerSession.refresh(); setMsg(t('promo.optInSaved')); } catch (e) { setOn(!v); setMsg((e as ApiError).message); }
  };
  return (
    <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
      <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
        <input type="checkbox" className="w-4 h-4" checked={on} onChange={(e) => change(e.target.checked)} />{t('promo.optInAccount')}
      </label>
      {msg && <p className="text-xs text-slate-500 mt-1">{msg}</p>}
    </div>
  );
};

/** Hak atas data pribadi: unduh salinan data & ajukan penghapusan (UU PDP / PDPA). */
const PrivacyBox: React.FC = () => {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setError(null);
    try {
      const data = await api.get<unknown>('/customer/privacy/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `data-saya-masri-m-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const requestDelete = async () => {
    if (!window.confirm(t('acct.requestDeleteConfirm'))) return;
    setBusy(true); setError(null);
    try { const r = await api.post<{ ticketNo: string }>('/customer/privacy/request', { type: 'delete' }); setMsg(t('acct.requestSent', { no: r.ticketNo })); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-8 pt-5 border-t border-slate-200 dark:border-slate-700 space-y-2">
      <h4 className="font-semibold text-slate-800 dark:text-white">{t('acct.privacyTitle')}</h4>
      <p className="text-xs text-slate-500">{t('acct.privacyDesc')}</p>
      <ErrorBox message={error} />
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} disabled={busy} onClick={download}>{t('acct.downloadData')}</button>
        <button className={`${btnSecondary} text-red-600`} disabled={busy || !!msg} onClick={requestDelete}>{t('acct.requestDelete')}</button>
      </div>
    </div>
  );
};
