import React, { useCallback, useEffect, useState } from 'react';
import { Banknote, Search, Receipt, ShoppingBag, AlertTriangle, CheckCircle, Printer, BadgePercent } from 'lucide-react';
import { printReceipt, printVoucher } from '../../lib/print';
import { ShiftBanner } from '../finance/Shift';
import { api, qs, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

interface CreditRow { id: string; appNo: string; contractNo: string | null; monthly: number; tenor: number; currency: string; customerName: string; phone: string | null; productName: string; branchName: string; outstanding: number; overdueAmount: number; dpd: number; nextDue: string | null; nextAmount: number; paidCount: number }
interface PaymentRow { id: string; paymentNo: string; kind: string; refNo: string; amount: number; tazirAmount: number; ibraAmount: number; method: string; status: string; channel: string; vaNumber: string | null; paidAt: string | null; createdAt: string; branchName: string; receivedByName: string | null; proofRef: string | null }
interface OrderRow { id: string; orderNo: string; status: string; total: number; currency: string; recipientName: string; recipientPhone: string; deliveryMode: string; items: string; expiresAt: string; createdAt: string; branchName: string }

const METHOD: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer', va: 'Virtual Account', qris: 'QRIS' };
const KIND: Record<string, string> = { installment: 'Angsuran', order: 'Order', down_payment: 'Uang muka' };
interface Quote { outstanding: number; overdueAmount: number; futureInstallments: number; unearnedMargin: number; ibraPct: number; ibra: number; payable: number; tazirDue: number; validOn: string }
interface TazirCharge { id: string; amount: number; assessedOn: string; status: string; waiveReason: string | null }
const ORDER_STATUS: Record<string, string> = { awaiting_payment: 'Menunggu bayar', paid: 'Dibayar', fulfilling: 'Diproses / dikirim', completed: 'Selesai', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa' };

/** Kasir: angsuran, order tunai, laporan kas harian. */
export const CashierModule: React.FC<{ menu: string; currentUser: AuthUser; onGoShift?: () => void }> = ({ menu, currentUser, onGoShift }) => {
  if (menu === 'verify') return <CashierOrders currentUser={currentUser} onGoShift={onGoShift} />;
  if (menu === 'downpayments') return <CashierDownPayments currentUser={currentUser} onGoShift={onGoShift} />;
  if (menu === 'record' || menu === 'installment') return <CashierInstallments currentUser={currentUser} dueMode={menu === 'installment'} onGoShift={onGoShift} />;
  return <CashReport currentUser={currentUser} />;
};

interface DpRow { id: string; appNo: string; contractNo: string; currency: string; amount: number; downPayment: number; shippingFee: number | null; signedAt: string; customerName: string; phone: string | null; productName: string; branchName: string; pendingNo: string | null; pendingChannel: string | null }

/** Uang muka akad: akad ditandatangani AO / Manager Cabang, uang muka + ongkir diterima Kasir (tunai masuk shift). */
const CashierDownPayments: React.FC<{ currentUser: AuthUser; onGoShift?: () => void }> = ({ currentUser, onGoShift }) => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DpRow[] | null>(null);
  const [open, setOpen] = useState<DpRow | null>(null);
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [proofRef, setProofRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => api.get<{ downPayments: DpRow[] }>(`/cashier/down-payments${qs({ search })}`).then((r) => setRows(r.downPayments)).catch((e) => setError((e as ApiError).message)), 250);
    return () => clearTimeout(t);
  }, [search, key]);
  const pay = async () => {
    if (!open) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ payment: { paymentNo: string } }>(`/cashier/down-payments/${open.id}/pay`, { method, proofRef: proofRef || null });
      setDone(r.payment.paymentNo); setOpen(null); setProofRef(''); setKey((k) => k + 1);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const channelLabel = (c: string | null) => !c ? '—' : c.startsWith('cashier') ? 'Bayar di kasir' : `Online ${c.split(':')[1]?.toUpperCase()} (belum dibayar)`;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Banknote className="w-6 h-6" />} title="Terima Uang Muka Akad"
        subtitle="Akad yang sudah ditandatangani AO / Manager Cabang. Akad berlaku dan pengiriman dibuat otomatis setelah uang muka + ongkir diterima." />
      {currentUser.roleCode === 'cashier' && <ShiftBanner onGo={onGoShift} />}
      {done && <div className="p-3 rounded-lg bg-green-50 text-green-800 text-sm flex items-center justify-between">Uang muka diterima ({done}). Akad berlaku, pengiriman dibuat.
        <button className={btnSecondary} onClick={() => printReceipt(done)}><Printer className="w-4 h-4" />Kuitansi</button></div>}
      <Card className="p-4"><div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={`${inputCls} pl-9`} placeholder="Cari no. akad / pengajuan, nama atau HP nasabah..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></Card>
      <ErrorBox message={error} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Nasabah</th><th className="text-left px-4 py-3">Akad</th>
              <th className="text-right px-4 py-3">Uang muka</th><th className="text-right px-4 py-3">Ongkir</th><th className="text-right px-4 py-3">Total</th><th className="text-left px-4 py-3">Tagihan</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-white">{r.customerName}</p><p className="text-xs text-slate-500">{r.phone} · {r.productName}</p></td>
                  <td className="px-4 py-3 font-mono text-xs">{r.contractNo}<span className="block text-slate-400">{formatDateTime(r.signedAt)}</span></td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.downPayment, r.currency)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.shippingFee ?? 0, r.currency)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(r.amount, r.currency)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{channelLabel(r.pendingChannel)}</td>
                  <td className="px-4 py-3 text-right">{currentUser.roleCode === 'cashier' && <button className={btnPrimary} onClick={() => { setOpen(r); setError(null); }}>Terima</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">Tidak ada uang muka yang menunggu.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {open && (
        <Modal title={`Terima Uang Muka ${open.contractNo}`} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <p className="text-sm">{open.customerName} — {open.productName}</p>
            <p className="text-2xl font-bold">{formatMoney(open.amount, open.currency)}</p>
            <p className="text-xs text-slate-500">Uang muka {formatMoney(open.downPayment, open.currency)} + ongkir {formatMoney(open.shippingFee ?? 0, open.currency)}. Nominal harus diterima penuh.</p>
            <div className="grid grid-cols-2 gap-2">
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')}><option value="cash">Tunai (masuk shift)</option><option value="transfer">Transfer bank</option></select>
              {method === 'transfer' && <input className={inputCls} placeholder="No. referensi transfer" value={proofRef} onChange={(e) => setProofRef(e.target.value)} />}
            </div>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={() => setOpen(null)}>Batal</button>
              <button className={btnPrimary} disabled={busy || (method === 'transfer' && !proofRef)} onClick={pay}>Terima {formatMoney(open.amount, open.currency)}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const CashierInstallments: React.FC<{ currentUser: AuthUser; dueMode: boolean; onGoShift?: () => void }> = ({ currentUser, dueMode, onGoShift }) => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CreditRow[] | null>(null);
  const [open, setOpen] = useState<CreditRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const load = useCallback(() => {
    api.get<{ credits: CreditRow[] }>(`/cashier/credits${qs({ search })}`).then((r) => setRows(dueMode ? r.credits.filter((c) => c.dpd > 0 || (c.nextDue && c.nextDue <= new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10))) : r.credits))
      .catch((e) => setError((e as ApiError).message));
  }, [search, dueMode]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, key]);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Banknote className="w-6 h-6" />} title={dueMode ? 'Angsuran Jatuh Tempo' : 'Terima Pembayaran Angsuran'}
        subtitle={dueMode ? 'Pembiayaan yang menunggak atau jatuh tempo 7 hari ke depan.' : `Cari pembiayaan aktif ${currentUser.branch?.name ?? ''} lalu catat pembayaran tunai / transfer. Pembayaran dialokasikan ke angsuran tertua.`} />
      {currentUser.roleCode === 'cashier' && <ShiftBanner onGo={onGoShift} />}
      <Card className="p-4"><div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={`${inputCls} pl-9`} placeholder="Cari no. akad / pengajuan, nama atau HP nasabah..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></Card>
      <ErrorBox message={error} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Nasabah</th><th className="text-left px-4 py-3">Akad</th>
              <th className="text-right px-4 py-3">Angsuran berikut</th><th className="text-right px-4 py-3">Tunggakan</th><th className="text-right px-4 py-3">Sisa</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id} className={r.dpd > 0 ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-white">{r.customerName}</p><p className="text-xs text-slate-500">{r.phone} · {r.productName}</p></td>
                  <td className="px-4 py-3 font-mono text-xs">{r.contractNo}<span className="block text-slate-400">{r.paidCount}/{r.tenor} lunas</span></td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.nextAmount, r.currency)}<span className="block text-xs text-slate-500">{r.nextDue}</span></td>
                  <td className="px-4 py-3 text-right">{r.dpd > 0 ? <span className="text-red-600 font-semibold">{formatMoney(r.overdueAmount, r.currency)}<span className="block text-xs">{r.dpd} hari</span></span> : '—'}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.outstanding, r.currency)}</td>
                  <td className="px-4 py-3 text-right">{currentUser.roleCode === 'cashier' && <button className={btnPrimary} onClick={() => setOpen(r)}>Terima</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Tidak ada data.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {open && <PayModal credit={open} onClose={() => setOpen(null)} onPaid={() => { setOpen(null); setKey((k) => k + 1); }} />}
    </div>
  );
};

const PayModal: React.FC<{ credit: CreditRow; onClose: () => void; onPaid: () => void }> = ({ credit, onClose, onPaid }) => {
  const [info, setInfo] = useState<{ tazirDue: number; settlement: Quote | null; payments: PaymentRow[]; position: { tazirCharges: TazirCharge[] } } | null>(null);
  const [mode, setMode] = useState<'installment' | 'settlement'>('installment');
  const [amount, setAmount] = useState(Math.max(credit.overdueAmount, credit.nextAmount));
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [proofRef, setProofRef] = useState('');
  const [payTazir, setPayTazir] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { api.get<NonNullable<typeof info>>(`/cashier/credits/${credit.id}`).then(setInfo).catch(() => undefined); }, [credit.id]);
  const tazir = info?.tazirDue ?? 0;
  const q = info?.settlement ?? null;
  const base = mode === 'settlement' ? (q?.payable ?? 0) : amount;
  const total = base + (payTazir ? tazir : 0);
  const pay = async () => {
    setBusy(true); setError(null);
    try {
      const body = mode === 'settlement' ? { settlement: true, method, proofRef: proofRef || null, payTazir } : { amount, method, proofRef: proofRef || null, payTazir };
      const r = await api.post<{ payment: { paymentNo: string } }>(`/cashier/credits/${credit.id}/pay`, body); setDone(r.payment.paymentNo);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pembayaran · ${credit.customerName}`} onClose={done ? onPaid : onClose}>
      {done ? (
        <div className="text-center space-y-3 py-4"><CheckCircle className="w-12 h-12 text-green-600 mx-auto" /><p className="font-bold">{mode === 'settlement' ? 'Pelunasan tercatat — akad LUNAS' : 'Pembayaran tercatat'}</p><p className="font-mono text-masri-primary">{done}</p>
          <div className="flex justify-center gap-2"><button className={btnSecondary} onClick={() => printReceipt(done).catch((e) => setError((e as Error).message))}><Printer className="w-4 h-4" />Cetak Kwitansi</button>
            <button className={btnPrimary} onClick={onPaid}>Selesai</button></div></div>
      ) : (
        <div className="space-y-3">
          <ErrorBox message={error} />
          <p className="text-sm text-slate-600 dark:text-slate-300">Akad {credit.contractNo} · sisa {formatMoney(credit.outstanding, credit.currency)}{credit.dpd > 0 ? ` · menunggak ${credit.dpd} hari` : ''}</p>
          <div className="flex gap-2">
            <button className={mode === 'installment' ? btnPrimary : btnSecondary} onClick={() => setMode('installment')}>Angsuran</button>
            <button className={mode === 'settlement' ? btnPrimary : btnSecondary} disabled={!q} onClick={() => setMode('settlement')}><BadgePercent className="w-4 h-4" />Pelunasan dipercepat</button>
          </div>
          {mode === 'installment' ? (
            <div><label className={labelCls}>Nominal angsuran</label><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          ) : q && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm space-y-1">
              <p className="flex justify-between"><span>Sisa kewajiban</span><b>{formatMoney(q.outstanding)}</b></p>
              <p className="flex justify-between text-slate-600 dark:text-slate-300"><span>Margin belum jatuh tempo ({q.futureInstallments} angsuran)</span><span>{formatMoney(q.unearnedMargin)}</span></p>
              <p className="flex justify-between text-green-700"><span>Potongan ibra' ({q.ibraPct}%)</span><b>− {formatMoney(q.ibra)}</b></p>
              <p className="flex justify-between text-base border-t border-green-200 pt-1"><span>Dibayar untuk lunas</span><b>{formatMoney(q.payable)}</b></p>
              <p className="text-[11px] text-slate-500">Berlaku hari ini ({q.validOn}). Angsuran menunggak tetap dibayar penuh.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>Metode</label><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')}><option value="cash">Tunai</option><option value="transfer">Transfer bank</option></select></div>
            <div><label className={labelCls}>No. referensi {method === 'transfer' && '*'}</label><input className={inputCls} value={proofRef} onChange={(e) => setProofRef(e.target.value)} /></div>
          </div>
          {tazir > 0 ? (
            <label className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
              <input type="checkbox" className="mt-1" checked={payTazir} onChange={(e) => setPayTazir(e.target.checked)} />
              <span>Sertakan ta'zir keterlambatan <b>{formatMoney(tazir)}</b> ({info?.position.tazirCharges.filter((c) => c.status === 'unpaid').length} angsuran terlambat). Dicatat terpisah sebagai dana sosial, bukan pendapatan.</span>
            </label>
          ) : <p className="text-[11px] text-slate-500">Tidak ada ta'zir terutang.</p>}
          <p className="text-right text-lg">Total diterima: <b>{formatMoney(total)}</b></p>
          <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={busy || base <= 0} onClick={pay}>{mode === 'settlement' ? 'Proses Pelunasan' : 'Simpan Pembayaran'}</button></div>
          {info && info.payments.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700"><p className="text-xs font-bold uppercase text-slate-500 mb-1">Riwayat</p>
              {info.payments.slice(0, 5).map((p) => <p key={p.id} className="text-xs text-slate-600 dark:text-slate-300 flex justify-between"><span>{formatDateTime(p.paidAt ?? p.createdAt)} · {formatMoney(p.amount)} · {METHOD[p.method]} · {p.status}</span>
                {p.status === 'paid' && <button className="underline text-masri-primary" onClick={() => printReceipt(p.paymentNo)}>kwitansi</button>}</p>)}</div>
          )}
        </div>
      )}
    </Modal>
  );
};

const CashierOrders: React.FC<{ currentUser: AuthUser; onGoShift?: () => void }> = ({ currentUser, onGoShift }) => {
  const [lastPaid, setLastPaid] = useState<string | null>(null);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [statuses, setStatuses] = useState('awaiting_payment');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [payFor, setPayFor] = useState<OrderRow | null>(null);
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [ref, setRef] = useState('');
  useEffect(() => {
    const t = setTimeout(() => api.get<{ orders: OrderRow[] }>(`/orders${qs({ statuses, search })}`).then((r) => setRows(r.orders)).catch((e) => setError((e as ApiError).message)), 250);
    return () => clearTimeout(t);
  }, [statuses, search, key]);
  const act = async (path: string, body: unknown) => {
    setError(null);
    try { const r = await api.post<{ payment?: { paymentNo: string } }>(path, body); if (r.payment) setLastPaid(r.payment.paymentNo); setPayFor(null); setRef(''); setKey((k) => k + 1); } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<ShoppingBag className="w-6 h-6" />} title="Order Tunai" subtitle="Terima pembayaran order yang memilih 'bayar di kasir', pantau order VA/QRIS, dan batalkan order yang tidak jadi dibayar." />
      <Card className="p-4 flex flex-wrap gap-3 items-center">
        {[['awaiting_payment', 'Menunggu bayar'], ['fulfilling', 'Diproses'], ['completed', 'Selesai'], ['cancelled,expired', 'Batal / kedaluwarsa']].map(([k, v]) => (
          <button key={k} onClick={() => setStatuses(k)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${statuses === k ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{v}</button>
        ))}
        <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Cari no. order / nama / HP" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>
      {currentUser.roleCode === 'cashier' && <ShiftBanner onGo={onGoShift} />}
      <ErrorBox message={error} onClose={() => setError(null)} />
      {lastPaid && <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-900/20 dark:text-green-200 dark:border-green-800">
        <span>Pembayaran {lastPaid} tercatat — pengiriman otomatis dibuat.</span><button className={btnSecondary} onClick={() => printReceipt(lastPaid)}><Printer className="w-4 h-4" />Cetak Kwitansi</button></div>}
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Order</th><th className="text-left px-4 py-3">Pemesan</th><th className="text-left px-4 py-3">Barang</th><th className="text-right px-4 py-3">Total</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-mono text-xs">{o.orderNo}<span className="block text-slate-400">{formatDateTime(o.createdAt)}</span></td>
                  <td className="px-4 py-3">{o.recipientName}<span className="block text-xs text-slate-500">{o.recipientPhone}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{o.items}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(o.total, o.currency)}</td>
                  <td className="px-4 py-3 text-xs">{ORDER_STATUS[o.status]}{o.status === 'awaiting_payment' && <span className="block text-slate-400">s/d {formatDateTime(o.expiresAt)}</span>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{o.status === 'awaiting_payment' && currentUser.roleCode === 'cashier' && (<>
                    <button className={btnPrimary} onClick={() => setPayFor(o)}>Terima</button>
                    <button className="ml-2 text-xs text-red-600 underline" onClick={() => { const r = window.prompt('Alasan pembatalan?'); if (r) act(`/orders/${o.id}/cancel`, { reason: r }); }}>Batalkan</button></>)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Tidak ada order.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {payFor && (
        <Modal title={`Terima Pembayaran ${payFor.orderNo}`} onClose={() => setPayFor(null)}>
          <div className="space-y-3">
            <p className="text-2xl font-bold text-center">{formatMoney(payFor.total, payFor.currency)}</p>
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')}><option value="cash">Tunai</option><option value="transfer">Transfer bank</option></select>
            {method === 'transfer' && <input className={inputCls} placeholder="No. referensi transfer" value={ref} onChange={(e) => setRef(e.target.value)} />}
            <button className={`${btnPrimary} w-full justify-center`} onClick={() => act(`/orders/${payFor.id}/pay`, { method, proofRef: ref || null })}>Konfirmasi Lunas</button>
            <p className="text-[11px] text-slate-500">Setelah lunas, pengiriman otomatis dibuat untuk lokasi stok.</p>
          </div>
        </Modal>
      )}
    </div>
  );
};

const CashReport: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [d, setD] = useState<{ payments: PaymentRow[]; outflows: { id: string; no: string; label: string; amount: number; method: string; at: string; type: 'expense' | 'refund' }[];
    totals: { count: number; amount: number; tazir: number; ibra: number; byMethod: Record<string, number>; installment: number; order: number; downPayment: number; outflow: number; cashOutflow: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<NonNullable<typeof d>>(`/payments?date=${date}`).then(setD).catch((e) => setError((e as ApiError).message)); }, [date]);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Receipt className="w-6 h-6" />} title={`Laporan Kas Harian — ${currentUser.branch?.name ?? ''}`} subtitle="Rekap penerimaan per metode untuk rekonsiliasi kas & rekening. Ta'zir dicatat terpisah sebagai dana sosial." />
      <Card className="p-4 flex items-center gap-3"><span className="text-sm font-semibold">Tanggal</span><input type="date" className={`${inputCls} max-w-xs`} value={date} onChange={(e) => setDate(e.target.value)} /></Card>
      <ErrorBox message={error} />
      {!d ? <Spinner /> : (<>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Tile k="Total diterima" v={formatMoney(d.totals.amount)} sub={`${d.totals.count} transaksi`} />
          <Tile k="Angsuran" v={formatMoney(d.totals.installment)} /><Tile k="Order tunai" v={formatMoney(d.totals.order)} /><Tile k="Uang muka akad" v={formatMoney(d.totals.downPayment)} />
          {Object.entries(d.totals.byMethod).map(([k, v]) => <Tile key={k} k={METHOD[k] ?? k} v={formatMoney(Number(v))} />)}
          <Tile k="Ta'zir (dana sosial)" v={formatMoney(d.totals.tazir)} />
          <Tile k="Ibra' pelunasan (potongan)" v={formatMoney(d.totals.ibra)} />
          <Tile k="Kas keluar (biaya & refund)" v={formatMoney(d.totals.outflow)} sub={`tunai ${formatMoney(d.totals.cashOutflow)}`} />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Waktu</th><th className="text-left px-4 py-3">No.</th><th className="text-left px-4 py-3">Untuk</th>
              <th className="text-left px-4 py-3">Metode</th><th className="text-right px-4 py-3">Nominal</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Petugas</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.payments.map((p) => (
                <tr key={p.id} className={p.status !== 'paid' ? 'opacity-60' : ''}>
                  <td className="px-4 py-2 text-xs">{formatDateTime(p.paidAt ?? p.createdAt)}</td><td className="px-4 py-2 font-mono text-xs">{p.paymentNo}</td>
                  <td className="px-4 py-2 text-xs">{KIND[p.kind] ?? p.kind} {p.refNo}{p.ibraAmount ? <span className="block text-green-700">pelunasan · ibra' {formatMoney(p.ibraAmount)}</span> : null}</td><td className="px-4 py-2 text-xs">{METHOD[p.method]}{p.proofRef ? ` · ${p.proofRef}` : ''}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(p.amount)}{p.tazirAmount ? <span className="block text-[11px] text-amber-600">+ ta'zir {formatMoney(p.tazirAmount)}</span> : null}</td>
                  <td className="px-4 py-2 text-xs">{p.status}</td><td className="px-4 py-2 text-xs">{p.receivedByName ?? (p.channel === 'gateway' ? 'Gateway' : '—')}</td>
                  <td className="px-4 py-2 text-right">{p.status === 'paid' && <button title="Cetak kwitansi" className="text-masri-primary" onClick={() => printReceipt(p.paymentNo)}><Printer className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
              {d.payments.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-slate-500">Belum ada transaksi.</td></tr>}
            </tbody>
          </table>
        </Card>
        {d.outflows.length > 0 && (
          <Card className="overflow-hidden">
            <p className="px-4 pt-4 text-xs font-bold uppercase text-slate-500">Kas keluar</p>
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.outflows.map((o) => <tr key={o.no}><td className="px-4 py-2 text-xs">{formatDateTime(o.at)}</td><td className="px-4 py-2 font-mono text-xs">{o.no}</td><td className="px-4 py-2 text-xs">{o.type === 'expense' ? 'Biaya: ' : ''}{o.label}</td>
                <td className="px-4 py-2 text-xs">{METHOD[o.method]}</td><td className="px-4 py-2 text-right text-red-600">{formatMoney(o.amount)}</td>
                <td className="px-4 py-2 text-right"><button title="Cetak bukti" className="text-masri-primary" onClick={() => printVoucher(o.type, o.id)}><Printer className="w-4 h-4" /></button></td></tr>)}
            </tbody></table>
          </Card>
        )}
      </>)}
    </div>
  );
};

const Tile: React.FC<{ k: string; v: string; sub?: string }> = ({ k, v, sub }) => (
  <Card className="p-4"><p className="text-lg font-bold text-slate-800 dark:text-white">{v}</p><p className="text-xs text-slate-500">{k}</p>{sub && <p className="text-[11px] text-slate-400">{sub}</p>}</Card>
);

/** Collection: pembiayaan aktif diurutkan dari tunggakan terlama (AO / Manager Cabang). */
export const CollectionList: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [rows, setRows] = useState<(CreditRow & { address: string; city: string; aoName: string | null; tazirDue: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState<{ row: CreditRow; charges: TazirCharge[] } | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => { api.get<{ collection: NonNullable<typeof rows> }>('/collection').then((r) => setRows(r.collection)).catch((e) => setError((e as ApiError).message)); }, [key]);
  const canWaive = currentUser.roleCode === 'branch-manager' || currentUser.roleCode === 'biz-mgr';
  const openTz = async (row: CreditRow) => { try { const r = await api.get<{ position: { tazirCharges: TazirCharge[] } }>(`/cashier/credits/${row.id}`); setTz({ row, charges: r.position.tazirCharges }); } catch (e) { setError((e as ApiError).message); } };
  const waive = async (c: TazirCharge) => {
    const reason = window.prompt("Alasan pembebasan ta'zir (mis. nasabah sakit / musibah, tidak mampu membayar tepat waktu)");
    if (!reason) return;
    try { await api.post(`/tazir/${c.id}/waive`, { reason }); await openTz(tz!.row); setKey((k) => k + 1); } catch (e) { setError((e as ApiError).message); }
  };
  const overdue = rows?.filter((r) => r.dpd > 0) ?? [];
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<AlertTriangle className="w-6 h-6" />} title="Collection" subtitle={`${currentUser.roleCode === 'ao' ? 'Portofolio Anda' : 'Portofolio cabang'}: pantau angsuran, prioritaskan kunjungan ke nasabah yang menunggak. Pendekatan santun sesuai prinsip syariah.`} />
      <ErrorBox message={error} />
      {!rows ? <Spinner /> : (<>
        <div className="grid grid-cols-3 gap-4">
          <Tile k="Rekening aktif" v={String(rows.length)} /><Tile k="Menunggak" v={String(overdue.length)} />
          <Tile k="Total tunggakan" v={formatMoney(overdue.reduce((s, r) => s + r.overdueAmount, 0))} />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Nasabah</th><th className="text-left px-4 py-3">Alamat</th><th className="text-right px-4 py-3">DPD</th>
              <th className="text-right px-4 py-3">Tunggakan</th><th className="text-right px-4 py-3">Ta'zir</th><th className="text-left px-4 py-3">Jatuh tempo berikut</th><th className="text-right px-4 py-3">Sisa</th>{currentUser.roleCode !== 'ao' && <th className="text-left px-4 py-3">AO</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id} className={r.dpd > 30 ? 'bg-red-50 dark:bg-red-900/10' : r.dpd > 0 ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}>
                  <td className="px-4 py-3"><p className="font-semibold">{r.customerName}</p><p className="text-xs text-slate-500">{r.phone} · {r.contractNo}</p></td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{r.address}, {r.city}</td>
                  <td className={`px-4 py-3 text-right font-bold ${r.dpd > 0 ? 'text-red-600' : 'text-green-700'}`}>{r.dpd}</td>
                  <td className="px-4 py-3 text-right">{r.overdueAmount ? formatMoney(r.overdueAmount, r.currency) : '—'}</td>
                  <td className="px-4 py-3 text-right">{r.tazirDue ? <button className="text-amber-700 underline" onClick={() => openTz(r)}>{formatMoney(r.tazirDue, r.currency)}</button> : '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.nextDue ?? 'Lunas'}</td><td className="px-4 py-3 text-right">{formatMoney(r.outstanding, r.currency)}</td>
                  {currentUser.roleCode !== 'ao' && <td className="px-4 py-3 text-xs">{r.aoName}</td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">Belum ada pembiayaan aktif.</td></tr>}
            </tbody>
          </table>
        </Card>
      </>)}
      {tz && (
        <Modal title={`Ta'zir · ${tz.row.customerName}`} onClose={() => setTz(null)}>
          <div className="space-y-2 text-sm">
            <p className="text-slate-500">Ta'zir dikenakan satu kali per angsuran yang terlambat melewati masa tenggang dan disalurkan ke dana sosial. Dapat dibebaskan bagi nasabah yang tidak mampu (bukan menunda-nunda).</p>
            {tz.charges.map((c) => (
              <div key={c.id} className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 py-2">
                <span>{c.assessedOn} · {formatMoney(c.amount)} · <b>{c.status === 'unpaid' ? 'belum dibayar' : c.status === 'paid' ? 'dibayar' : 'dibebaskan'}</b>{c.waiveReason ? ` — ${c.waiveReason}` : ''}</span>
                {canWaive && c.status === 'unpaid' && <button className={btnSecondary} onClick={() => waive(c)}>Bebaskan</button>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
};

/** Kualitas portofolio (Pembayaran & Macet) per cabang. */
export const PortfolioQuality: React.FC = () => {
  const [d, setD] = useState<{ byBranch: (Record<string, number> & { branchId: string; branchName: string })[]; total: Record<string, number>; collected30d: number; nplPct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<NonNullable<typeof d>>('/portfolio').then(setD).catch((e) => setError((e as ApiError).message)); }, []);
  const cols = [['current', 'Lancar'], ['dpd1_30', '1–30 hari'], ['dpd31_60', '31–60'], ['dpd61_90', '61–90'], ['dpd90', '> 90 hari']] as const;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Banknote className="w-6 h-6" />} title="Pembayaran & Kualitas Pembiayaan" subtitle="Outstanding pembiayaan Murabahah aktif per kolektibilitas (hari tunggakan) dan cabang." />
      <ErrorBox message={error} />
      {!d ? <Spinner /> : (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile k="Outstanding aktif" v={formatMoney(d.total.outstanding)} sub={`${d.total.accounts} rekening`} /><Tile k="Tunggakan" v={formatMoney(d.total.overdue)} />
          <Tile k="Angsuran tertagih 30 hari" v={formatMoney(d.collected30d)} /><Tile k="Rasio bermasalah (>60 hari)" v={`${d.nplPct}%`} />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Cabang</th><th className="text-right px-4 py-3">Rekening</th>
              {cols.map(([, l]) => <th key={l} className="text-right px-4 py-3">{l}</th>)}<th className="text-right px-4 py-3">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {[...d.byBranch, { ...d.total, branchId: 'total', branchName: 'TOTAL' }].map((b) => (
                <tr key={b.branchId} className={b.branchId === 'total' ? 'font-bold bg-slate-50 dark:bg-slate-900/40' : ''}>
                  <td className="px-4 py-3">{b.branchName}</td><td className="px-4 py-3 text-right">{b.accounts}</td>
                  {cols.map(([k]) => <td key={k} className={`px-4 py-3 text-right ${k !== 'current' && b[k] ? 'text-red-600' : ''}`}>{formatMoney(b[k])}</td>)}
                  <td className="px-4 py-3 text-right">{formatMoney(b.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </>)}
    </div>
  );
};
