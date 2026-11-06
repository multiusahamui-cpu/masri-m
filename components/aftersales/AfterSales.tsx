import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Plus, Search, CheckCircle, XCircle, Banknote, Printer, PackageCheck, Undo2, Wrench } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { printVoucher } from '../../lib/print';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { Expense, EXPENSE_STATUS } from '../finance/Expenses';
import { ShiftBanner } from '../finance/Shift';
import { Attachments } from '../files/Attachments';

interface Refund {
  id: string; refundNo: string; sourceType: 'order' | 'credit' | 'return'; sourceNo: string; branchName: string; customerName: string; customerPhone: string | null;
  amount: number; reason: string; method: 'cash' | 'transfer'; bankName: string | null; accountNo: string | null; accountName: string | null;
  status: string; requesterName: string; decisionNote: string | null; paidAt: string | null; paidRef: string | null; createdAt: string;
}
interface Return {
  id: string; returnNo: string; sourceType: 'order' | 'credit'; sourceNo: string; branchName: string; productName: string; qty: number; unitPrice: number;
  customerName: string; customerPhone: string | null; reason: string; description: string; resolution: 'replace' | 'refund' | 'repair'; status: string;
  condition: string | null; requesterName: string; decisionNote: string | null; shipmentNo: string | null; shipmentStatus: string | null;
  refundNo: string | null; refundStatus: string | null; completionNote: string | null; createdAt: string;
}
interface Source {
  sourceType: 'order' | 'credit'; id: string; no: string; status: string; currency: string; customerName: string; customerPhone: string | null; paidAmount: number;
  items: { productId: string; name: string; qty: number; unitPrice: number }[]; dispatched: boolean; canRefund: boolean; canReturn: boolean;
}

const REFUND_STATUS: Record<string, [string, string]> = {
  requested: ['Menunggu persetujuan', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'],
  approved: ['Disetujui — siap dibayar', 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'],
  paid: ['Dana dikembalikan', 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'],
  rejected: ['Ditolak', 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'],
};
const RETURN_STATUS: Record<string, [string, string]> = {
  requested: ['Menunggu persetujuan', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'],
  approved: ['Disetujui — terima barang', 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'],
  received: ['Barang diterima — proses penyelesaian', 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'],
  completed: ['Selesai', 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'],
  rejected: ['Ditolak', 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'],
};
const RESOLUTION: Record<string, string> = { replace: 'Ganti barang', refund: 'Pengembalian dana', repair: 'Perbaikan (garansi)' };
const REASONS: Record<string, string> = { damaged: 'Rusak saat diterima', wrong_item: 'Barang tidak sesuai pesanan', defect: 'Cacat / tidak berfungsi (garansi)', other: 'Lainnya' };
const SRC: Record<string, string> = { order: 'Order tunai', credit: 'Akad kredit', return: 'Retur' };
const SOURCE_STATUS: Record<string, string> = { awaiting_payment: 'menunggu pembayaran', fulfilling: 'dibayar, menunggu pengiriman', completed: 'selesai (barang diterima)', cancelled: 'dibatalkan', expired: 'kedaluwarsa', contracted: 'akad, barang belum diterima', active: 'pembiayaan berjalan', paid_off: 'lunas', approved: 'disetujui, belum akad' };

const Badge: React.FC<{ map: Record<string, [string, string]>; s: string }> = ({ map, s }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${map[s]?.[1] ?? ''}`}>{map[s]?.[0] ?? s}</span>;
const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button onClick={onClick} className={`px-3 py-1 rounded-full text-xs font-semibold border ${on ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{children}</button>
);
const canRequest = (r: string) => ['branch-admin', 'cashier', 'branch-manager', 'support', 'ao'].includes(r);

/** Purna jual: pembatalan + refund dan retur barang. */
export const AfterSalesWorkspace: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const role = currentUser.roleCode;
  const [view, setView] = useState<'refund' | 'return'>('return');
  const [status, setStatus] = useState(role === 'branch-manager' || role === 'biz-mgr' ? 'requested' : '');
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [returns, setReturns] = useState<Return[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [decide, setDecide] = useState<{ kind: 'refund' | 'return'; id: string; title: string; body: string } | null>(null);
  const [receiving, setReceiving] = useState<Return | null>(null);
  const [paying, setPaying] = useState<Refund | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    const s = qs({ status: status || undefined });
    api.get<{ refunds: Refund[] }>(`/refunds${s}`).then((r) => setRefunds(r.refunds)).catch((e) => setError((e as ApiError).message));
    api.get<{ returns: Return[] }>(`/returns${s}`).then((r) => setReturns(r.returns)).catch((e) => setError((e as ApiError).message));
  }, [status]);
  useEffect(load, [load]);
  const approver = (r: Refund) => (r.sourceType === 'credit' ? role === 'biz-mgr' : role === 'branch-manager' || role === 'biz-mgr');
  const complete = async (r: Return) => {
    const note = window.prompt('Catatan penyelesaian perbaikan (mis. diperbaiki service center, diserahkan kembali)');
    if (!note) return;
    try { await api.post(`/returns/${r.id}/complete`, { note }); load(); } catch (e) { setError((e as ApiError).message); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<RotateCcw className="w-6 h-6" />} title="Retur & Refund"
        subtitle="Pembatalan order / akad sebelum barang dikirim (refund), dan retur barang yang sudah diterima: ganti barang, pengembalian dana, atau perbaikan garansi."
        actions={canRequest(role) ? <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />Buat Permintaan</button> : undefined} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {flash && <div className="p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-900/20 dark:text-green-200 dark:border-green-800">{flash}</div>}
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        <Chip on={view === 'return'} onClick={() => setView('return')}>Retur barang ({returns?.length ?? '…'})</Chip>
        <Chip on={view === 'refund'} onClick={() => setView('refund')}>Refund ({refunds?.length ?? '…'})</Chip>
        <span className="mx-2 h-5 border-l border-slate-300 dark:border-slate-600" />
        {[['requested', 'Menunggu persetujuan'], ['approved,received', 'Sedang diproses'], ['', 'Semua']].map(([k, v]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{v}</Chip>)}
      </Card>

      {view === 'refund' ? (
        <Card className="overflow-x-auto">
          {!refunds ? <Spinner /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Refund</th><th className="text-left px-4 py-3">Nasabah</th><th className="text-left px-4 py-3">Alasan</th>
                <th className="text-right px-4 py-3">Nominal</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3"><span className="font-mono text-xs">{r.refundNo}</span><span className="block text-xs text-slate-500">{SRC[r.sourceType]} {r.sourceNo}</span><span className="block text-[11px] text-slate-400">{formatDateTime(r.createdAt)} · {r.requesterName}</span></td>
                    <td className="px-4 py-3">{r.customerName}<span className="block text-xs text-slate-500">{r.customerPhone}</span></td>
                    <td className="px-4 py-3 text-xs max-w-xs">{r.reason}{r.decisionNote && <span className="block text-slate-400">"{r.decisionNote}"</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatMoney(r.amount)}<span className="block text-[11px] font-normal text-slate-500">{r.method === 'cash' ? 'Tunai' : `${r.bankName} ${r.accountNo}`}</span></td>
                    <td className="px-4 py-3"><Badge map={REFUND_STATUS} s={r.status} />{r.paidAt && <span className="block text-[11px] text-slate-500 mt-1">{formatDateTime(r.paidAt)}{r.paidRef ? ` · ${r.paidRef}` : ''}</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {r.status === 'requested' && approver(r) && <button className={btnPrimary + ' inline-flex'} onClick={() => setDecide({ kind: 'refund', id: r.id, title: `Refund ${r.refundNo}`, body: `${SRC[r.sourceType]} ${r.sourceNo} · ${r.customerName} · ${formatMoney(r.amount)}. Menyetujui akan ${r.sourceType === 'order' ? 'membatalkan order & pengirimannya serta melepas reservasi stok' : r.sourceType === 'credit' ? 'membatalkan akad & pengirimannya serta melepas reservasi stok' : 'menerbitkan pengembalian dana'}.` })}>Putuskan</button>}
                      {r.status === 'approved' && ['cashier', 'branch-admin'].includes(role) && <button className={btnPrimary + ' inline-flex'} onClick={() => setPaying(r)}><Banknote className="w-4 h-4" />Bayarkan</button>}
                      {r.status === 'paid' && <button className={btnSecondary + ' inline-flex'} onClick={() => printVoucher('refund', r.id).catch((e) => setError((e as Error).message))}><Printer className="w-4 h-4" />Bukti</button>}
                    </td>
                  </tr>
                ))}
                {refunds.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Tidak ada refund.</td></tr>}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          {!returns ? <Spinner /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Retur</th><th className="text-left px-4 py-3">Barang & keluhan</th><th className="text-left px-4 py-3">Penyelesaian</th>
                <th className="text-left px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3"><span className="font-mono text-xs">{r.returnNo}</span><span className="block text-xs text-slate-500">{SRC[r.sourceType]} {r.sourceNo}</span><span className="block text-xs">{r.customerName}</span></td>
                    <td className="px-4 py-3 text-xs max-w-sm"><p className="font-semibold text-sm">{r.productName} × {r.qty}</p><p>{REASONS[r.reason]} — {r.description}</p>{r.condition && <p className="text-slate-500">Kondisi diterima: {r.condition === 'good' ? 'baik (masuk stok)' : 'rusak'}</p>}
                      <div className="mt-2"><Attachments ownerType="return" ownerId={r.id} kinds={['photo']} canUpload={['branch-admin', 'cashier', 'branch-manager', 'ao'].includes(role) && r.status !== 'completed' && r.status !== 'rejected'} title="Foto" compact /></div></td>
                    <td className="px-4 py-3 text-xs">{RESOLUTION[r.resolution]}
                      {r.shipmentNo && <span className="block text-slate-500">Pengganti {r.shipmentNo} · {r.shipmentStatus}</span>}
                      {r.refundNo && <span className="block text-slate-500">Refund {r.refundNo} · {r.refundStatus}</span>}
                      {r.completionNote && <span className="block text-slate-400">{r.completionNote}</span>}</td>
                    <td className="px-4 py-3"><Badge map={RETURN_STATUS} s={r.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {r.status === 'requested' && (role === 'branch-manager' || role === 'biz-mgr') && <button className={btnPrimary + ' inline-flex'} onClick={() => setDecide({ kind: 'return', id: r.id, title: `Retur ${r.returnNo}`, body: `${r.productName} × ${r.qty} · ${REASONS[r.reason]}: ${r.description}. Penyelesaian: ${RESOLUTION[r.resolution]}.` })}>Putuskan</button>}
                      {r.status === 'approved' && role === 'branch-admin' && <button className={btnPrimary + ' inline-flex'} onClick={() => setReceiving(r)}><PackageCheck className="w-4 h-4" />Terima Barang</button>}
                      {r.status === 'received' && r.resolution === 'repair' && role === 'branch-admin' && <button className={btnPrimary + ' inline-flex'} onClick={() => complete(r)}><Wrench className="w-4 h-4" />Selesai Diperbaiki</button>}
                    </td>
                  </tr>
                ))}
                {returns.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">Tidak ada retur.</td></tr>}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {creating && <CreateRequest onClose={() => setCreating(false)} onDone={(m, v) => { setCreating(false); setFlash(m); setView(v); setStatus(''); load(); }} />}
      {decide && <DecideModal {...decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); load(); }} />}
      {receiving && <ReceiveModal r={receiving} onClose={() => setReceiving(null)} onDone={(m) => { setReceiving(null); setFlash(m); load(); }} />}
      {paying && <PayRefund r={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); setFlash(`${paying.refundNo} dibayarkan.`); load(); }} />}
    </div>
  );
};

const BankFields: React.FC<{ v: { bankName: string; accountNo: string; accountName: string }; set: (v: { bankName: string; accountNo: string; accountName: string }) => void }> = ({ v, set }) => (
  <div className="grid grid-cols-3 gap-2">
    <input className={inputCls} placeholder="Bank" value={v.bankName} onChange={(e) => set({ ...v, bankName: e.target.value })} />
    <input className={inputCls} placeholder="No. rekening" value={v.accountNo} onChange={(e) => set({ ...v, accountNo: e.target.value })} />
    <input className={inputCls} placeholder="Nama pemilik" value={v.accountName} onChange={(e) => set({ ...v, accountName: e.target.value })} />
  </div>
);

const CreateRequest: React.FC<{ onClose: () => void; onDone: (msg: string, view: 'refund' | 'return') => void }> = ({ onClose, onDone }) => {
  const [no, setNo] = useState('');
  const [src, setSrc] = useState<Source | null>(null);
  const [kind, setKind] = useState<'refund' | 'return'>('return');
  const [amount, setAmount] = useState(0);
  const [reasonText, setReasonText] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [bank, setBank] = useState({ bankName: '', accountNo: '', accountName: '' });
  const [ret, setRet] = useState({ productId: '', qty: 1, reason: 'damaged', description: '', resolution: 'replace' as 'replace' | 'refund' | 'repair' });
  const [error, setError] = useState<string | null>(null);
  const lookup = async () => {
    setError(null); setSrc(null);
    try {
      const { source } = await api.get<{ source: Source }>(`/aftersales/lookup?no=${encodeURIComponent(no)}`);
      setSrc(source); setKind(source.canRefund ? 'refund' : 'return'); setAmount(source.paidAmount);
      setRet((r) => ({ ...r, productId: source.items[0]?.productId ?? '', resolution: 'replace' }));
      if (!source.canRefund && !source.canReturn) setError(`Status ${SOURCE_STATUS[source.status] ?? source.status}: belum bisa refund maupun retur.`);
    } catch (e) { setError((e as ApiError).message); }
  };
  const submit = async () => {
    setError(null);
    try {
      if (kind === 'refund') {
        const r = await api.post<{ refund: { refundNo: string } }>('/refunds', { sourceNo: src!.no, amount, reason: reasonText, method, ...(method === 'transfer' ? bank : {}) });
        onDone(`Refund ${r.refund.refundNo} diajukan — menunggu persetujuan ${src!.sourceType === 'credit' ? 'Business Manager' : 'Manager Cabang'}.`, 'refund');
      } else {
        const r = await api.post<{ return: { returnNo: string } }>('/returns', { sourceNo: src!.no, ...ret });
        onDone(`Retur ${r.return.returnNo} diajukan — menunggu persetujuan Manager Cabang.`, 'return');
      }
    } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal wide title="Buat Permintaan Refund / Retur" onClose={onClose}>
      <div className="space-y-4">
        <ErrorBox message={error} />
        <div className="flex gap-2"><input className={`${inputCls} font-mono uppercase`} placeholder="ORD-… / AKD-… / APP-…" value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
          <button className={btnSecondary} onClick={lookup}><Search className="w-4 h-4" />Cari</button></div>
        {src && (<>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 text-sm">
            <p className="font-semibold">{SRC[src.sourceType]} {src.no} · {src.customerName} · {SOURCE_STATUS[src.status] ?? src.status}</p>
            <p className="text-xs text-slate-500">{src.items.map((i) => `${i.name} × ${i.qty}`).join(', ')} · dibayar {formatMoney(src.paidAmount, src.currency)}{src.dispatched ? ' · barang sudah dikirim/diterima' : ''}</p>
          </div>
          <div className="flex gap-2">
            <button disabled={!src.canRefund} onClick={() => setKind('refund')} className={`${kind === 'refund' ? btnPrimary : btnSecondary}`}><Undo2 className="w-4 h-4" />Batalkan & refund</button>
            <button disabled={!src.canReturn} onClick={() => setKind('return')} className={`${kind === 'return' ? btnPrimary : btnSecondary}`}><RotateCcw className="w-4 h-4" />Retur barang</button>
          </div>
          {kind === 'refund' && src.canRefund ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Nominal refund (maks. {formatMoney(src.paidAmount, src.currency)})</label><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Dikembalikan via</label><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')}><option value="transfer">Transfer ke rekening nasabah</option><option value="cash">Tunai di kasir</option></select></div>
              </div>
              {method === 'transfer' && <BankFields v={bank} set={setBank} />}
              <div><label className={labelCls}>Alasan pembatalan</label><textarea className={inputCls} rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></div>
              <p className="text-xs text-slate-500">Setelah disetujui, {src.sourceType === 'credit' ? 'akad' : 'order'} beserta pengirimannya dibatalkan dan reservasi stok dilepas.</p>
            </div>
          ) : kind === 'return' && src.canReturn ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><label className={labelCls}>Barang</label><select className={inputCls} value={ret.productId} onChange={(e) => setRet({ ...ret, productId: e.target.value })}>{src.items.map((i) => <option key={i.productId} value={i.productId}>{i.name} (× {i.qty})</option>)}</select></div>
                <div><label className={labelCls}>Jumlah</label><input type="number" min={1} className={inputCls} value={ret.qty} onChange={(e) => setRet({ ...ret, qty: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Alasan</label><select className={inputCls} value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label className={labelCls}>Penyelesaian diminta</label><select className={inputCls} value={ret.resolution} onChange={(e) => setRet({ ...ret, resolution: e.target.value as typeof ret.resolution })}>
                  <option value="replace">Ganti barang</option>{src.sourceType === 'order' && <option value="refund">Pengembalian dana</option>}<option value="repair">Perbaikan (garansi)</option></select></div>
              </div>
              <div><label className={labelCls}>Kondisi / keluhan</label><textarea className={inputCls} rows={2} value={ret.description} onChange={(e) => setRet({ ...ret, description: e.target.value })} /></div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={!(kind === 'refund' ? src.canRefund : src.canReturn)} onClick={submit}>Ajukan</button></div>
        </>)}
      </div>
    </Modal>
  );
};

const DecideModal: React.FC<{ kind: 'refund' | 'return'; id: string; title: string; body: string; onClose: () => void; onDone: () => void }> = ({ kind, id, title, body, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    setError(null);
    try { await api.post(`/${kind === 'refund' ? 'refunds' : 'returns'}/${id}/decide`, { decision, note: note || null }); onDone(); } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal title={`Persetujuan ${title}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ErrorBox message={error} />
        <p>{body}</p>
        <textarea className={inputCls} rows={2} placeholder="Catatan (wajib bila menolak)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={() => decide('reject')}><XCircle className="w-4 h-4 text-red-600" />Tolak</button>
          <button className={btnPrimary} onClick={() => decide('approve')}><CheckCircle className="w-4 h-4" />Setujui</button>
        </div>
      </div>
    </Modal>
  );
};

const ReceiveModal: React.FC<{ r: Return; onClose: () => void; onDone: (msg: string) => void }> = ({ r, onClose, onDone }) => {
  const [condition, setCondition] = useState<'good' | 'damaged'>('damaged');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'pickup' | 'internal'>('pickup');
  const [addr, setAddr] = useState({ address: '', city: '' });
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [bank, setBank] = useState({ bankName: '', accountNo: '', accountName: '' });
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await api.post(`/returns/${r.id}/receive`, { condition, note: note || null, deliveryMode: mode, ...addr, refundMethod: method, ...(method === 'transfer' ? bank : {}) });
      onDone(r.resolution === 'replace' ? `Barang retur diterima. Pengiriman barang pengganti dibuat (${mode === 'pickup' ? 'ambil sendiri' : 'armada internal'}).`
        : r.resolution === 'refund' ? 'Barang retur diterima. Refund diterbitkan dan siap dibayarkan kasir.' : 'Barang diterima untuk perbaikan garansi.');
    } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal wide title={`Terima Barang Retur ${r.returnNo}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ErrorBox message={error} />
        <p><b>{r.productName} × {r.qty}</b> dari {r.customerName} · {RESOLUTION[r.resolution]}</p>
        {r.resolution !== 'repair' && (
          <div><label className={labelCls}>Kondisi barang diterima</label>
            <select className={inputCls} value={condition} onChange={(e) => setCondition(e.target.value as 'good' | 'damaged')}><option value="damaged">Rusak / cacat (tidak masuk stok, klaim ke pemasok)</option><option value="good">Baik, layak jual (kembali ke stok cabang)</option></select></div>
        )}
        {r.resolution === 'replace' && (<>
          <div><label className={labelCls}>Barang pengganti diserahkan dengan</label><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as 'pickup' | 'internal')}><option value="pickup">Ambil sendiri di cabang</option><option value="internal">Diantar armada Masri-M</option></select></div>
          {mode === 'internal' && <div className="grid grid-cols-3 gap-2"><input className={`${inputCls} col-span-2`} placeholder="Alamat" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /><input className={inputCls} placeholder="Kota" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>}
          <p className="text-xs text-slate-500">Stok pengganti diambil dari cabang, atau Gudang Pusat bila cabang kosong. Tanpa ongkir.</p>
        </>)}
        {r.resolution === 'refund' && (<>
          <p>Nominal refund: <b>{formatMoney(r.unitPrice * r.qty)}</b></p>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')}><option value="cash">Tunai di kasir</option><option value="transfer">Transfer ke rekening nasabah</option></select>
          {method === 'transfer' && <BankFields v={bank} set={setBank} />}
        </>)}
        <textarea className={inputCls} rows={2} placeholder="Catatan penerimaan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={submit}><PackageCheck className="w-4 h-4" />Terima & Proses</button></div>
      </div>
    </Modal>
  );
};

const PayRefund: React.FC<{ r: Refund; onClose: () => void; onDone: () => void }> = ({ r, onClose, onDone }) => {
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pay = async () => { setError(null); try { await api.post(`/refunds/${r.id}/pay`, { paidRef: ref || null }); onDone(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <Modal title={`Bayarkan ${r.refundNo}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ErrorBox message={error} />
        <p>{r.customerName} · {SRC[r.sourceType]} {r.sourceNo}</p>
        <p className="text-2xl font-bold">{formatMoney(r.amount)}</p>
        {r.method === 'transfer' ? (<>
          <p>Transfer ke <b>{r.bankName} {r.accountNo}</b> a.n. {r.accountName}</p>
          <input className={inputCls} placeholder="No. referensi transfer" value={ref} onChange={(e) => setRef(e.target.value)} />
        </>) : <p className="text-slate-500">Diserahkan tunai — tercatat sebagai kas keluar di shift Anda. Minta nasabah menandatangani bukti pengembalian.</p>}
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={pay}><Banknote className="w-4 h-4" />Konfirmasi Dibayarkan</button></div>
      </div>
    </Modal>
  );
};

/** Kasir: semua kas keluar yang menunggu dibayar (biaya disetujui & refund disetujui). */
export const PayoutsWorkspace: React.FC<{ currentUser: AuthUser; onGoShift?: () => void }> = ({ currentUser, onGoShift }) => {
  const [exp, setExp] = useState<Expense[] | null>(null);
  const [rfd, setRfd] = useState<Refund[] | null>(null);
  const [payE, setPayE] = useState<Expense | null>(null);
  const [payR, setPayR] = useState<Refund | null>(null);
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ expenses: Expense[] }>('/expenses?status=approved').then((r) => setExp(r.expenses)).catch((e) => setError((e as ApiError).message));
    api.get<{ refunds: Refund[] }>('/refunds?status=approved').then((r) => setRfd(r.refunds)).catch((e) => setError((e as ApiError).message));
  }, []);
  useEffect(load, [load]);
  const payExpense = async () => { setError(null); try { await api.post(`/expenses/${payE!.id}/pay`, { paidRef: ref || null }); setPayE(null); setRef(''); load(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Banknote className="w-6 h-6" />} title="Kas Keluar" subtitle={`Biaya operasional & refund yang sudah disetujui dan menunggu dibayarkan oleh kasir ${currentUser.branch?.name ?? ''}.`} />
      <ShiftBanner onGo={onGoShift} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        <p className="px-4 pt-4 text-xs font-bold uppercase text-slate-500">Biaya operasional disetujui</p>
        {!exp ? <Spinner /> : (
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {exp.map((e) => <tr key={e.id}><td className="px-4 py-3 font-mono text-xs">{e.expenseNo}</td><td className="px-4 py-3">{e.description}<span className="block text-xs text-slate-500">{e.vendor} · {e.method === 'cash' ? 'Tunai' : 'Transfer'}</span></td>
              <td className="px-4 py-3 text-right font-semibold">{formatMoney(e.amount)}</td><td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${EXPENSE_STATUS.approved[1]}`}>{EXPENSE_STATUS.approved[0]}</span></td>
              <td className="px-4 py-3 text-right"><button className={btnPrimary + ' inline-flex'} onClick={() => { setPayE(e); setRef(''); }}>Bayar</button></td></tr>)}
            {exp.length === 0 && <tr><td className="text-center py-6 text-slate-500">Tidak ada.</td></tr>}
          </tbody></table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <p className="px-4 pt-4 text-xs font-bold uppercase text-slate-500">Refund disetujui</p>
        {!rfd ? <Spinner /> : (
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rfd.map((r) => <tr key={r.id}><td className="px-4 py-3 font-mono text-xs">{r.refundNo}</td><td className="px-4 py-3">{r.customerName}<span className="block text-xs text-slate-500">{SRC[r.sourceType]} {r.sourceNo} · {r.method === 'cash' ? 'Tunai' : `Transfer ${r.bankName} ${r.accountNo}`}</span></td>
              <td className="px-4 py-3 text-right font-semibold">{formatMoney(r.amount)}</td><td className="px-4 py-3 text-right"><button className={btnPrimary + ' inline-flex'} onClick={() => setPayR(r)}>Bayarkan</button></td></tr>)}
            {rfd.length === 0 && <tr><td className="text-center py-6 text-slate-500">Tidak ada.</td></tr>}
          </tbody></table>
        )}
      </Card>
      {payE && (
        <Modal title={`Bayar ${payE.expenseNo}`} onClose={() => setPayE(null)}>
          <div className="space-y-3 text-sm"><ErrorBox message={error} /><p>{payE.description}</p><p className="text-2xl font-bold">{formatMoney(payE.amount)}</p>
            {payE.method === 'transfer' ? <input className={inputCls} placeholder="No. referensi transfer" value={ref} onChange={(e) => setRef(e.target.value)} /> : <p className="text-slate-500">Tunai dari kas shift Anda.</p>}
            <div className="flex justify-end"><button className={btnPrimary} onClick={payExpense}>Konfirmasi Dibayar</button></div></div>
        </Modal>
      )}
      {payR && <PayRefund r={payR} onClose={() => setPayR(null)} onDone={() => { setPayR(null); load(); }} />}
    </div>
  );
};
