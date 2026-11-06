import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, BookText, Scale, TrendingUp, Landmark, HeartHandshake, ListChecks, Lock, Unlock, RefreshCw, Plus, Download, Undo2, AlertTriangle,
  CheckCircle2, LayoutDashboard, Trash2, FileSpreadsheet,
} from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Modal, PageHeader, Spinner, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

// ---------------------------------------------------------------------------
// Tipe & util
// ---------------------------------------------------------------------------
interface Account { code: string; name: string; type: string; normal: string; groupName: string; isSystem: boolean; isActive: boolean; description: string | null; lines?: number }
interface Branch { id: string; code: string; name: string; type: string; countryCode?: string }
interface Amounts { byBranch: Record<string, number>; total: number }
interface RowT extends Amounts { code: string; name: string; group: string }
interface GroupT extends Amounts { group: string; rows: RowT[] }

export const SOURCE_LABEL: Record<string, string> = {
  stock: 'Persediaan', payment: 'Penerimaan', refund: 'Refund', expense: 'Biaya', shift: 'Shift kasir', charity: 'Dana kebajikan', manual: 'Manual', reversal: 'Pembalik',
};
const TYPE_LABEL: Record<string, string> = { asset: 'Aset', liability: 'Kewajiban', equity: 'Ekuitas', income: 'Pendapatan', expense: 'Beban' };
const nf = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Format akuntansi: negatif dalam kurung. */
export const acct = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? '—' : v < 0 ? `(${nf.format(-v)})` : nf.format(v));
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
const monthStart = () => `${today().slice(0, 7)}-01`;
const yearStart = () => `${today().slice(0, 4)}-01-01`;

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  // Teks yang diawali = + - @ dianggap rumus oleh Excel (CSV/formula injection) -> diberi awalan apostrof. Angka tidak diubah.
  const esc = (v: string | number | null | undefined) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([`﻿${rows.map((r) => r.map(esc).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function useBranches() {
  const [b, setB] = useState<Branch[]>([]);
  useEffect(() => { api.get<{ branches: Branch[] }>('/branches').then((r) => setB(r.branches)).catch(() => undefined); }, []);
  return b;
}
function useAccounts(reloadKey = 0) {
  const [a, setA] = useState<Account[]>([]);
  useEffect(() => { api.get<{ accounts: Account[] }>('/accounting/accounts').then((r) => setA(r.accounts)).catch(() => undefined); }, [reloadKey]);
  return a;
}
function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setData(null); setError(null);
    api.get<T>(path).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setError((e as ApiError).message); });
    return () => { live = false; };
  }, [path, tick]);
  return { data, error, setError, reload: () => setTick((t) => t + 1) };
}

interface Filter { from: string; to: string; branchId: string; country?: string }
const CUR: Record<string, string> = { ID: 'IDR', MY: 'MYR', BN: 'BND' };
const COUNTRY_NAME: Record<string, string> = { ID: 'Indonesia (IDR)', MY: 'Malaysia (MYR)', BN: 'Brunei (BND)' };
/** Negara laporan (satu mata uang) — diingat antarhalaman selama sesi. */
let reportCountry = 'ID';
const fmtCur = (v: number | null | undefined, country = reportCountry) => formatMoney(v, CUR[country] ?? 'IDR');
const Filters: React.FC<{ f: Filter; set: (f: Filter) => void; currentUser: AuthUser; asOf?: boolean; noDate?: boolean; children?: React.ReactNode }> = ({ f, set, currentUser, asOf, noDate, children }) => {
  const branches = useBranches();
  const lockBranch = currentUser.roleCode === 'branch-manager';
  const country = lockBranch ? (currentUser.branch?.countryCode ?? 'ID') : (f.country ?? reportCountry);
  return (
    <Card className="p-4 flex flex-wrap items-end gap-3">
      {!lockBranch && <div><label className={labelCls}>Negara</label><select className={inputCls} value={country} onChange={(e) => { reportCountry = e.target.value; set({ ...f, country: e.target.value, branchId: '' }); }}>
        {Object.entries(COUNTRY_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
      {!asOf && <div><label className={labelCls}>Dari</label><input type="date" className={inputCls} value={f.from} onChange={(e) => set({ ...f, from: e.target.value })} /></div>}
      {!noDate && <div><label className={labelCls}>{asOf ? 'Per tanggal' : 'Sampai'}</label><input type="date" className={inputCls} value={f.to} onChange={(e) => set({ ...f, to: e.target.value })} /></div>}
      <div className="min-w-[220px]"><label className={labelCls}>Kantor</label>
        {lockBranch ? <input className={inputCls} disabled value={currentUser.branch?.name ?? ''} />
          : <select className={inputCls} value={f.branchId} onChange={(e) => set({ ...f, branchId: e.target.value })}>
            <option value="">Konsolidasi (semua kantor)</option>
            {branches.filter((b) => (b.countryCode ?? 'ID') === country).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>}
      </div>
      {!asOf && <div className="flex gap-1 text-xs">
        {[['Bulan ini', monthStart()], ['Tahun ini', yearStart()]].map(([l, from]) => <button key={l} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600" onClick={() => set({ ...f, from, to: today() })}>{l}</button>)}
      </div>}
      <div className="ml-auto flex gap-2">{children}</div>
    </Card>
  );
};

const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className = '' }) => <th className={`px-3 py-2 text-xs font-bold uppercase text-slate-500 ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
const Td: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string; colSpan?: number }> = ({ children, right, className = '', colSpan }) => <td colSpan={colSpan} className={`px-3 py-1.5 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>;
const Stat: React.FC<{ label: string; value: string; hint?: string; tone?: 'ok' | 'warn' }> = ({ label, value, hint, tone }) => (
  <Card className="p-4"><p className="text-xs text-slate-500">{label}</p><p className={`text-xl font-bold mt-1 ${tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-green-700' : 'text-slate-800 dark:text-white'}`}>{value}</p>{hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}</Card>
);
const BalancedBadge: React.FC<{ ok: boolean; label?: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${ok ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700'}`}>
    {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{label ?? (ok ? 'Seimbang' : 'Tidak seimbang')}
  </span>
);

// ---------------------------------------------------------------------------
// Modul utama (role Bookkeeping) & laporan baca-saja (BM, Manager Cabang)
// ---------------------------------------------------------------------------
export const ACCOUNTING_MENUS = ['dashboard', 'journal', 'ledger', 'trial', 'pl', 'bs', 'charity', 'recon', 'coa', 'periods'] as const;

export const AccountingModule: React.FC<{ menu: string; currentUser: AuthUser; onNavigate?: (m: string) => void }> = ({ menu, currentUser, onNavigate }) => {
  const canEdit = currentUser.roleCode === 'finance';
  switch (menu) {
    case 'journal': return <JournalPage currentUser={currentUser} canEdit={canEdit} />;
    case 'ledger': return <LedgerPage currentUser={currentUser} />;
    case 'trial': return <TrialBalancePage currentUser={currentUser} />;
    case 'pl': return <IncomeStatementPage currentUser={currentUser} />;
    case 'bs': return <BalanceSheetPage currentUser={currentUser} />;
    case 'charity': return <CharityPage currentUser={currentUser} canEdit={canEdit} />;
    case 'recon': return <ReconciliationPage currentUser={currentUser} />;
    case 'coa': return <CoaPage canEdit={canEdit} />;
    case 'periods': return <PeriodsPage canEdit={canEdit} />;
    default: return <AccountingDashboard currentUser={currentUser} canEdit={canEdit} onNavigate={onNavigate} />;
  }
};

/** Laporan keuangan baca-saja untuk Business Manager & Manager Cabang. */
export const FinancialReports: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [tab, setTab] = useState('pl');
  const tabs: [string, string][] = [['pl', 'Laba Rugi'], ['bs', 'Neraca'], ['trial', 'Neraca Saldo'], ['ledger', 'Buku Besar'], ['charity', 'Dana Kebajikan'], ['journal', 'Jurnal']];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${tab === k ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{l}</button>)}</div>
      <AccountingModule key={tab} menu={tab} currentUser={currentUser} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
interface Summary { cash: number; receivable: number; deferredMargin: number; inventory: number; charity: number; payable: number; downPayments: number; monthProfit: number; monthEntries: number; pending: number; errors: { sourceType: string; sourceId: string; message: string; attempts: number; lastAt: string }[]; lastClosed: string | null }

const AccountingDashboard: React.FC<{ currentUser: AuthUser; canEdit: boolean; onNavigate?: (m: string) => void }> = ({ canEdit, onNavigate }) => {
  const [country, setCountry] = useState(reportCountry);
  const { data: s, error, setError, reload } = useLoad<Summary>(`/accounting/summary?country=${country}`);
  const formatMoney = (v: number) => fmtCur(v, country);
  const [busy, setBusy] = useState(false);
  const sync = async () => { setBusy(true); try { await api.post('/accounting/sync'); reload(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <PageHeader icon={<LayoutDashboard className="w-6 h-6" />} title="Akuntansi Syariah" subtitle="Jurnal otomatis dari transaksi operasional (PSAK 102 Murabahah) · konsolidasi per negara (satu mata uang)"
        actions={<>
          <select className={inputCls} value={country} onChange={(e) => { reportCountry = e.target.value; setCountry(e.target.value); }}>{Object.entries(COUNTRY_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {canEdit && <button className={btnSecondary} onClick={sync} disabled={busy}><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Posting sekarang</button>}
        </>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!s ? <Spinner /> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Kas, bank & gateway" value={formatMoney(s.cash)} />
          <Stat label="Piutang Murabahah (bersih)" value={formatMoney(s.receivable)} hint={`margin ditangguhkan ${formatMoney(s.deferredMargin)}`} />
          <Stat label="Persediaan" value={formatMoney(s.inventory)} />
          <Stat label="Laba bulan berjalan" value={formatMoney(s.monthProfit)} tone={s.monthProfit >= 0 ? 'ok' : 'warn'} hint={`${s.monthEntries} jurnal bulan ini`} />
          <Stat label="Dana kebajikan (ta'zir) belum disalurkan" value={formatMoney(s.charity)} />
          <Stat label="Uang muka Murabahah (titipan)" value={formatMoney(s.downPayments)} />
          <Stat label="Hutang pemasok" value={formatMoney(s.payable)} />
          <Stat label="Periode terakhir ditutup" value={s.lastClosed ?? 'Belum ada'} />
        </div>
        <Card className="p-4 space-y-2">
          <p className="font-semibold flex items-center gap-2">{s.pending || s.errors.length ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
            Status posting: {s.pending ? `${s.pending} transaksi menunggu posting` : 'semua transaksi sudah dijurnal'}{s.errors.length ? ` · ${s.errors.length} gagal` : ''}</p>
          {s.errors.map((e) => <p key={`${e.sourceType}${e.sourceId}`} className="text-sm text-red-700">{SOURCE_LABEL[e.sourceType] ?? e.sourceType} {e.sourceId.slice(0, 8)}: {e.message} ({e.attempts}×, {formatDateTime(e.lastAt)})</p>)}
          <p className="text-xs text-slate-500">Posting otomatis berjalan setiap menit dan setiap kali laporan dibuka. Transaksi yang gagal dicoba ulang 10 menit kemudian atau lewat tombol "Posting sekarang".</p>
        </Card>
        {onNavigate && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[['journal', 'Jurnal', BookText], ['pl', 'Laba Rugi', TrendingUp], ['bs', 'Neraca', Landmark], ['charity', 'Dana Kebajikan', HeartHandshake]].map(([k, l, I]) => {
            const Icon = I as typeof BookText;
            return <button key={k as string} onClick={() => onNavigate(k as string)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-masri-primary flex items-center gap-2 font-semibold"><Icon className="w-5 h-5 text-masri-primary" />{l as string}</button>;
          })}
        </div>}
      </>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Jurnal
// ---------------------------------------------------------------------------
interface EntryRow { id: string; entryNo: string; date: string; sourceType: string; sourceNo: string | null; memo: string; status: string; total: number }

const JournalPage: React.FC<{ currentUser: AuthUser; canEdit: boolean }> = ({ currentUser, canEdit }) => {
  const [f, setF] = useState<Filter>({ from: monthStart(), to: today(), branchId: '', country: reportCountry });
  const [st, setSt] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const path = `/accounting/journals${qs({ ...f, sourceType: st, q, page })}`;
  const { data, error, setError, reload } = useLoad<{ entries: EntryRow[]; total: number; page: number }>(path);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader icon={<BookText className="w-6 h-6" />} title="Jurnal" subtitle="Jurnal otomatis (JU), manual (JM) dan pembalik (JB)"
        actions={canEdit ? <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />Jurnal Manual</button> : undefined} />
      <Filters f={f} set={(x) => { setF(x); setPage(1); }} currentUser={currentUser}>
        <select className={inputCls} value={st} onChange={(e) => { setSt(e.target.value); setPage(1); }}><option value="">Semua sumber</option>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className={inputCls} placeholder="Cari no. / keterangan" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>No. jurnal</Th><Th>Tanggal</Th><Th>Sumber</Th><Th>Keterangan</Th><Th right>Nilai</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setOpen(e.id)}>
                  <Td className="font-mono text-xs whitespace-nowrap">{e.entryNo}{e.status === 'reversed' && <span className="ml-1 text-red-600">(dibalik)</span>}</Td>
                  <Td className="whitespace-nowrap">{e.date}</Td>
                  <Td className="whitespace-nowrap"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700">{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</span> <span className="text-xs text-slate-500">{e.sourceNo}</span></Td>
                  <Td className="max-w-[480px] truncate">{e.memo}</Td>
                  <Td right>{acct(e.total)}</Td>
                </tr>
              ))}
              {!data.entries.length && <tr><Td colSpan={5} className="text-center text-slate-500 py-8">Tidak ada jurnal pada filter ini.</Td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {data && data.total > 50 && <div className="flex items-center gap-2 justify-end text-sm">
        <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
        <span>Hal. {page} / {Math.ceil(data.total / 50)} · {data.total} jurnal</span>
        <button className={btnSecondary} disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>›</button>
      </div>}
      {open && <JournalDetail id={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
      {creating && <ManualJournalForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </div>
  );
};

interface EntryDetail {
  entry: { id: string; entryNo: string; date: string; sourceType: string; sourceNo: string | null; memo: string; status: string; createdAt: string; createdByName: string | null; reversedBy: { entryNo: string } | null; meta: Record<string, unknown> | null };
  lines: { id: number; accountCode: string; accountName: string; branchCode: string; branchName: string; debit: number; credit: number; memo: string | null }[];
}
const JournalDetail: React.FC<{ id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }> = ({ id, canEdit, onClose, onChanged }) => {
  const { data: d, error, setError } = useLoad<EntryDetail>(`/accounting/journals/${id}`);
  const [reason, setReason] = useState('');
  const [rev, setRev] = useState(false);
  const reverse = async () => { try { await api.post(`/accounting/journals/${id}/reverse`, { reason }); onChanged(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <Modal title={d ? `Jurnal ${d.entry.entryNo}` : 'Jurnal'} onClose={onClose} wide="xl">
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><p className="text-xs text-slate-500">Tanggal</p><p className="font-semibold">{d.entry.date}</p></div>
            <div><p className="text-xs text-slate-500">Sumber</p><p className="font-semibold">{SOURCE_LABEL[d.entry.sourceType]} {d.entry.sourceNo}</p></div>
            <div><p className="text-xs text-slate-500">Dibuat</p><p>{d.entry.createdByName ?? 'Sistem (otomatis)'} · {formatDateTime(d.entry.createdAt)}</p></div>
            <div><p className="text-xs text-slate-500">Status</p><p className={d.entry.status === 'reversed' ? 'text-red-600 font-semibold' : 'text-green-700 font-semibold'}>{d.entry.status === 'reversed' ? `Dibalik oleh ${d.entry.reversedBy?.entryNo ?? ''}` : 'Diposting'}</p></div>
          </div>
          <p className="text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40">{d.entry.memo}</p>
          <table className="w-full text-sm">
            <thead><tr><Th>Akun</Th><Th>Kantor</Th><Th>Keterangan</Th><Th right>Debit</Th><Th right>Kredit</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.lines.map((l) => <tr key={l.id}><Td><span className="font-mono text-xs">{l.accountCode}</span> {l.accountName}</Td><Td className="text-xs">{l.branchCode}</Td><Td className="text-xs text-slate-500">{l.memo}</Td><Td right>{acct(l.debit)}</Td><Td right>{acct(l.credit)}</Td></tr>)}
              <tr className="font-bold border-t-2 border-slate-300"><Td colSpan={3}>Jumlah</Td><Td right>{acct(d.lines.reduce((s, l) => s + l.debit, 0))}</Td><Td right>{acct(d.lines.reduce((s, l) => s + l.credit, 0))}</Td></tr>
            </tbody>
          </table>
          {canEdit && d.entry.sourceType === 'manual' && d.entry.status === 'posted' && (rev
            ? <div className="flex gap-2"><input className={inputCls} placeholder="Alasan pembalikan" value={reason} onChange={(e) => setReason(e.target.value)} /><button className={btnPrimary} onClick={reverse} disabled={reason.trim().length < 5}>Balik jurnal</button></div>
            : <button className={btnSecondary} onClick={() => setRev(true)}><Undo2 className="w-4 h-4" />Buat jurnal pembalik</button>)}
          {d.entry.sourceType !== 'manual' && d.entry.sourceType !== 'reversal' && <p className="text-xs text-slate-500">Jurnal otomatis tidak bisa diubah. Koreksi lewat dokumen sumber (refund, pembatalan) atau jurnal manual.</p>}
        </div>
      )}
    </Modal>
  );
};

interface DraftLine { accountCode: string; branchId: string; debit: string; credit: string; memo: string }
const ManualJournalForm: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const accounts = useAccounts().filter((a) => a.isActive);
  const branches = useBranches();
  const ho = branches.find((b) => b.type === 'head_office')?.id ?? '';
  const blank = (): DraftLine => ({ accountCode: '', branchId: ho, debit: '', credit: '', memo: '' });
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blank(), blank()]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (ho) setLines((ls) => ls.map((l) => ({ ...l, branchId: l.branchId || ho }))); }, [ho]);
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const setLine = (i: number, p: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async () => {
    setError(null);
    try {
      await api.post('/accounting/journals', { date, memo, lines: lines.filter((l) => l.accountCode).map((l) => ({ accountCode: l.accountCode, branchId: l.branchId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null })) });
      onSaved();
    } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal title="Jurnal Manual" onClose={onClose} wide="xl">
      <div className="space-y-3">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><label className={labelCls}>Tanggal</label><input type="date" className={inputCls} max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="md:col-span-3"><label className={labelCls}>Keterangan</label><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="mis. Pelunasan hutang pemasok, dropping kas ke cabang, koreksi" /></div>
        </div>
        <table className="w-full text-sm">
          <thead><tr><Th>Akun</Th><Th>Kantor</Th><Th>Keterangan baris</Th><Th right>Debit</Th><Th right>Kredit</Th><Th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <Td><select className={inputCls} value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })}><option value="">— pilih akun —</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></Td>
                <Td><select className={inputCls} value={l.branchId} onChange={(e) => setLine(i, { branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></Td>
                <Td><input className={inputCls} value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} /></Td>
                <Td><input type="number" min={0} className={`${inputCls} text-right`} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></Td>
                <Td><input type="number" min={0} className={`${inputCls} text-right`} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></Td>
                <Td>{lines.length > 2 && <button onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Hapus baris"><Trash2 className="w-4 h-4 text-slate-400" /></button>}</Td>
              </tr>
            ))}
            <tr className="font-bold"><Td colSpan={3}><button className="text-masri-primary text-sm font-semibold" onClick={() => setLines([...lines, blank()])}>+ Tambah baris</button></Td><Td right>{acct(dr)}</Td><Td right>{acct(cr)}</Td><Td /></tr>
          </tbody>
        </table>
        <div className="flex items-center justify-between">
          <BalancedBadge ok={Math.abs(dr - cr) < 0.005 && dr > 0} label={Math.abs(dr - cr) < 0.005 ? (dr > 0 ? 'Seimbang' : 'Isi nominal') : `Selisih ${acct(dr - cr)}`} />
          <p className="text-xs text-slate-500">Baris di kantor berbeda otomatis diseimbangkan dengan akun RAK.</p>
          <button className={btnPrimary} onClick={save} disabled={Math.abs(dr - cr) > 0.005 || dr <= 0 || memo.trim().length < 5}>Posting jurnal</button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Buku besar & neraca saldo
// ---------------------------------------------------------------------------
interface Ledger { account: Account; opening: number; closing: number; debit: number; credit: number; truncated: boolean; lines: { entryId: string; entryNo: string; date: string; sourceType: string; sourceNo: string | null; memo: string; branchCode: string; debit: number; credit: number; balance: number }[] }

const LedgerPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const accounts = useAccounts();
  const [f, setF] = useState<Filter>({ from: monthStart(), to: today(), branchId: '', country: reportCountry });
  const [code, setCode] = useState('1101');
  const { data: d, error, setError } = useLoad<Ledger>(`/accounting/ledger${qs({ ...f, account: code })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader icon={<BookOpen className="w-6 h-6" />} title="Buku Besar" subtitle="Mutasi per akun dengan saldo berjalan" />
      <Filters f={f} set={setF} currentUser={currentUser}>
        <select className={`${inputCls} min-w-[260px]`} value={code} onChange={(e) => setCode(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
        {d && <button className={btnSecondary} onClick={() => downloadCsv(`buku-besar-${code}-${f.from}-${f.to}`, [['Tanggal', 'No. jurnal', 'Sumber', 'Kantor', 'Keterangan', 'Debit', 'Kredit', 'Saldo'], ['', '', '', '', 'Saldo awal', '', '', d.opening], ...d.lines.map((l) => [l.date, l.entryNo, l.sourceNo ?? '', l.branchCode, l.memo, l.debit, l.credit, l.balance])])}><Download className="w-4 h-4" />CSV</button>}
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!d ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>Tanggal</Th><Th>No. jurnal</Th><Th>Kantor</Th><Th>Keterangan</Th><Th right>Debit</Th><Th right>Kredit</Th><Th right>Saldo</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              <tr className="font-semibold bg-slate-50/60 dark:bg-slate-900/20"><Td colSpan={6}>Saldo awal per {f.from} (saldo normal {d.account.normal === 'debit' ? 'debit' : 'kredit'})</Td><Td right>{acct(d.opening)}</Td></tr>
              {d.lines.map((l, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setOpen(l.entryId)}>
                  <Td className="whitespace-nowrap">{l.date}</Td><Td className="font-mono text-xs whitespace-nowrap">{l.entryNo}</Td><Td className="text-xs">{l.branchCode}</Td>
                  <Td className="max-w-[420px] truncate">{l.memo}</Td><Td right>{acct(l.debit)}</Td><Td right>{acct(l.credit)}</Td><Td right className="font-semibold">{acct(l.balance)}</Td>
                </tr>
              ))}
              <tr className="font-bold border-t-2 border-slate-300"><Td colSpan={4}>Mutasi & saldo akhir</Td><Td right>{acct(d.debit)}</Td><Td right>{acct(d.credit)}</Td><Td right>{acct(d.closing)}</Td></tr>
            </tbody>
          </table>
        )}
        {d?.truncated && <p className="p-3 text-xs text-amber-700">Menampilkan 2.000 baris pertama — persempit rentang tanggal.</p>}
      </Card>
      {open && <JournalDetail id={open} canEdit={false} onClose={() => setOpen(null)} onChanged={() => setOpen(null)} />}
    </div>
  );
};

interface TB { rows: { code: string; name: string; type: string; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number }[]; totals: Record<string, number>; balanced: boolean }
const TrialBalancePage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [f, setF] = useState<Filter>({ from: monthStart(), to: today(), branchId: '', country: reportCountry });
  const { data: d, error, setError } = useLoad<TB>(`/accounting/trial-balance${qs({ ...f })}`);
  const cols = ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'] as const;
  return (
    <div className="space-y-4">
      <PageHeader icon={<Scale className="w-6 h-6" />} title="Neraca Saldo" subtitle="Saldo awal, mutasi, dan saldo akhir seluruh akun" />
      <Filters f={f} set={setF} currentUser={currentUser}>
        {d && <BalancedBadge ok={d.balanced} />}
        {d && <button className={btnSecondary} onClick={() => downloadCsv(`neraca-saldo-${f.from}-${f.to}`, [['Kode', 'Akun', 'Saldo awal D', 'Saldo awal K', 'Mutasi D', 'Mutasi K', 'Saldo akhir D', 'Saldo akhir K'], ...d.rows.map((r) => [r.code, r.name, ...cols.map((c) => r[c])]), ['', 'JUMLAH', ...cols.map((c) => d.totals[c])]])}><Download className="w-4 h-4" />CSV</button>}
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!d ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40">
              <tr><Th /><Th /><Th right className="border-l" >Saldo awal</Th><Th /><Th right className="border-l">Mutasi</Th><Th /><Th right className="border-l">Saldo akhir</Th><Th /></tr>
              <tr><Th>Kode</Th><Th>Akun</Th>{cols.map((c, i) => <Th key={c} right className={i % 2 === 0 ? 'border-l' : ''}>{i % 2 === 0 ? 'Debit' : 'Kredit'}</Th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.rows.map((r) => <tr key={r.code}><Td className="font-mono text-xs">{r.code}</Td><Td>{r.name}</Td>{cols.map((c, i) => <Td key={c} right className={i % 2 === 0 ? 'border-l border-slate-100 dark:border-slate-700' : ''}>{acct(r[c])}</Td>)}</tr>)}
              <tr className="font-bold border-t-2 border-slate-300"><Td colSpan={2}>Jumlah</Td>{cols.map((c) => <Td key={c} right>{acct(d.totals[c])}</Td>)}</tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Laba rugi & neraca
// ---------------------------------------------------------------------------
const StatementTable: React.FC<{ sections: { title: string; groups: GroupT[]; total: Amounts; totalLabel: string }[]; footer: { label: string; amounts: Amounts; strong?: boolean }[]; branches: Branch[]; perBranch: boolean }> = ({ sections, footer, branches, perBranch }) => {
  const cols = perBranch ? branches : [];
  const cells = (a: Amounts, cls = '') => <>{cols.map((b) => <Td key={b.id} right className={cls}>{acct(a.byBranch[b.id])}</Td>)}<Td right className={`font-semibold ${cls}`}>{acct(a.total)}</Td></>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>Akun</Th>{cols.map((b) => <Th key={b.id} right>{b.code}</Th>)}<Th right>{perBranch ? 'Konsolidasi' : 'Jumlah'}</Th></tr></thead>
      <tbody>
        {sections.map((s) => (
          <React.Fragment key={s.title}>
            <tr><Td colSpan={cols.length + 2} className="pt-4 font-bold text-masri-dark dark:text-emerald-300 uppercase text-xs tracking-wide">{s.title}</Td></tr>
            {s.groups.map((g) => (
              <React.Fragment key={g.group}>
                {s.groups.length > 1 && <tr><Td colSpan={cols.length + 2} className="font-semibold text-slate-600 dark:text-slate-300">{g.group}</Td></tr>}
                {g.rows.map((r) => <tr key={`${r.code}${r.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><Td className="pl-6"><span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>{r.name}</Td>{cells(r)}</tr>)}
                {s.groups.length > 1 && <tr className="border-t border-slate-200 dark:border-slate-700"><Td className="pl-6 italic">Jumlah {g.group}</Td>{cells(g)}</tr>}
              </React.Fragment>
            ))}
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-bold"><Td>{s.totalLabel}</Td>{cells(s.total)}</tr>
          </React.Fragment>
        ))}
        {footer.map((x) => <tr key={x.label} className={`border-t-2 border-slate-400 ${x.strong ? 'bg-masri-light dark:bg-emerald-900/20 text-base' : ''}`}><Td className="font-bold">{x.label}</Td>{cells(x.amounts, 'font-bold')}</tr>)}
      </tbody>
    </table>
  );
};
function statementCsv(name: string, sections: { title: string; groups: GroupT[]; total: Amounts; totalLabel: string }[], footer: { label: string; amounts: Amounts }[], branches: Branch[]) {
  const rows: (string | number)[][] = [['Kode', 'Akun', ...branches.map((b) => b.code), 'Konsolidasi']];
  const line = (code: string, name: string, a: Amounts) => rows.push([code, name, ...branches.map((b) => a.byBranch[b.id] ?? 0), a.total]);
  for (const s of sections) { rows.push(['', s.title.toUpperCase()]); for (const g of s.groups) for (const r of g.rows) line(r.code, r.name, r); line('', s.totalLabel, s.total); }
  for (const x of footer) line('', x.label, x.amounts);
  downloadCsv(name, rows);
}

interface PL { branches: Branch[]; income: GroupT[]; totalIncome: Amounts; expense: GroupT[]; totalExpense: Amounts; netIncome: Amounts }
const IncomeStatementPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [f, setF] = useState<Filter>({ from: monthStart(), to: today(), branchId: '', country: reportCountry });
  const [perBranch, setPerBranch] = useState(true);
  const { data: d, error, setError } = useLoad<PL>(`/accounting/income-statement${qs({ ...f })}`);
  const sections = d ? [{ title: 'Pendapatan', groups: d.income, total: d.totalIncome, totalLabel: 'Jumlah pendapatan' }, { title: 'Beban', groups: d.expense, total: d.totalExpense, totalLabel: 'Jumlah beban' }] : [];
  const footer = d ? [{ label: 'LABA (RUGI) BERSIH', amounts: d.netIncome, strong: true }] : [];
  const multi = (d?.branches.length ?? 0) > 1;
  return (
    <div className="space-y-4">
      <PageHeader icon={<TrendingUp className="w-6 h-6" />} title="Laba Rugi" subtitle="Pendapatan margin Murabahah diakui proporsional terhadap kas diterima (PSAK 102)" />
      <Filters f={f} set={setF} currentUser={currentUser}>
        {multi && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={perBranch} onChange={(e) => setPerBranch(e.target.checked)} />Kolom per kantor</label>}
        {d && <button className={btnSecondary} onClick={() => statementCsv(`laba-rugi-${f.from}-${f.to}`, sections, footer, d.branches)}><FileSpreadsheet className="w-4 h-4" />CSV</button>}
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto p-2">{!d ? <Spinner /> : <StatementTable sections={sections} footer={footer} branches={d.branches} perBranch={perBranch && multi} />}</Card>
    </div>
  );
};

interface BS { branches: Branch[]; asOf: string; assets: GroupT[]; totalAssets: Amounts; liabilities: GroupT[]; totalLiabilities: Amounts; equity: GroupT[]; totalEquity: Amounts; totalLiabilitiesEquity: Amounts; balanced: boolean }
const BalanceSheetPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [f, setF] = useState<Filter>({ from: '', to: today(), branchId: '', country: reportCountry });
  const [perBranch, setPerBranch] = useState(true);
  const { data: d, error, setError } = useLoad<BS>(`/accounting/balance-sheet${qs({ asOf: f.to, branchId: f.branchId, country: f.country })}`);
  const sections = d ? [
    { title: 'Aset', groups: d.assets, total: d.totalAssets, totalLabel: 'JUMLAH ASET' },
    { title: 'Kewajiban', groups: d.liabilities, total: d.totalLiabilities, totalLabel: 'Jumlah kewajiban' },
    { title: 'Ekuitas', groups: d.equity, total: d.totalEquity, totalLabel: 'Jumlah ekuitas' },
  ] : [];
  const footer = d ? [{ label: 'JUMLAH KEWAJIBAN & EKUITAS', amounts: d.totalLiabilitiesEquity, strong: true }] : [];
  const multi = (d?.branches.length ?? 0) > 1;
  return (
    <div className="space-y-4">
      <PageHeader icon={<Landmark className="w-6 h-6" />} title="Neraca" subtitle="Posisi keuangan per tanggal · saldo RAK antar kantor saling menghapus saat konsolidasi" />
      <Filters f={f} set={setF} currentUser={currentUser} asOf>
        {d && <BalancedBadge ok={d.balanced} />}
        {multi && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={perBranch} onChange={(e) => setPerBranch(e.target.checked)} />Kolom per kantor</label>}
        {d && <button className={btnSecondary} onClick={() => statementCsv(`neraca-${f.to}`, sections, footer, d.branches)}><FileSpreadsheet className="w-4 h-4" />CSV</button>}
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto p-2">{!d ? <Spinner /> : <StatementTable sections={sections} footer={footer} branches={d.branches} perBranch={perBranch && multi} />}</Card>
      <p className="text-xs text-slate-500">Margin Murabahah ditangguhkan disajikan sebagai pengurang piutang. Dana kebajikan (ta'zir) adalah kewajiban untuk disalurkan, bukan pendapatan.</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dana kebajikan
// ---------------------------------------------------------------------------
interface Charity {
  opening: number; totalIn: number; totalOut: number; closing: number; purposes: Record<string, string>; byPurpose: { purpose: string; label: string; amount: number }[];
  inflowByBranch: { branch: string; count: number; amount: number }[];
  inflows: { date: string; paymentNo: string; branchCode: string; amount: number; customer: string | null; contractNo: string | null }[];
  disbursements: { id: string; disbNo: string; date: string; recipient: string; purpose: string; description: string; amount: number; method: string; ref: string | null; branchName: string; createdByName: string }[];
}
const CharityPage: React.FC<{ currentUser: AuthUser; canEdit: boolean }> = ({ currentUser, canEdit }) => {
  const [f, setF] = useState<Filter>({ from: yearStart(), to: today(), branchId: '', country: reportCountry });
  const { data: d, error, setError, reload } = useLoad<Charity>(`/accounting/charity${qs({ ...f })}`);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader icon={<HeartHandshake className="w-6 h-6" />} title="Dana Kebajikan" subtitle="Ta'zir keterlambatan tidak diakui sebagai pendapatan — dihimpun & disalurkan untuk kegiatan sosial"
        actions={canEdit ? <button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Catat Penyaluran</button> : undefined} />
      <Filters f={f} set={setF} currentUser={currentUser}>
        {d && <button className={btnSecondary} onClick={() => downloadCsv(`dana-kebajikan-${f.from}-${f.to}`, [['Laporan Sumber & Penggunaan Dana Kebajikan', `${f.from} s/d ${f.to}`], ['Saldo awal', d.opening], ['Penerimaan ta\'zir', d.totalIn], ['Penyaluran', d.totalOut], ['Saldo akhir', d.closing], [], ['No.', 'Tanggal', 'Penerima', 'Tujuan', 'Keterangan', 'Nominal'], ...d.disbursements.map((x) => [x.disbNo, x.date, x.recipient, d.purposes[x.purpose], x.description, x.amount])])}><Download className="w-4 h-4" />CSV</button>}
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!d ? <Spinner /> : <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Saldo awal" value={fmtCur(d.opening)} /><Stat label="Penerimaan ta'zir" value={fmtCur(d.totalIn)} />
          <Stat label="Disalurkan" value={fmtCur(d.totalOut)} /><Stat label="Saldo akhir (wajib disalurkan)" value={fmtCur(d.closing)} tone={d.closing > 0 ? 'warn' : 'ok'} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4"><p className="font-semibold mb-2">Sumber per kantor</p>
            {d.inflowByBranch.map((b) => <div key={b.branch} className="flex justify-between text-sm py-1 border-b border-slate-100 dark:border-slate-700"><span>{b.branch} <span className="text-slate-400">({b.count}×)</span></span><span>{fmtCur(b.amount)}</span></div>)}
            {!d.inflowByBranch.length && <p className="text-sm text-slate-500">Belum ada penerimaan ta'zir.</p>}
          </Card>
          <Card className="p-4"><p className="font-semibold mb-2">Penggunaan per tujuan</p>
            {d.byPurpose.map((b) => <div key={b.purpose} className="flex justify-between text-sm py-1 border-b border-slate-100 dark:border-slate-700"><span>{b.label}</span><span>{fmtCur(b.amount)}</span></div>)}
            {!d.byPurpose.length && <p className="text-sm text-slate-500">Belum ada penyaluran.</p>}
          </Card>
        </div>
        <Card className="overflow-x-auto"><p className="font-semibold p-4 pb-0">Penyaluran</p>
          <table className="w-full text-sm"><thead><tr><Th>No.</Th><Th>Tanggal</Th><Th>Penerima</Th><Th>Tujuan</Th><Th>Keterangan</Th><Th>Kantor</Th><Th right>Nominal</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{d.disbursements.map((x) => <tr key={x.id}><Td className="font-mono text-xs">{x.disbNo}</Td><Td>{x.date}</Td><Td>{x.recipient}</Td><Td>{d.purposes[x.purpose]}</Td><Td className="text-slate-500">{x.description}</Td><Td className="text-xs">{x.branchName}</Td><Td right>{acct(x.amount)}</Td></tr>)}
              {!d.disbursements.length && <tr><Td colSpan={7} className="text-center text-slate-500 py-6">Belum ada penyaluran pada periode ini.</Td></tr>}</tbody></table>
        </Card>
        <Card className="overflow-x-auto"><p className="font-semibold p-4 pb-0">Penerimaan ta'zir</p>
          <table className="w-full text-sm"><thead><tr><Th>Tanggal</Th><Th>Pembayaran</Th><Th>Akad</Th><Th>Nasabah</Th><Th>Kantor</Th><Th right>Ta'zir</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{d.inflows.map((x, i) => <tr key={i}><Td>{x.date}</Td><Td className="font-mono text-xs">{x.paymentNo}</Td><Td className="font-mono text-xs">{x.contractNo}</Td><Td>{x.customer}</Td><Td className="text-xs">{x.branchCode}</Td><Td right>{acct(x.amount)}</Td></tr>)}</tbody></table>
        </Card>
      </>}
      {adding && d && <CharityForm purposes={d.purposes} available={d.closing} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
};

const CharityForm: React.FC<{ purposes: Record<string, string>; available: number; onClose: () => void; onSaved: () => void }> = ({ purposes, available, onClose, onSaved }) => {
  const branches = useBranches();
  const [p, setP] = useState({ branchId: '', date: today(), recipient: '', purpose: 'social', description: '', amount: '', method: 'transfer', ref: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!p.branchId && branches.length) setP((x) => ({ ...x, branchId: branches.find((b) => b.type === 'head_office')?.id ?? branches[0].id })); }, [branches, p.branchId]);
  const save = async () => {
    setError(null);
    try { await api.post('/accounting/charity', { ...p, amount: Number(p.amount), ref: p.ref || null }); onSaved(); } catch (e) { setError((e as ApiError).message); }
  };
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value });
  return (
    <Modal title="Penyaluran Dana Kebajikan" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <p className="text-sm text-slate-500">Saldo tersedia (konsolidasi, sesuai filter): <b>{fmtCur(available)}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Tanggal</label><input type="date" className={inputCls} max={today()} value={p.date} onChange={set('date')} /></div>
          <div><label className={labelCls}>Kantor penyalur</label><select className={inputCls} value={p.branchId} onChange={set('branchId')}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
          <div className="col-span-2"><label className={labelCls}>Penerima</label><input className={inputCls} value={p.recipient} onChange={set('recipient')} placeholder="mis. Panti Asuhan Al-Ikhlas, Jakarta Timur" /></div>
          <div><label className={labelCls}>Tujuan</label><select className={inputCls} value={p.purpose} onChange={set('purpose')}>{Object.entries(purposes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className={labelCls}>Nominal</label><input type="number" min={0} className={inputCls} value={p.amount} onChange={set('amount')} /></div>
          <div className="col-span-2"><label className={labelCls}>Keterangan</label><input className={inputCls} value={p.description} onChange={set('description')} /></div>
          <div><label className={labelCls}>Cara bayar</label><select className={inputCls} value={p.method} onChange={set('method')}><option value="transfer">Transfer bank</option><option value="cash">Tunai</option></select></div>
          <div><label className={labelCls}>No. referensi</label><input className={inputCls} value={p.ref} onChange={set('ref')} /></div>
        </div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={save}>Simpan & jurnal</button></div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Rekonsiliasi piutang
// ---------------------------------------------------------------------------
interface Recon { issues: number; items: { id: string; contractNo: string; status: string; branchCode: string; customer: string; opsOutstanding: number; glReceivable: number; glDeferredMargin: number; glDownPayment: number; marginIncome: number; issue: string | null }[] }
const STATUS_ID: Record<string, string> = { contracted: 'Akad (belum serah terima)', active: 'Berjalan', paid_off: 'Lunas', cancelled: 'Batal' };
const ReconciliationPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [f, setF] = useState<Filter>({ from: '', to: today(), branchId: '', country: reportCountry });
  const { data: d, error, setError } = useLoad<Recon>(`/accounting/reconciliation${qs({ branchId: f.branchId, country: f.country })}`);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const items = useMemo(() => (d ? d.items.filter((i) => !onlyIssues || i.issue) : []), [d, onlyIssues]);
  return (
    <div className="space-y-4">
      <PageHeader icon={<ListChecks className="w-6 h-6" />} title="Rekonsiliasi Piutang Murabahah" subtitle="Buku pembantu per akad (jurnal) dibandingkan dengan sisa angsuran operasional" />
      <Filters f={f} set={setF} currentUser={currentUser} asOf noDate>
        {d && <BalancedBadge ok={d.issues === 0} label={d.issues ? `${d.issues} selisih` : 'Semua cocok'} />}
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Hanya yang bermasalah</label>
      </Filters>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!d ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>Akad</Th><Th>Nasabah</Th><Th>Status</Th><Th right>Sisa angsuran</Th><Th right>Piutang (GL)</Th><Th right>Margin ditangguhkan</Th><Th right>Margin diakui</Th><Th right>Uang muka</Th><Th>Catatan</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {items.map((i) => (
                <tr key={i.id} className={i.issue ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                  <Td className="font-mono text-xs whitespace-nowrap">{i.contractNo} <span className="text-slate-400">{i.branchCode}</span></Td><Td>{i.customer}</Td><Td className="text-xs">{STATUS_ID[i.status] ?? i.status}</Td>
                  <Td right>{acct(i.opsOutstanding)}</Td><Td right>{acct(i.glReceivable)}</Td><Td right>{acct(i.glDeferredMargin)}</Td><Td right>{acct(i.marginIncome)}</Td><Td right>{acct(i.glDownPayment)}</Td>
                  <Td className="text-xs">{i.issue ? <span className="text-red-700 font-semibold">{i.issue}</span> : <span className="text-green-700">Cocok</span>}</Td>
                </tr>
              ))}
              {!items.length && <tr><Td colSpan={9} className="text-center text-slate-500 py-6">Tidak ada data.</Td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Bagan akun & periode
// ---------------------------------------------------------------------------
const CoaPage: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [key, setKey] = useState(0);
  const accounts = useAccounts(key);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (a: Account) => { try { await api.patch(`/accounting/accounts/${a.code}`, { isActive: !a.isActive }); setKey(key + 1); } catch (e) { setError((e as ApiError).message); } };
  return (
    <div className="space-y-4">
      <PageHeader icon={<BookOpen className="w-6 h-6" />} title="Bagan Akun" subtitle="Akun sistem dipakai posting otomatis; akun tambahan bisa dipakai di jurnal manual"
        actions={canEdit ? <button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Akun Baru</button> : undefined} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!accounts.length ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>Kode</Th><Th>Nama</Th><Th>Tipe</Th><Th>Kelompok</Th><Th>Saldo normal</Th><Th right>Baris jurnal</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {accounts.map((a) => (
                <tr key={a.code} className={a.isActive ? '' : 'opacity-50'}>
                  <Td className="font-mono">{a.code}</Td><Td>{a.name}{a.description && <p className="text-xs text-slate-400">{a.description}</p>}</Td><Td>{TYPE_LABEL[a.type]}</Td><Td className="text-xs">{a.groupName}</Td>
                  <Td className="text-xs">{a.normal === 'debit' ? 'Debit' : 'Kredit'}{(a.type === 'asset' || a.type === 'expense') !== (a.normal === 'debit') && <span className="ml-1 text-amber-700">(kontra)</span>}</Td>
                  <Td right>{a.lines ?? 0}</Td>
                  <Td>{a.isSystem ? <span className="text-xs text-slate-500">Sistem</span> : canEdit ? <button className="text-xs underline" onClick={() => toggle(a)}>{a.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button> : a.isActive ? 'Aktif' : 'Nonaktif'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding && <AccountForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setKey(key + 1); }} />}
    </div>
  );
};

const AccountForm: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [p, setP] = useState({ code: '', name: '', type: 'expense', groupName: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const save = async () => { try { await api.post('/accounting/accounts', { ...p, description: p.description || null }); onSaved(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <Modal title="Akun Baru" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Kode</label><input className={inputCls} value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} placeholder="mis. 6110" /></div>
          <div><label className={labelCls}>Tipe</label><select className={inputCls} value={p.type} onChange={(e) => setP({ ...p, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="col-span-2"><label className={labelCls}>Nama akun</label><input className={inputCls} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
          <div className="col-span-2"><label className={labelCls}>Kelompok laporan</label><input className={inputCls} value={p.groupName} onChange={(e) => setP({ ...p, groupName: e.target.value })} placeholder="mis. Beban Operasional" /></div>
          <div className="col-span-2"><label className={labelCls}>Keterangan</label><input className={inputCls} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
        </div>
        <p className="text-xs text-slate-500">Digit pertama: 1 aset, 2 kewajiban, 3 ekuitas, 4 pendapatan, 5–9 beban.</p>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={save}>Simpan</button></div>
      </div>
    </Modal>
  );
};

interface Period { period: string; entries: number; manual: number; closed: boolean; closedAt: string | null; closedBy: string | null; note: string | null }
const PeriodsPage: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { data: d, error, setError, reload } = useLoad<{ periods: Period[]; current: string }>('/accounting/periods');
  const act = useCallback(async (p: Period) => {
    try {
      if (p.closed) {
        const reason = window.prompt(`Alasan membuka kembali periode ${p.period}:`);
        if (!reason) return;
        await api.post(`/accounting/periods/${p.period}/reopen`, { reason });
      } else await api.post(`/accounting/periods/${p.period}/close`, { note: null });
      reload();
    } catch (e) { setError((e as ApiError).message); }
  }, [reload, setError]);
  return (
    <div className="space-y-4">
      <PageHeader icon={<Lock className="w-6 h-6" />} title="Tutup Periode" subtitle="Periode tertutup tidak menerima jurnal manual; transaksi terlambat dibukukan pada tanggal berjalan" />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!d ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40"><tr><Th>Periode</Th><Th right>Jurnal</Th><Th right>Manual</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.periods.map((p) => (
                <tr key={p.period}>
                  <Td className="font-semibold">{p.period}{p.period === d.current && <span className="ml-2 text-xs text-slate-500">(berjalan)</span>}</Td><Td right>{p.entries}</Td><Td right>{p.manual}</Td>
                  <Td>{p.closed ? <span className="text-xs text-slate-600 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />Ditutup {p.closedBy} · {formatDateTime(p.closedAt)}</span> : <span className="text-xs text-green-700 flex items-center gap-1"><Unlock className="w-3.5 h-3.5" />Terbuka</span>}</Td>
                  <Td right>{canEdit && p.period < d.current && <button className={btnSecondary} onClick={() => act(p)}>{p.closed ? <><Unlock className="w-4 h-4" />Buka kembali</> : <><Lock className="w-4 h-4" />Tutup periode</>}</button>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
