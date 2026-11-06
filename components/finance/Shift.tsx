import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, LockOpen, Lock, CheckCircle, Eye } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

export interface Shift {
  id: string; shiftNo: string; status: 'open' | 'closed' | 'verified'; openedAt: string; openingCash: number; closedAt: string | null;
  cashIn: number | null; cashOut: number | null; expectedCash: number | null; countedCash: number | null; variance: number | null;
  depositAmount: number | null; depositRef: string | null; closingNote: string | null; verifiedAt: string | null; verifyNote: string | null; userName?: string;
}
interface Summary { cashIn: number; cashOut: number; expectedCash: number; movements: { type: 'in' | 'out'; no: string; label: string; amount: number; at: string | null }[] }

const STATUS: Record<Shift['status'], [string, string]> = {
  open: ['Berjalan', 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'],
  closed: ['Ditutup — menunggu verifikasi', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'],
  verified: ['Terverifikasi', 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'],
};
export const ShiftBadge: React.FC<{ s: Shift['status'] }> = ({ s }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[s][1]}`}>{STATUS[s][0]}</span>;

/** Pengingat di halaman kasir bila belum membuka shift. */
export const ShiftBanner: React.FC<{ onGo?: () => void }> = ({ onGo }) => {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => { api.get<{ shift: Shift | null }>('/shifts/current').then((r) => setOpen(!!r.shift)).catch(() => setOpen(null)); }, []);
  if (open !== false) return null;
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200 text-sm">
      <span className="flex items-center gap-2"><Lock className="w-4 h-4" />Shift kas belum dibuka — transaksi <b>tunai</b> tidak dapat dicatat.</span>
      {onGo && <button className={btnSecondary} onClick={onGo}>Buka shift</button>}
    </div>
  );
};

const Movements: React.FC<{ s: Summary; opening: number }> = ({ s, opening }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Tile k="Saldo awal" v={formatMoney(opening)} /><Tile k="Kas masuk" v={formatMoney(s.cashIn)} cls="text-green-700" />
      <Tile k="Kas keluar" v={formatMoney(s.cashOut)} cls="text-red-600" /><Tile k="Saldo menurut sistem" v={formatMoney(s.expectedCash)} />
    </div>
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Waktu</th><th className="text-left px-4 py-2">No.</th><th className="text-left px-4 py-2">Keterangan</th><th className="text-right px-4 py-2">Masuk</th><th className="text-right px-4 py-2">Keluar</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {s.movements.map((m) => (
            <tr key={m.no}><td className="px-4 py-2 text-xs">{formatDateTime(m.at)}</td><td className="px-4 py-2 font-mono text-xs">{m.no}</td><td className="px-4 py-2 text-xs">{m.label}</td>
              <td className="px-4 py-2 text-right text-green-700">{m.type === 'in' ? formatMoney(m.amount) : ''}</td><td className="px-4 py-2 text-right text-red-600">{m.type === 'out' ? formatMoney(m.amount) : ''}</td></tr>
          ))}
          {s.movements.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-slate-500">Belum ada transaksi tunai di shift ini.</td></tr>}
        </tbody>
      </table>
    </Card>
  </div>
);

const Tile: React.FC<{ k: string; v: string; cls?: string }> = ({ k, v, cls = '' }) => (
  <Card className="p-4"><p className={`text-lg font-bold text-slate-800 dark:text-white ${cls}`}>{v}</p><p className="text-xs text-slate-500">{k}</p></Card>
);

/** Kasir / Admin Cabang: buka shift, pantau kas, tutup shift & setoran bank. */
export const CashierShiftPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [cur, setCur] = useState<{ shift: Shift | null; summary: Summary | null } | null>(null);
  const [hist, setHist] = useState<Shift[]>([]);
  const [opening, setOpening] = useState(500000);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ shift: Shift | null; summary: Summary | null }>('/shifts/current').then(setCur).catch((e) => setError((e as ApiError).message));
    api.get<{ shifts: Shift[] }>('/shifts').then((r) => setHist(r.shifts.filter((s) => s.status !== 'open'))).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  const open = async () => { setError(null); try { await api.post('/shifts/open', { openingCash: opening }); load(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Wallet className="w-6 h-6" />} title="Shift & Setoran Kas" subtitle={`Saldo awal → penerimaan & pengeluaran tunai → hitung fisik, setor ke bank. Diverifikasi Manager Cabang ${currentUser.branch?.name ?? ''}.`}
        actions={cur?.shift ? <button className={btnPrimary} onClick={() => setClosing(true)}><Lock className="w-4 h-4" />Tutup Shift</button> : undefined} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!cur ? <Spinner /> : cur.shift ? (<>
        <Card className="p-4 flex flex-wrap items-center gap-3 text-sm"><LockOpen className="w-5 h-5 text-blue-600" /><span className="font-mono">{cur.shift.shiftNo}</span><ShiftBadge s="open" /><span className="text-slate-500">dibuka {formatDateTime(cur.shift.openedAt)}</span></Card>
        <Movements s={cur.summary!} opening={cur.shift.openingCash} />
      </>) : (
        <Card className="p-6 max-w-md space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">Belum ada shift berjalan. Hitung uang di laci kas lalu buka shift.</p>
          <div><label className={labelCls}>Saldo awal kas (uang kembalian)</label><input type="number" min={0} className={inputCls} value={opening} onChange={(e) => setOpening(Number(e.target.value))} /></div>
          <button className={btnPrimary} onClick={open}><LockOpen className="w-4 h-4" />Buka Shift</button>
        </Card>
      )}
      {hist.length > 0 && <ShiftTable rows={hist} title="Riwayat shift" />}
      {closing && cur?.shift && <CloseShiftModal shift={cur.shift} summary={cur.summary!} onClose={() => setClosing(false)} onDone={() => { setClosing(false); load(); }} />}
    </div>
  );
};

const CloseShiftModal: React.FC<{ shift: Shift; summary: Summary; onClose: () => void; onDone: () => void }> = ({ shift, summary, onClose, onDone }) => {
  const [counted, setCounted] = useState(summary.expectedCash);
  const [deposit, setDeposit] = useState(Math.max(0, summary.expectedCash - shift.openingCash));
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const variance = counted - summary.expectedCash;
  const submit = async () => {
    setError(null);
    try { await api.post(`/shifts/${shift.id}/close`, { countedCash: counted, depositAmount: deposit, depositRef: ref || null, note: note || null }); onDone(); } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <Modal title={`Tutup Shift ${shift.shiftNo}`} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox message={error} />
        <p className="text-sm">Saldo menurut sistem: <b>{formatMoney(summary.expectedCash)}</b></p>
        <div><label className={labelCls}>Kas fisik dihitung</label><input type="number" className={inputCls} value={counted} onChange={(e) => setCounted(Number(e.target.value))} /></div>
        <p className={`text-sm font-semibold ${variance === 0 ? 'text-green-700' : 'text-red-600'}`}>Selisih: {formatMoney(variance)} {variance === 0 ? '(cocok)' : variance > 0 ? '(lebih)' : '(kurang)'}</p>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Setor ke bank</label><input type="number" className={inputCls} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} /></div>
          <div><label className={labelCls}>No. bukti setoran</label><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <p className="text-xs text-slate-500">Sisa di laci (saldo awal shift berikutnya): {formatMoney(counted - deposit)}</p>
        <div><label className={labelCls}>Catatan {variance !== 0 && '(wajib bila selisih melebihi toleransi)'}</label><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} onClick={submit}>Tutup Shift</button></div>
      </div>
    </Modal>
  );
};

const ShiftTable: React.FC<{ rows: Shift[]; title: string; onOpen?: (s: Shift) => void }> = ({ rows, title, onOpen }) => (
  <Card className="overflow-hidden">
    <p className="px-4 pt-4 text-xs font-bold uppercase text-slate-500">{title}</p>
    <table className="w-full text-sm">
      <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Shift</th><th className="text-left px-4 py-2">Petugas</th><th className="text-right px-4 py-2">Sistem</th><th className="text-right px-4 py-2">Fisik</th>
        <th className="text-right px-4 py-2">Selisih</th><th className="text-right px-4 py-2">Setor bank</th><th className="text-left px-4 py-2">Status</th>{onOpen && <th />}</tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
        {rows.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-2"><span className="font-mono text-xs">{s.shiftNo}</span><span className="block text-xs text-slate-500">{formatDateTime(s.openedAt)} – {s.closedAt ? formatDateTime(s.closedAt) : '…'}</span></td>
            <td className="px-4 py-2 text-xs">{s.userName}</td>
            <td className="px-4 py-2 text-right">{s.expectedCash !== null ? formatMoney(s.expectedCash) : '—'}</td>
            <td className="px-4 py-2 text-right">{s.countedCash !== null ? formatMoney(s.countedCash) : '—'}</td>
            <td className={`px-4 py-2 text-right font-semibold ${s.variance ? 'text-red-600' : 'text-green-700'}`}>{s.variance !== null ? formatMoney(s.variance) : '—'}</td>
            <td className="px-4 py-2 text-right">{s.depositAmount !== null ? formatMoney(s.depositAmount) : '—'}<span className="block text-[11px] text-slate-400">{s.depositRef}</span></td>
            <td className="px-4 py-2"><ShiftBadge s={s.status} />{s.closingNote && <span className="block text-[11px] text-slate-500 mt-1">{s.closingNote}</span>}</td>
            {onOpen && <td className="px-4 py-2 text-right"><button className={btnSecondary} onClick={() => onOpen(s)}><Eye className="w-4 h-4" />{s.status === 'closed' ? 'Verifikasi' : 'Lihat'}</button></td>}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-slate-500">Belum ada shift.</td></tr>}
      </tbody>
    </table>
  </Card>
);

/** Manager Cabang / BM: pantau & verifikasi shift kasir. */
export const ShiftVerifyPage: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [rows, setRows] = useState<Shift[] | null>(null);
  const [status, setStatus] = useState('closed');
  const [open, setOpen] = useState<{ shift: Shift; summary: Summary } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.get<{ shifts: Shift[] }>(`/shifts${qs({ status: status || undefined })}`).then((r) => setRows(r.shifts)).catch((e) => setError((e as ApiError).message)); }, [status]);
  useEffect(load, [load]);
  const view = async (s: Shift) => { try { setOpen(await api.get(`/shifts/${s.id}`)); setNote(''); } catch (e) { setError((e as ApiError).message); } };
  const verify = async () => { try { await api.post(`/shifts/${open!.shift.id}/verify`, { note: note || null }); setOpen(null); load(); } catch (e) { setError((e as ApiError).message); } };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Wallet className="w-6 h-6" />} title="Kas & Shift Kasir" subtitle={`Verifikasi hasil tutup shift: saldo sistem vs hitung fisik, selisih, dan setoran bank ${currentUser.branch?.type === 'branch' ? currentUser.branch.name : 'seluruh cabang'}.`} />
      <Card className="p-4 flex gap-2">
        {[['closed', 'Menunggu verifikasi'], ['open', 'Berjalan'], ['verified', 'Terverifikasi'], ['', 'Semua']].map(([k, v]) => (
          <button key={k} onClick={() => setStatus(k)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${status === k ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{v}</button>
        ))}
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!rows ? <Spinner /> : <ShiftTable rows={rows} title="Daftar shift" onOpen={view} />}
      {open && (
        <Modal wide="xl" title={<span className="flex items-center gap-2">Shift {open.shift.shiftNo} · {open.shift.userName} <ShiftBadge s={open.shift.status} /></span>} onClose={() => setOpen(null)}>
          <div className="space-y-4">
            <Movements s={open.summary} opening={open.shift.openingCash} />
            {open.shift.status !== 'open' && (
              <div className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
                <p>Fisik: <b>{formatMoney(open.shift.countedCash)}</b></p><p>Selisih: <b className={open.shift.variance ? 'text-red-600' : 'text-green-700'}>{formatMoney(open.shift.variance)}</b></p>
                <p>Setor: <b>{formatMoney(open.shift.depositAmount)}</b> {open.shift.depositRef}</p><p className="text-slate-500">{open.shift.closingNote}</p>
              </div>
            )}
            {open.shift.status === 'closed' && (
              <div className="flex gap-2 items-end">
                <input className={inputCls} placeholder="Catatan verifikasi (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className={btnPrimary} onClick={verify}><CheckCircle className="w-4 h-4" />Verifikasi</button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

