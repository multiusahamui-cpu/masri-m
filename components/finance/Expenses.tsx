import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, Plus, CheckCircle, XCircle, Printer, Banknote, PieChart, Paperclip } from 'lucide-react';
import { Attachments } from '../files/Attachments';
import { api, ApiError, qs } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { printVoucher } from '../../lib/print';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

export interface Expense {
  id: string; expenseNo: string; branchId: string; branchName: string; category: string; description: string; vendor: string | null; amount: number;
  expenseDate: string; method: 'cash' | 'transfer'; receiptRef: string | null; status: string; requiresHq: boolean; submittedBy: string;
  submitterName: string; approverName: string | null; decisionNote: string | null; paidAt: string | null; paidRef: string | null; createdAt: string;
}
interface Meta { categories: Record<string, string>; mcLimit: number; monthlyBudget: number; monthUsed: number | null }

export const EXPENSE_STATUS: Record<string, [string, string]> = {
  submitted: ['Menunggu Manager Cabang', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'],
  hq_review: ['Menunggu Business Manager', 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'],
  approved: ['Disetujui — siap dibayar', 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'],
  paid: ['Dibayar', 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'],
  rejected: ['Ditolak', 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'],
  cancelled: ['Dibatalkan', 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'],
};
const Badge: React.FC<{ s: string }> = ({ s }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${EXPENSE_STATUS[s]?.[1] ?? ''}`}>{EXPENSE_STATUS[s]?.[0] ?? s}</span>;
const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button onClick={onClick} className={`px-3 py-1 rounded-full text-xs font-semibold border ${on ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{children}</button>
);
const month0 = () => new Date().toISOString().slice(0, 7);

/** Biaya operasional cabang — tampilan menyesuaikan role (Admin Cabang, Manager Cabang, BM, Kasir). */
export const ExpenseWorkspace: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const role = currentUser.roleCode;
  const defaultTab = role === 'branch-manager' ? 'submitted' : role === 'biz-mgr' ? 'hq_review' : role === 'cashier' ? 'approved' : '';
  const [tab, setTab] = useState(defaultTab);
  const [month, setMonth] = useState(month0());
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Expense | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [docs, setDocs] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null);
    api.get<{ expenses: Expense[] }>(`/expenses${qs({ status: tab || undefined, month: tab ? undefined : month })}`).then((r) => setRows(r.expenses)).catch((e) => setError((e as ApiError).message));
    api.get<Meta>('/expenses/meta').then(setMeta).catch(() => undefined);
  }, [tab, month]);
  useEffect(load, [load]);
  const cancel = async (e: Expense) => { if (!window.confirm(`Batalkan ${e.expenseNo}?`)) return; try { await api.post(`/expenses/${e.id}/cancel`); load(); } catch (err) { setError((err as ApiError).message); } };
  const canPay = (role === 'branch-admin' || role === 'cashier');
  const tabs: [string, string][] = role === 'biz-mgr'
    ? [['hq_review', 'Persetujuan Pusat'], ['', 'Semua (bulan)']]
    : role === 'branch-manager' ? [['submitted', 'Menunggu persetujuan'], ['approved,paid', 'Disetujui / dibayar'], ['', 'Semua (bulan)']]
    : role === 'cashier' ? [['approved', 'Siap dibayar'], ['paid', 'Sudah dibayar']]
    : [['', 'Semua (bulan)'], ['submitted,hq_review', 'Menunggu persetujuan'], ['approved', 'Siap dibayar'], ['paid', 'Dibayar']];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Receipt className="w-6 h-6" />} title="Biaya Operasional Cabang"
        subtitle={`Admin Cabang mengajukan → Manager Cabang menyetujui${meta ? ` (di atas ${formatMoney(meta.mcLimit)} diteruskan ke Business Manager)` : ''} → Kasir / Admin Cabang membayarkan.`}
        actions={role === 'branch-admin' ? <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />Ajukan Biaya</button> : undefined} />
      {meta && meta.monthUsed !== null && meta.monthlyBudget > 0 && <BudgetBar used={meta.monthUsed} budget={meta.monthlyBudget} />}
      <ErrorBox message={error} onClose={() => setError(null)} />
      {flash && <div className="p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-900/20 dark:text-green-200 dark:border-green-800">{flash}</div>}
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        {tabs.map(([k, v]) => <Chip key={k} on={tab === k} onClick={() => setTab(k)}>{v}</Chip>)}
        {!tab && <input type="month" className={`${inputCls} max-w-[180px] ml-auto`} value={month} onChange={(e) => setMonth(e.target.value)} />}
      </Card>
      <Card className="overflow-x-auto">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr>
              <th className="text-left px-4 py-3">No. / tanggal</th>{(role === 'biz-mgr') && <th className="text-left px-4 py-3">Cabang</th>}<th className="text-left px-4 py-3">Biaya</th>
              <th className="text-right px-4 py-3">Nominal</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 whitespace-nowrap"><span className="font-mono text-xs">{e.expenseNo}</span><span className="block text-xs text-slate-500">{e.expenseDate}</span></td>
                  {role === 'biz-mgr' && <td className="px-4 py-3 text-xs">{e.branchName}</td>}
                  <td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-white">{meta?.categories[e.category] ?? e.category}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{e.description}{e.vendor ? ` · ${e.vendor}` : ''}{e.receiptRef ? ` · nota ${e.receiptRef}` : ''}</p>
                    <p className="text-[11px] text-slate-400">oleh {e.submitterName}{e.approverName ? ` · disetujui ${e.approverName}` : ''}{e.decisionNote ? ` · "${e.decisionNote}"` : ''}</p></td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatMoney(e.amount)}<span className="block text-[11px] text-slate-500 font-normal">{e.method === 'cash' ? 'Tunai' : 'Transfer'}{e.requiresHq ? ' · perlu Pusat' : ''}</span></td>
                  <td className="px-4 py-3"><Badge s={e.status} />{e.paidAt && <span className="block text-[11px] text-slate-500 mt-1">{formatDateTime(e.paidAt)}{e.paidRef ? ` · ${e.paidRef}` : ''}</span>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    {((role === 'branch-manager' && e.status === 'submitted') || (role === 'biz-mgr' && e.status === 'hq_review')) && <button className={btnPrimary + ' inline-flex'} onClick={() => setDeciding(e)}>Putuskan</button>}
                    {canPay && e.status === 'approved' && <button className={btnPrimary + ' inline-flex'} onClick={() => setPaying(e)}><Banknote className="w-4 h-4" />Bayar</button>}
                    {role === 'branch-admin' && e.submittedBy === currentUser.id && ['submitted', 'hq_review', 'approved'].includes(e.status) && <button className="text-xs text-red-600 underline" onClick={() => cancel(e)}>Batalkan</button>}
                    <button title="Nota / foto" className="text-slate-500 hover:text-masri-primary align-middle" onClick={() => setDocs(e)}><Paperclip className="w-4 h-4 inline" /></button>
                    {e.status === 'paid' && <button className={btnSecondary + ' inline-flex'} onClick={() => printVoucher('expense', e.id).catch((er) => setError((er as Error).message))}><Printer className="w-4 h-4" />Bukti</button>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Tidak ada data.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {(role === 'branch-manager' || role === 'biz-mgr' || role === 'branch-admin') && <ExpenseReport />}
      {creating && meta && <CreateExpense meta={meta} onClose={() => setCreating(false)} onDone={(msg) => { setCreating(false); setFlash(msg); load(); }} />}
      {deciding && <DecideModal e={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); load(); }} />}
      {docs && (
        <Modal title={`Nota & foto ${docs.expenseNo}`} onClose={() => setDocs(null)}>
          <Attachments ownerType="expense" ownerId={docs.id} kinds={['receipt', 'other']} canUpload={(role === 'branch-admin' || role === 'cashier') && docs.branchId === currentUser.branch?.id} title="Nota / faktur / foto" />
        </Modal>
      )}
      {paying && <PayExpense e={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); setFlash(`${paying.expenseNo} dibayar.`); load(); }} />}
    </div>
  );
};

const BudgetBar: React.FC<{ used: number; budget: number }> = ({ used, budget }) => {
  const pct = Math.min(100, Math.round((used / budget) * 100));
  return (
    <Card className="p-4">
      <div className="flex justify-between text-sm mb-2"><span className="font-semibold">Anggaran bulan ini</span><span>{formatMoney(used)} dari {formatMoney(budget)} ({pct}%)</span></div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"><div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-masri-primary'}`} style={{ width: `${pct}%` }} /></div>
    </Card>
  );
};

const CreateExpense: React.FC<{ meta: Meta; onClose: () => void; onDone: (msg: string) => void }> = ({ meta, onClose, onDone }) => {
  const [f, setF] = useState({ category: 'transport', description: '', vendor: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), method: 'cash' as 'cash' | 'transfer', receiptRef: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: k === 'amount' ? Number(e.target.value) : e.target.value });
  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<{ expense: { expenseNo: string; requiresHq: boolean }; overBudget: boolean }>('/expenses', { ...f, vendor: f.vendor || null, receiptRef: f.receiptRef || null });
      onDone(`${r.expense.expenseNo} diajukan${r.expense.requiresHq ? ' — melebihi batas wewenang, akan diteruskan ke Business Manager' : ''}.${r.overBudget ? ' Perhatian: realisasi bulan ini melewati anggaran.' : ''}`);
    } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal title="Ajukan Biaya Operasional" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox message={error} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Kategori</label><select className={inputCls} value={f.category} onChange={set('category')}>{Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className={labelCls}>Tanggal biaya</label><input type="date" className={inputCls} value={f.expenseDate} onChange={set('expenseDate')} /></div>
        </div>
        <div><label className={labelCls}>Keterangan</label><input className={inputCls} value={f.description} onChange={set('description')} placeholder="mis. BBM truk pengiriman 3–7 Okt" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Vendor / dibayar kepada</label><input className={inputCls} value={f.vendor} onChange={set('vendor')} /></div>
          <div><label className={labelCls}>No. nota / faktur</label><input className={inputCls} value={f.receiptRef} onChange={set('receiptRef')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Nominal</label><input type="number" min={0} className={inputCls} value={f.amount} onChange={set('amount')} /></div>
          <div><label className={labelCls}>Dibayar dengan</label><select className={inputCls} value={f.method} onChange={set('method')}><option value="cash">Tunai (kas cabang)</option><option value="transfer">Transfer bank</option></select></div>
        </div>
        {f.amount > meta.mcLimit && <p className="text-xs text-orange-600">Di atas {formatMoney(meta.mcLimit)} — setelah Manager Cabang, perlu persetujuan Business Manager.</p>}
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={f.amount <= 0} onClick={submit}>Ajukan</button></div>
      </div>
    </Modal>
  );
};

const DecideModal: React.FC<{ e: Expense; onClose: () => void; onDone: () => void }> = ({ e, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    setError(null);
    try { await api.post(`/expenses/${e.id}/decide`, { decision, note: note || null }); onDone(); } catch (err) { setError((err as ApiError).message); }
  };
  return (
    <Modal title={`Persetujuan ${e.expenseNo}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ErrorBox message={error} />
        <p><b>{e.description}</b> · {e.vendor ?? '-'} · {e.branchName}</p>
        <p className="text-2xl font-bold">{formatMoney(e.amount)}</p>
        <p className="text-slate-500">{e.method === 'cash' ? 'Tunai' : 'Transfer'} · tanggal {e.expenseDate} · nota {e.receiptRef ?? '-'} · diajukan {e.submitterName}</p>
        <textarea className={inputCls} rows={2} placeholder="Catatan (wajib bila menolak)" value={note} onChange={(ev) => setNote(ev.target.value)} />
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={() => decide('reject')}><XCircle className="w-4 h-4 text-red-600" />Tolak</button>
          <button className={btnPrimary} onClick={() => decide('approve')}><CheckCircle className="w-4 h-4" />{e.requiresHq && e.status === 'submitted' ? 'Setujui & teruskan ke Pusat' : 'Setujui'}</button>
        </div>
      </div>
    </Modal>
  );
};

const PayExpense: React.FC<{ e: Expense; onClose: () => void; onDone: () => void }> = ({ e, onClose, onDone }) => {
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pay = async () => { setError(null); try { await api.post(`/expenses/${e.id}/pay`, { paidRef: ref || null }); onDone(); } catch (err) { setError((err as ApiError).message); } };
  return (
    <Modal title={`Bayar ${e.expenseNo}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ErrorBox message={error} />
        <p>{e.description} · {e.vendor ?? '-'}</p>
        <p className="text-2xl font-bold">{formatMoney(e.amount)}</p>
        {e.method === 'transfer'
          ? <input className={inputCls} placeholder="No. referensi transfer" value={ref} onChange={(ev) => setRef(ev.target.value)} />
          : <p className="text-slate-500">Dibayar tunai dari kas — tercatat sebagai kas keluar di shift Anda.</p>}
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={pay}><Banknote className="w-4 h-4" />Konfirmasi Dibayar</button></div>
      </div>
    </Modal>
  );
};

/** Laporan biaya per cabang & kategori. */
export const ExpenseReport: React.FC = () => {
  const [month, setMonth] = useState(month0());
  const [d, setD] = useState<{ budget: number; categories: Record<string, string>; branches: { branchId: string; branchName: string; paid: number; committed: number; count: number; byCategory: Record<string, number> }[] } | null>(null);
  useEffect(() => { api.get<NonNullable<typeof d>>(`/expenses/report?month=${month}`).then(setD).catch(() => setD(null)); }, [month]);
  const cats = d ? Object.keys(d.categories).filter((c) => d.branches.some((b) => b.byCategory[c])) : [];
  return (
    <Card className="overflow-x-auto">
      <div className="px-4 pt-4 flex items-center justify-between"><p className="font-bold flex items-center gap-2"><PieChart className="w-4 h-4 text-masri-primary" />Laporan biaya per cabang</p>
        <input type="month" className={`${inputCls} max-w-[180px]`} value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      {!d ? <Spinner /> : (
        <table className="w-full text-sm mt-2">
          <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Cabang</th>{cats.map((c) => <th key={c} className="text-right px-3 py-2">{d.categories[c]}</th>)}
            <th className="text-right px-4 py-2">Dibayar</th><th className="text-right px-4 py-2">Dalam proses</th><th className="text-right px-4 py-2">% anggaran</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {d.branches.map((b) => {
              const pct = d.budget ? Math.round(((b.paid + b.committed) / d.budget) * 100) : 0;
              return (
                <tr key={b.branchId}><td className="px-4 py-2">{b.branchName}</td>{cats.map((c) => <td key={c} className="px-3 py-2 text-right text-xs">{b.byCategory[c] ? formatMoney(b.byCategory[c]) : '—'}</td>)}
                  <td className="px-4 py-2 text-right font-semibold">{formatMoney(b.paid)}</td><td className="px-4 py-2 text-right">{formatMoney(b.committed)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : ''}`}>{pct}%</td></tr>
              );
            })}
            {d.branches.length === 0 && <tr><td colSpan={cats.length + 4} className="text-center py-6 text-slate-500">Belum ada biaya di bulan ini.</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  );
};
