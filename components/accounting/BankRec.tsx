import React, { useMemo, useState } from 'react';
import { Landmark, Plus, Upload, Wand2, Link2, FileCheck2, EyeOff, Undo2, AlertTriangle } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { Card, ErrorBox, Spinner, Modal, PageHeader, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { Chip, Empty, Flash, Pill, Stat, Th, errMsg, money, tbody, thead, today, useLoad } from '../common/kit';

interface ColumnMap { date: string; description: string; debit?: string; credit?: string; amount?: string; dc?: string; balance?: string; reference?: string; dateFormat: 'dmy' | 'mdy'; decimal?: ',' | '.'; delimiter?: string; skipRows?: number }
interface Account {
  id: string; branchId: string; branchName: string; countryCode: string; bankName: string; accountNo: string; accountName: string; currency: string; preset: string; columnMap: ColumnMap | null; isActive: boolean;
  summary: { statementBalance: number | null; statementDate: string | null; bookBalance: number; difference: number | null; unmatched: number };
}
interface Line { id: string; txDate: string; description: string; reference: string | null; debit: number; credit: number; balance: number | null; status: string; matchType: string | null; matchRefs: { type: string; id: string; no?: string; amount?: number }[] | null; note: string | null }
interface Candidate { type: string; id: string; no: string; amount: number; date: string; label: string }
interface Summary { asOf: string; statementBalance: number | null; statementDate: string | null; bookBalance: number; difference: number | null; status: Record<string, { count: number; debit: number; credit: number }>; unmatchedIn: number; unmatchedOut: number; sharedBookAccount: boolean }
interface Preview { ok: boolean; error?: string; header?: string[]; columnMap?: ColumnMap; sample?: { txDate: string; description: string; debit: number; credit: number; balance: number | null; reference: string | null }[]; total?: number; skipped?: { row: number; reason: string }[]; raw: string[][] }

const LINE_STATUS: Record<string, [string, string]> = { unmatched: ['Belum cocok', 'amber'], matched: ['Cocok', 'green'], posted: ['Dijurnal', 'blue'], ignored: ['Diabaikan', 'slate'] };
const CAND_TYPE: Record<string, string> = {
  shift_deposit: 'Setoran shift kasir', customer_transfer: 'Transfer nasabah', supplier_payment: 'Bayar pemasok', refund: 'Refund nasabah', expense: 'Biaya operasional', charity: 'Dana kebajikan',
  gateway_settlement: 'Settlement gateway', bank_fee: 'Biaya bank', other_income: 'Pendapatan lain',
};

/** Rekonsiliasi Bank (Bookkeeping): impor rekening koran CSV, cocokkan dengan transaksi, jurnal selisih. */
export const BankRecModule: React.FC = () => {
  const { data, error, setError, reload } = useLoad<{ accounts: Account[] }>('/bank/accounts');
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const acc = data?.accounts.find((a) => a.id === sel) ?? null;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Landmark className="w-6 h-6" />} title="Rekonsiliasi Bank"
        subtitle="Impor mutasi rekening (CSV BCA / Mandiri / BSI / format umum) → cocokkan otomatis dengan setoran, transfer nasabah, pembayaran pemasok, refund & biaya → jurnal biaya bank / settlement gateway."
        actions={<button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Rekening</button>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!data ? <Spinner /> : data.accounts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">Belum ada rekening bank. Tambahkan rekening operasional Pusat / cabang terlebih dahulu.</Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.accounts.map((a) => (
            <button key={a.id} onClick={() => setSel(a.id)} className={`text-left rounded-xl border p-4 bg-white dark:bg-slate-800 transition ${sel === a.id ? 'border-masri-primary ring-2 ring-masri-primary/30' : 'border-slate-200 dark:border-slate-700 hover:border-masri-primary/60'} ${a.isActive ? '' : 'opacity-60'}`}>
              <p className="font-bold text-slate-800 dark:text-white">{a.bankName} · {a.accountNo}</p>
              <p className="text-xs text-slate-500">{a.accountName} · {a.branchName}</p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div><p className="text-slate-500">Saldo rekening koran</p><p className="font-semibold">{a.summary.statementBalance == null ? '—' : money(a.summary.statementBalance, a.countryCode)}</p><p className="text-slate-400">{a.summary.statementDate ?? 'belum ada impor'}</p></div>
                <div><p className="text-slate-500">Saldo buku (1102)</p><p className="font-semibold">{money(a.summary.bookBalance, a.countryCode)}</p>
                  {a.summary.difference != null && <p className={Math.abs(a.summary.difference) < 1 ? 'text-green-600' : 'text-red-600'}>selisih {money(a.summary.difference, a.countryCode)}</p>}</div>
              </div>
              {a.summary.unmatched > 0 && <p className="mt-2 text-xs text-amber-600 font-semibold">{a.summary.unmatched} mutasi belum dicocokkan</p>}
            </button>
          ))}
        </div>
      )}
      {acc && <AccountWork key={acc.id} acc={acc} onChanged={reload} />}
      {adding && <AccountForm onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); reload(); setSel(id); }} />}
    </div>
  );
};

const AccountForm: React.FC<{ onClose: () => void; onDone: (id: string) => void }> = ({ onClose, onDone }) => {
  const { data: br } = useLoad<{ branches: { id: string; code: string; name: string; countryCode: string }[] }>('/branches');
  const { data: pr } = useLoad<{ presets: { code: string; label: string; note: string }[] }>('/bank/presets');
  const [f, setF] = useState({ branchId: '', bankName: '', accountNo: '', accountName: 'PT Masri-M Syariah', preset: 'generic' });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { const r = await api.post<{ account: { id: string } }>('/bank/accounts', f); onDone(r.account.id); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title="Tambah rekening bank" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox message={err} />
        <div><label className={labelCls}>Kantor pemilik rekening</label><select className={inputCls} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">— pilih —</option>{br?.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name} ({b.countryCode})</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Bank</label><input className={inputCls} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} placeholder="BCA" /></div>
          <div><label className={labelCls}>No. rekening</label><input className={inputCls} value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></div>
        </div>
        <div><label className={labelCls}>Atas nama</label><input className={inputCls} value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></div>
        <div><label className={labelCls}>Format rekening koran</label><select className={inputCls} value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value })}>{pr?.presets.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select>
          <p className="text-xs text-slate-500 mt-1">{pr?.presets.find((p) => p.code === f.preset)?.note}</p></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={!f.branchId || f.accountNo.length < 4 || f.bankName.length < 2} onClick={save}>Simpan</button></div>
      </div>
    </Modal>
  );
};

const AccountWork: React.FC<{ acc: Account; onChanged: () => void }> = ({ acc, onChanged }) => {
  const [status, setStatus] = useState('unmatched');
  const [asOf, setAsOf] = useState(today());
  const lines = useLoad<{ lines: Line[] }>(`/bank/lines${qs({ accountId: acc.id, status: status || undefined })}`);
  const sum = useLoad<Summary>(`/bank/accounts/${acc.id}/summary?to=${asOf}`);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState<Line | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { lines.reload(); sum.reload(); onChanged(); };
  const auto = async () => { try { const r = await api.post<{ matched: number }>(`/bank/accounts/${acc.id}/auto-match`); setFlash(`${r.matched} mutasi dicocokkan otomatis.`); refresh(); } catch (e) { setErr(errMsg(e)); } };
  const act = async (l: Line, path: string, body: object = {}) => { try { await api.post(`/bank/lines/${l.id}/${path}`, body); refresh(); } catch (e) { setErr(errMsg(e)); } };
  const s = sum.data;
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        <h3 className="font-bold mr-2">{acc.bankName} {acc.accountNo}</h3>
        <button className={btnPrimary} onClick={() => setImporting(true)}><Upload className="w-4 h-4" />Impor rekening koran</button>
        <button className={btnSecondary} onClick={auto}><Wand2 className="w-4 h-4" />Cocokkan otomatis</button>
        <label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Per tanggal <input type="date" className={`${inputCls.replace("w-full", "")} w-40`} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      </Card>
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <ErrorBox message={err ?? lines.error ?? sum.error} onClose={() => { setErr(null); lines.setError(null); sum.setError(null); }} />
      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Saldo rekening koran" value={s.statementBalance == null ? '—' : money(s.statementBalance, acc.countryCode)} hint={s.statementDate ?? undefined} />
            <Stat label="Saldo buku (Bank 1102)" value={money(s.bookBalance, acc.countryCode)} hint={acc.branchName} />
            <Stat label="Selisih" value={s.difference == null ? '—' : money(s.difference, acc.countryCode)} tone={s.difference == null ? undefined : Math.abs(s.difference) < 1 ? 'green' : 'red'} />
            <Stat label="Uang masuk belum cocok" value={money(s.unmatchedIn, acc.countryCode)} tone={s.unmatchedIn ? 'amber' : undefined} />
            <Stat label="Uang keluar belum cocok" value={money(s.unmatchedOut, acc.countryCode)} tone={s.unmatchedOut ? 'amber' : undefined} />
          </div>
          {s.sharedBookAccount && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Kantor ini punya lebih dari satu rekening aktif — saldo buku 1102 adalah gabungan semua rekening kantor tersebut.</p>}
        </>
      )}
      <Card className="p-4 flex flex-wrap gap-2">
        {[['unmatched', 'Belum cocok'], ['matched', 'Cocok'], ['posted', 'Dijurnal'], ['ignored', 'Diabaikan'], ['', 'Semua']].map(([k, v]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{v}{s?.status[k] ? ` (${s.status[k].count})` : ''}</Chip>)}
      </Card>
      <Card className="overflow-x-auto">
        {!lines.data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>Tanggal</Th><Th>Keterangan</Th><Th right>Keluar (D)</Th><Th right>Masuk (K)</Th><Th right>Saldo</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {lines.data.lines.length === 0 && <Empty cols={7}>Tidak ada mutasi{status === 'unmatched' ? ' yang perlu dicocokkan' : ''}.</Empty>}
              {lines.data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{l.txDate}</td>
                  <td className="px-4 py-2 max-w-md"><span className="break-words">{l.description}</span>{l.reference && <span className="block text-xs text-slate-500">Ref {l.reference}</span>}
                    {l.matchRefs?.length ? <span className="block text-xs text-green-700 dark:text-green-400">{CAND_TYPE[l.matchType ?? ''] ?? l.matchType}: {l.matchRefs.map((r) => r.no ?? r.id.slice(0, 8)).join(', ')}</span> : null}
                    {l.note && <span className="block text-xs text-slate-500">{l.note}</span>}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap text-red-600">{l.debit ? money(l.debit, acc.countryCode) : ''}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap text-green-700">{l.credit ? money(l.credit, acc.countryCode) : ''}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap text-slate-500">{l.balance == null ? '' : money(l.balance, acc.countryCode)}</td>
                  <td className="px-4 py-2"><Pill map={LINE_STATUS} s={l.status} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {l.status === 'unmatched' && <>
                      <button className="text-xs text-masri-primary hover:underline inline-flex items-center gap-1" onClick={() => setMatching(l)}><Link2 className="w-3 h-3" />Cocokkan</button>
                      <button className="ml-3 text-xs text-slate-500 hover:underline inline-flex items-center gap-1" onClick={() => { const note = window.prompt('Alasan diabaikan (mis. pindah buku antar rekening sendiri):'); if (note) act(l, 'ignore', { note }); }}><EyeOff className="w-3 h-3" />Abaikan</button>
                    </>}
                    {(l.status === 'matched' || l.status === 'ignored') && <button className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1" onClick={() => { if (window.confirm('Batalkan pencocokan mutasi ini?')) act(l, 'unmatch'); }}><Undo2 className="w-3 h-3" />Batalkan</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {importing && <ImportModal acc={acc} onClose={() => setImporting(false)} onDone={(m) => { setImporting(false); setFlash(m); setStatus('unmatched'); refresh(); }} />}
      {matching && <MatchModal line={matching} acc={acc} onClose={() => setMatching(null)} onDone={() => { setMatching(null); refresh(); }} />}
    </div>
  );
};

const MAP_FIELDS: [keyof ColumnMap, string, boolean][] = [['date', 'Tanggal', true], ['description', 'Keterangan', true], ['debit', 'Debit (keluar)', false], ['credit', 'Kredit (masuk)', false], ['amount', 'Jumlah (bila satu kolom)', false], ['dc', 'Penanda D/K', false], ['balance', 'Saldo', false], ['reference', 'No. referensi', false]];

const ImportModal: React.FC<{ acc: Account; onClose: () => void; onDone: (m: string) => void }> = ({ acc, onClose, onDone }) => {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = async (content: string, cm: ColumnMap | null) => {
    setBusy(true); setErr(null);
    try { const r = await api.post<Preview>(`/bank/accounts/${acc.id}/preview`, { content, columnMap: cm }); setPv(r); if (r.columnMap) setMap(r.columnMap); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) { setErr('File terlalu besar (maks. 5 MB)'); return; }
    const rd = new FileReader();
    rd.onload = () => { const content = String(rd.result ?? ''); setFile({ name: f.name, content }); setMap(null); preview(content, null); };
    rd.readAsText(f);
  };
  const header = pv?.header ?? pv?.raw?.[0] ?? [];
  const doImport = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ rows: number; newRows: number; duplicates: number; autoMatched: number; skipped: unknown[]; dateFrom: string; dateTo: string }>(`/bank/accounts/${acc.id}/import`, { filename: file.name, content: file.content, columnMap: map });
      onDone(`${file.name}: ${r.newRows} mutasi baru (${r.dateFrom} s/d ${r.dateTo})${r.duplicates ? `, ${r.duplicates} sudah pernah diimpor` : ''}${r.skipped.length ? `, ${r.skipped.length} baris dilewati` : ''}. ${r.autoMatched} langsung cocok otomatis.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Impor rekening koran — ${acc.bankName} ${acc.accountNo}`} onClose={onClose} wide="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${btnSecondary} cursor-pointer`}><Upload className="w-4 h-4" />Pilih file CSV<input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          {file && <span className="text-sm text-slate-600 dark:text-slate-300">{file.name}</span>}
          <span className="text-xs text-slate-500">Format rekening: <b>{acc.preset.toUpperCase()}</b>. Mutasi yang sudah pernah diimpor otomatis dilewati.</span>
        </div>
        <ErrorBox message={err ?? (pv && !pv.ok ? pv.error ?? 'Format tidak dikenali' : null)} />
        {busy && <Spinner label="Membaca file..." />}
        {pv && header.length > 0 && (
          <Card className="p-4">
            <h4 className="font-semibold text-sm mb-2">Pemetaan kolom {pv.ok ? <span className="text-green-600 text-xs">(terdeteksi otomatis — ubah bila keliru)</span> : <span className="text-amber-600 text-xs">(pilih manual)</span>}</h4>
            <div className="grid md:grid-cols-4 gap-3">
              {MAP_FIELDS.map(([k, label, req]) => (
                <div key={k}><label className={labelCls}>{label}{req ? ' *' : ''}</label>
                  <select className={inputCls} value={String(map?.[k] ?? '')} onChange={(e) => setMap({ ...(map ?? { date: '', description: '', dateFormat: 'dmy' }), [k]: e.target.value || undefined } as ColumnMap)}>
                    <option value="">—</option>{header.map((h, i) => <option key={i} value={h}>{h}</option>)}
                  </select></div>
              ))}
              <div><label className={labelCls}>Format tanggal</label><select className={inputCls} value={map?.dateFormat ?? 'dmy'} onChange={(e) => setMap({ ...(map ?? { date: '', description: '' }), dateFormat: e.target.value as 'dmy' } as ColumnMap)}><option value="dmy">Hari/Bulan/Tahun</option><option value="mdy">Bulan/Hari/Tahun</option></select></div>
              <div><label className={labelCls}>Pemisah desimal</label><select className={inputCls} value={map?.decimal ?? ''} onChange={(e) => setMap({ ...(map ?? { date: '', description: '', dateFormat: 'dmy' }), decimal: (e.target.value || undefined) as ',' } as ColumnMap)}><option value="">Otomatis</option><option value=",">Koma (1.250.000,00)</option><option value=".">Titik (1,250,000.00)</option></select></div>
            </div>
            <div className="mt-3"><button className={btnSecondary} disabled={!file || !map?.date || !map?.description} onClick={() => file && preview(file.content, map)}>Terapkan pemetaan & pratinjau ulang</button></div>
          </Card>
        )}
        {pv?.ok && pv.sample && (
          <Card className="overflow-x-auto">
            <p className="px-4 pt-3 text-sm"><b>{pv.total}</b> mutasi terbaca{pv.skipped?.length ? <span className="text-amber-600"> · {pv.skipped.length} baris dilewati ({pv.skipped.slice(0, 3).map((s) => `baris ${s.row}: ${s.reason}`).join('; ')})</span> : null}. Pratinjau 10 baris pertama:</p>
            <table className="w-full text-sm mt-2"><thead className={thead}><tr><Th>Tanggal</Th><Th>Keterangan</Th><Th right>Keluar</Th><Th right>Masuk</Th><Th right>Saldo</Th></tr></thead>
              <tbody className={tbody}>{pv.sample.map((l, i) => <tr key={i}><td className="px-4 py-1.5">{l.txDate}</td><td className="px-4 py-1.5">{l.description}</td><td className="px-4 py-1.5 text-right">{l.debit ? money(l.debit, acc.countryCode) : ''}</td><td className="px-4 py-1.5 text-right">{l.credit ? money(l.credit, acc.countryCode) : ''}</td><td className="px-4 py-1.5 text-right text-slate-500">{l.balance == null ? '' : money(l.balance, acc.countryCode)}</td></tr>)}</tbody></table>
          </Card>
        )}
        {pv && !pv.ok && pv.raw.length > 0 && (
          <Card className="overflow-x-auto p-2"><p className="text-xs text-slate-500 px-2 pb-1">Isi mentah file (12 baris pertama):</p>
            <table className="text-xs"><tbody>{pv.raw.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-0.5 border border-slate-100 dark:border-slate-700 whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table></Card>
        )}
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={busy || !file || !pv?.ok} onClick={doImport}><FileCheck2 className="w-4 h-4" />Impor {pv?.total ?? ''} mutasi</button></div>
      </div>
    </Modal>
  );
};

const MatchModal: React.FC<{ line: Line; acc: Account; onClose: () => void; onDone: () => void }> = ({ line, acc, onClose, onDone }) => {
  const [any, setAny] = useState(false);
  const { data, error } = useLoad<{ candidates: Candidate[] }>(`/bank/lines/${line.id}/candidates${any ? '?any=1' : ''}`);
  const [picked, setPicked] = useState<Record<string, Candidate>>({});
  const [post, setPost] = useState<'gateway_settlement' | 'bank_fee' | 'other_income' | ''>('');
  const [gross, setGross] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const amount = line.credit || line.debit;
  const pickedSum = useMemo(() => (Object.values(picked) as Candidate[]).reduce((t, c) => t + c.amount, 0), [picked]);
  const toggle = (c: Candidate) => setPicked((p) => { const k = `${c.type}:${c.id}`; const n = { ...p }; if (n[k]) delete n[k]; else n[k] = c; return n; });
  const match = async () => {
    try { await api.post(`/bank/lines/${line.id}/match`, { refs: (Object.values(picked) as Candidate[]).map((c) => ({ type: c.type, id: c.id })), note: note || null }); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  const doPost = async () => {
    try { await api.post(`/bank/lines/${line.id}/post`, { type: post, gross: post === 'gateway_settlement' && gross ? Number(gross) : null, note: note || null }); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title="Cocokkan mutasi bank" onClose={onClose} wide="xl">
      <div className="space-y-4">
        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 text-sm">
          <p><b>{line.txDate}</b> · {line.description}</p>
          <p className={line.credit ? 'text-green-700' : 'text-red-600'}>{line.credit ? 'Uang masuk' : 'Uang keluar'} {money(amount, acc.countryCode)}</p>
        </div>
        <ErrorBox message={err ?? error} />
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">Transaksi yang sudah dibukukan & belum dicocokkan</h4>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={any} onChange={(e) => setAny(e.target.checked)} />Tampilkan semua nominal (±31 hari) — untuk setoran gabungan</label>
        </div>
        {!data ? <Spinner /> : data.candidates.length === 0 ? <p className="text-sm text-slate-500">Tidak ada transaksi yang cocok. Bila ini biaya administrasi bank, settlement gateway, atau bagi hasil/pendapatan lain, jurnalkan di bawah.</p> : (
          <table className="w-full text-sm"><thead className={thead}><tr><Th /><Th>Jenis</Th><Th>No.</Th><Th>Tanggal</Th><Th>Keterangan</Th><Th right>Nominal</Th></tr></thead>
            <tbody className={tbody}>{data.candidates.map((c) => {
              const k = `${c.type}:${c.id}`;
              return <tr key={k} className={`cursor-pointer ${picked[k] ? 'bg-green-50 dark:bg-green-900/20' : ''}`} onClick={() => toggle(c)}>
                <td className="px-4 py-2"><input type="checkbox" readOnly checked={!!picked[k]} /></td><td className="px-4 py-2">{CAND_TYPE[c.type] ?? c.type}</td><td className="px-4 py-2 font-mono text-xs">{c.no}</td>
                <td className="px-4 py-2">{c.date}</td><td className="px-4 py-2 text-xs text-slate-500">{c.label}</td><td className="px-4 py-2 text-right">{money(c.amount, acc.countryCode)}</td></tr>;
            })}</tbody></table>
        )}
        {Object.keys(picked).length > 0 && (
          <p className={`text-sm ${Math.abs(pickedSum - amount) < 0.01 ? 'text-green-700' : 'text-amber-600'}`}>Dipilih {Object.keys(picked).length} transaksi = {money(pickedSum, acc.countryCode)}{Math.abs(pickedSum - amount) >= 0.01 ? ` (selisih ${money(amount - pickedSum, acc.countryCode)} — jumlah harus sama)` : ' — sesuai'}</p>
        )}
        <div><label className={labelCls}>Catatan</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end"><button className={btnPrimary} disabled={!Object.keys(picked).length || Math.abs(pickedSum - amount) >= 0.01} onClick={match}><Link2 className="w-4 h-4" />Cocokkan</button></div>
        <Card className="p-4 space-y-3">
          <h4 className="font-semibold text-sm">Atau jurnalkan langsung dari mutasi ini</h4>
          <div className="flex flex-wrap gap-2">
            {(line.credit ? [['gateway_settlement', 'Settlement payment gateway'], ['other_income', 'Bagi hasil / pendapatan lain']] : [['bank_fee', 'Biaya administrasi bank']]).map(([k, v]) => <Chip key={k} on={post === k} onClick={() => setPost(k as typeof post)}>{v}</Chip>)}
          </div>
          {post === 'gateway_settlement' && <div className="max-w-xs"><label className={labelCls}>Nilai bruto transaksi (sebelum potongan MDR)</label><input type="number" className={inputCls} value={gross} onChange={(e) => setGross(e.target.value)} placeholder={String(amount)} />
            {Number(gross) > amount && <p className="text-xs text-slate-500 mt-1">Potongan gateway {money(Number(gross) - amount, acc.countryCode)} dicatat sebagai Beban Administrasi Bank & Gateway.</p>}</div>}
          <div className="flex justify-end"><button className={btnSecondary} disabled={!post} onClick={doPost}>Buat jurnal</button></div>
        </Card>
      </div>
    </Modal>
  );
};
