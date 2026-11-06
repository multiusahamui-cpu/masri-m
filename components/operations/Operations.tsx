import React, { useState } from 'react';
import { ShieldAlert, Plus, RotateCcw, Trash2, Truck, Banknote, Undo2, CheckCircle, XCircle, PackageCheck } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { Chip, Empty, Flash, Pill, Th, errMsg, money, tbody, thead, useLoad } from '../common/kit';

// ---------------------------------------------------------------------------
// Karantina barang rusak
// ---------------------------------------------------------------------------
interface QItem {
  id: string; qNo: string; branchId: string; branchName: string; productId: string; product: string; sku: string; qty: number; unitCost: number; value: number;
  source: string; sourceRef: string | null; conditionNote: string; status: string; supplierId: string | null; supplier: string | null; claimNo: string | null; claimAmount: number | null;
  settledAmount: number | null; settledMethod: string | null; decisionNote: string | null; createdAt: string; decidedAt: string | null;
}
const Q_STATUS: Record<string, [string, string]> = { quarantined: ['Menunggu keputusan', 'amber'], claimed: ['Diklaim ke pemasok', 'purple'], claim_settled: ['Klaim selesai', 'green'], restocked: ['Kembali ke stok', 'green'], written_off: ['Dihapusbukukan', 'slate'] };
const Q_SOURCE: Record<string, string> = { return: 'Retur nasabah', iqalah: 'Iqalah', opname: 'Opname', receipt: 'Penerimaan barang' };

export const QuarantineWorkspace: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const role = currentUser.roleCode;
  const canAdd = role === 'warehouse' || role === 'branch-admin';
  const canDecide = ['warehouse', 'branch-manager', 'biz-mgr'].includes(role);
  const canSettle = role === 'finance';
  const [status, setStatus] = useState(canSettle ? 'claimed' : 'open');
  const { data, error, setError, reload } = useLoad<{ items: QItem[] }>(`/quarantine${qs({ status: status || undefined })}`);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<QItem | null>(null);
  const [settling, setSettling] = useState<QItem | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const cc = currentUser.branch?.countryCode ?? 'ID';
  const done = (m: string) => { setAdding(false); setDeciding(null); setSettling(null); setFlash(m); reload(); };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<ShieldAlert className="w-6 h-6" />} title="Karantina Barang Rusak"
        subtitle="Barang rusak dari retur, iqalah, opname atau penerimaan dipisahkan dari stok jual. Diputuskan: perbaiki & kembali ke stok, klaim ke pemasok, atau hapus buku."
        actions={canAdd ? <button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Pindahkan ke karantina</button> : undefined} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="p-4 flex flex-wrap gap-2">
        {[['open', 'Terbuka'], ['quarantined', 'Menunggu keputusan'], ['claimed', 'Klaim berjalan'], ['claim_settled', 'Klaim selesai'], ['restocked', 'Kembali ke stok'], ['written_off', 'Dihapusbukukan'], ['', 'Semua']]
          .map(([k, v]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{v}</Chip>)}
      </Card>
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>No. / asal</Th><Th>Barang</Th><Th>Lokasi</Th><Th right>Nilai</Th><Th>Kondisi</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.items.length === 0 && <Empty cols={7}>Tidak ada barang karantina.</Empty>}
              {data.items.map((q) => (
                <tr key={q.id}>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{q.qNo}</span><span className="block text-xs text-slate-500">{Q_SOURCE[q.source] ?? q.source}{q.sourceRef && q.sourceRef !== q.qNo ? ` · ${q.sourceRef}` : ''}</span><span className="block text-xs text-slate-400">{formatDateTime(q.createdAt)}</span></td>
                  <td className="px-4 py-3">{q.product}<span className="block text-xs text-slate-500">{q.sku} · {q.qty} unit</span></td>
                  <td className="px-4 py-3">{q.branchName}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(q.value, cc)}</td>
                  <td className="px-4 py-3 text-xs max-w-xs">{q.conditionNote}{q.decisionNote && <span className="block text-slate-500">Keputusan: {q.decisionNote}</span>}
                    {q.claimNo && <span className="block text-purple-700 dark:text-purple-300">{q.claimNo} · {q.supplier} · {money(q.claimAmount, cc)}</span>}
                    {q.settledMethod && <span className="block text-green-700">Diganti {money(q.settledAmount, cc)} ({q.settledMethod === 'credit_note' ? 'nota kredit' : 'transfer'})</span>}</td>
                  <td className="px-4 py-3"><Pill map={Q_STATUS} s={q.status} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canDecide && q.status === 'quarantined' && <button className={`${btnPrimary} inline-flex`} onClick={() => setDeciding(q)}>Putuskan</button>}
                    {canSettle && q.status === 'claimed' && <button className={`${btnPrimary} inline-flex`} onClick={() => setSettling(q)}><Banknote className="w-4 h-4" />Selesaikan klaim</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding && <QuarantineAdd branchId={currentUser.branch?.id ?? ''} onClose={() => setAdding(false)} onDone={done} />}
      {deciding && <QuarantineDecide q={deciding} cc={cc} canWriteOff={role !== 'warehouse'} onClose={() => setDeciding(null)} onDone={done} />}
      {settling && <ClaimSettle q={settling} cc={cc} onClose={() => setSettling(null)} onDone={done} />}
    </div>
  );
};

const QuarantineAdd: React.FC<{ branchId: string; onClose: () => void; onDone: (m: string) => void }> = ({ branchId, onClose, onDone }) => {
  const [search, setSearch] = useState('');
  const { data } = useLoad<{ stock: { productId: string; name: string; sku: string; onHand: number; reserved: number }[] }>(`/inventory/stock${qs({ branchId, search: search.length >= 2 ? search : undefined, pageSize: 50 })}`);
  const [f, setF] = useState({ productId: '', qty: 1, note: '', source: 'opname' });
  const [err, setErr] = useState<string | null>(null);
  const items = data?.stock ?? [];
  const sel = items.find((s) => s.productId === f.productId);
  const save = async () => {
    try { const r = await api.post<{ item: { qNo: string } }>('/quarantine', f); onDone(`${r.item.qNo}: barang dipindahkan ke karantina (keluar dari stok jual).`); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title="Pindahkan stok rusak ke karantina" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox message={err} />
        <div><label className={labelCls}>Cari barang</label><input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nama / SKU" /></div>
        <div><label className={labelCls}>Barang</label><select className={inputCls} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
          <option value="">— pilih —</option>{items.filter((s) => s.onHand - s.reserved > 0).map((s) => <option key={s.productId} value={s.productId}>{s.sku} · {s.name} (tersedia {s.onHand - s.reserved})</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Jumlah</label><input type="number" min={1} max={sel ? sel.onHand - sel.reserved : undefined} className={inputCls} value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></div>
          <div><label className={labelCls}>Ditemukan saat</label><select className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="opname">Opname / pemeriksaan</option><option value="receipt">Penerimaan barang</option></select></div>
        </div>
        <div><label className={labelCls}>Kondisi kerusakan</label><textarea className={inputCls} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="mis. layar retak, dus penyok, mati total" /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={!f.productId || f.qty < 1 || f.note.trim().length < 5} onClick={save}>Pindahkan</button></div>
      </div>
    </Modal>
  );
};

const QuarantineDecide: React.FC<{ q: QItem; cc: string; canWriteOff: boolean; onClose: () => void; onDone: (m: string) => void }> = ({ q, cc, canWriteOff, onClose, onDone }) => {
  const [action, setAction] = useState<'restock' | 'write_off' | 'claim'>('claim');
  const { data: sup } = useLoad<{ suppliers: { id: string; code: string; name: string }[] }>(action === 'claim' ? '/suppliers' : null);
  const [f, setF] = useState({ note: '', supplierId: q.supplierId ?? '', claimAmount: String(cc === 'ID' ? Math.round(q.value) : q.value) });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.post(`/quarantine/${q.id}/decide`, { action, note: f.note, supplierId: action === 'claim' ? f.supplierId : null, claimAmount: action === 'claim' ? Number(f.claimAmount) : null });
      onDone(`${q.qNo}: ${action === 'restock' ? 'barang kembali ke stok jual' : action === 'write_off' ? 'dihapusbukukan (beban kerugian persediaan)' : 'klaim pemasok dibuat — Bookkeeping menyelesaikan penggantiannya'}.`);
    } catch (e) { setErr(errMsg(e)); }
  };
  const OPT: [typeof action, string, string, React.ReactNode][] = [
    ['claim', 'Klaim ke pemasok', 'Barang cacat produksi / rusak sejak diterima. Nilai dicatat sebagai piutang klaim pemasok.', <Truck key="t" className="w-4 h-4" />],
    ['restock', 'Perbaiki & kembalikan ke stok', 'Barang sudah diperbaiki / layak jual kembali.', <RotateCcw key="r" className="w-4 h-4" />],
    ['write_off', 'Hapus buku', 'Tidak dapat diperbaiki atau diklaim. Nilai dibebankan sebagai kerugian persediaan.', <Trash2 key="w" className="w-4 h-4" />],
  ];
  return (
    <Modal title={`Keputusan ${q.qNo} — ${q.product}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{q.qty} unit · nilai pokok {money(q.value, cc)} · {q.conditionNote}</p>
        <ErrorBox message={err} />
        <div className="grid md:grid-cols-3 gap-2">
          {OPT.filter(([k]) => canWriteOff || k !== 'write_off').map(([k, t, d, ic]) => (
            <button key={k} onClick={() => setAction(k)} className={`text-left rounded-lg border p-3 ${action === k ? 'border-masri-primary bg-masri-primary/5' : 'border-slate-200 dark:border-slate-700'}`}>
              <p className="font-semibold text-sm flex items-center gap-2">{ic}{t}</p><p className="text-xs text-slate-500 mt-1">{d}</p>
            </button>
          ))}
        </div>
        {action === 'claim' && (
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className={labelCls}>Pemasok</label><select className={inputCls} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">— pilih —</option>{sup?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
            <div><label className={labelCls}>Nilai klaim</label><input type="number" className={inputCls} value={f.claimAmount} onChange={(e) => setF({ ...f, claimAmount: e.target.value })} /></div>
          </div>
        )}
        <div><label className={labelCls}>Catatan keputusan</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={f.note.trim().length < 3 || (action === 'claim' && !f.supplierId)} onClick={save}>Simpan keputusan</button></div>
      </div>
    </Modal>
  );
};

const ClaimSettle: React.FC<{ q: QItem; cc: string; onClose: () => void; onDone: (m: string) => void }> = ({ q, cc, onClose, onDone }) => {
  const [f, setF] = useState({ method: 'transfer', amount: String(cc === 'ID' ? Math.round(q.claimAmount ?? 0) : q.claimAmount ?? 0), invoiceId: '', ref: '', note: '' });
  const { data: inv } = useLoad<{ invoices: { id: string; invoiceNo: string; supplierInvoiceNo: string; remaining: number }[] }>(f.method === 'credit_note' && q.supplierId ? `/payables/invoices?status=unpaid&supplierId=${q.supplierId}&country=${cc}` : null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.post(`/quarantine/${q.id}/settle`, { method: f.method, amount: Number(f.amount), invoiceId: f.invoiceId || null, ref: f.ref || null, note: f.note || null }); onDone(`Klaim ${q.claimNo} diselesaikan.`); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={`Penyelesaian klaim ${q.claimNo}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">{q.supplier} · {q.product} ({q.qty} unit) · klaim {money(q.claimAmount, cc)}</p>
        <ErrorBox message={err} />
        <div className="flex gap-2"><Chip on={f.method === 'transfer'} onClick={() => setF({ ...f, method: 'transfer' })}>Pemasok transfer</Chip><Chip on={f.method === 'credit_note'} onClick={() => setF({ ...f, method: 'credit_note' })}>Nota kredit (potong faktur)</Chip></div>
        <div><label className={labelCls}>Nominal yang diganti pemasok</label><input type="number" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          {Number(f.amount) < (q.claimAmount ?? 0) && <p className="text-xs text-amber-600 mt-1">Kekurangan {money((q.claimAmount ?? 0) - Number(f.amount), cc)} dibebankan sebagai kerugian persediaan.</p>}</div>
        {f.method === 'credit_note' && <div><label className={labelCls}>Faktur pemasok yang dipotong</label><select className={inputCls} value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })}><option value="">— pilih —</option>{inv?.invoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} · {i.supplierInvoiceNo} (sisa {money(i.remaining, cc)})</option>)}</select></div>}
        <div><label className={labelCls}>{f.method === 'transfer' ? 'No. referensi transfer' : 'No. nota kredit pemasok'}</label><input className={inputCls} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
        <div><label className={labelCls}>Catatan</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={f.method === 'credit_note' && Number(f.amount) > 0 && !f.invoiceId} onClick={save}>Simpan</button></div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Iqalah — pembatalan akad atas kesepakatan setelah barang diterima
// ---------------------------------------------------------------------------
interface IqRow {
  id: string; iqalahNo: string; applicationId: string; contractNo: string | null; appNo: string; currency: string; customerName: string; phone: string; product: string; branchName: string;
  reason: string; status: string; depreciation: number; paidByCustomer: number; refundAmount: number; goodsCondition: string | null; decisionNote: string | null; createdAt: string; approvedAt: string | null; receivedAt: string | null;
}
const IQ_STATUS: Record<string, [string, string]> = { requested: ['Menunggu Business Manager', 'amber'], approved: ['Disetujui — tunggu barang kembali', 'blue'], completed: ['Selesai', 'green'], rejected: ['Ditolak', 'red'] };
const cur = (currency: string) => (currency === 'MYR' ? 'MY' : currency === 'BND' ? 'BN' : 'ID');

export const IqalahWorkspace: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const role = currentUser.roleCode;
  const [status, setStatus] = useState('open');
  const { data, error, setError, reload } = useLoad<{ requests: IqRow[] }>(`/iqalah${qs({ status: status || undefined })}`);
  const [deciding, setDeciding] = useState<IqRow | null>(null);
  const [receiving, setReceiving] = useState<IqRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const done = (m: string) => { setDeciding(null); setReceiving(null); setFlash(m); reload(); };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Undo2 className="w-6 h-6" />} title="Iqalah (Pembatalan Akad)"
        subtitle="Pembatalan murabahah atas kesepakatan setelah barang diterima. Cabang mengajukan dari detail pembiayaan aktif → Business Manager menetapkan potongan nilai barang → Admin Cabang menerima barang & dana nasabah dikembalikan."
      />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="p-4 flex flex-wrap gap-2">
        {[['open', 'Berjalan'], ['requested', 'Menunggu keputusan'], ['approved', 'Disetujui'], ['completed', 'Selesai'], ['rejected', 'Ditolak'], ['', 'Semua']].map(([k, v]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{v}</Chip>)}
      </Card>
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>No. / akad</Th><Th>Nasabah & barang</Th><Th>Alasan</Th><Th right>Dibayar nasabah</Th><Th right>Potongan nilai</Th><Th right>Dikembalikan</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.requests.length === 0 && <Empty cols={8}>Tidak ada pengajuan iqalah.</Empty>}
              {data.requests.map((r) => {
                const c = cur(r.currency);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3"><span className="font-mono text-xs">{r.iqalahNo}</span><span className="block text-xs text-slate-500">{r.contractNo ?? r.appNo}</span><span className="block text-xs text-slate-400">{formatDateTime(r.createdAt)}</span></td>
                    <td className="px-4 py-3">{r.customerName}<span className="block text-xs text-slate-500">{r.product} · {r.branchName}</span></td>
                    <td className="px-4 py-3 text-xs max-w-xs">{r.reason}{r.decisionNote && <span className="block text-slate-500">BM: {r.decisionNote}</span>}{r.goodsCondition && <span className="block">Barang kembali: {r.goodsCondition === 'good' ? 'baik' : 'rusak (karantina)'}</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(r.paidByCustomer, c)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(r.depreciation, c)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{money(r.refundAmount, c)}</td>
                    <td className="px-4 py-3"><Pill map={IQ_STATUS} s={r.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {role === 'biz-mgr' && r.status === 'requested' && <button className={`${btnPrimary} inline-flex`} onClick={() => setDeciding(r)}>Putuskan</button>}
                      {role === 'branch-admin' && r.status === 'approved' && <button className={`${btnPrimary} inline-flex`} onClick={() => setReceiving(r)}><PackageCheck className="w-4 h-4" />Terima barang</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {deciding && <IqalahDecide r={deciding} onClose={() => setDeciding(null)} onDone={done} />}
      {receiving && <IqalahReceive r={receiving} onClose={() => setReceiving(null)} onDone={done} />}
    </div>
  );
};

const IqalahDecide: React.FC<{ r: IqRow; onClose: () => void; onDone: (m: string) => void }> = ({ r, onClose, onDone }) => {
  const c = cur(r.currency);
  const [dep, setDep] = useState(String(r.depreciation));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const d = Math.min(Math.max(Number(dep) || 0, 0), r.paidByCustomer);
  const go = async (decision: 'approve' | 'reject') => {
    try { await api.post(`/iqalah/${r.id}/decide`, { decision, depreciation: decision === 'approve' ? d : null, note }); onDone(`${r.iqalahNo} ${decision === 'approve' ? 'disetujui — cabang menunggu barang dikembalikan nasabah' : 'ditolak'}.`); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={`Keputusan iqalah ${r.iqalahNo}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3"><p><b>{r.customerName}</b> · {r.product} · {r.contractNo}</p><p className="text-slate-500">{r.reason}</p></div>
        <ErrorBox message={err} />
        <div><label className={labelCls}>Potongan nilai barang (penyusutan / kerusakan)</label><input type="number" min={0} max={r.paidByCustomer} className={inputCls} value={dep} onChange={(e) => setDep(e.target.value)} />
          <p className="text-xs text-slate-500 mt-1">Maksimal sebesar dana yang sudah dibayar nasabah ({money(r.paidByCustomer, c)}). Ditetapkan atas kesepakatan dengan nasabah.</p></div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2"><p className="text-xs text-slate-500">Dibayar nasabah</p><p className="font-semibold">{money(r.paidByCustomer, c)}</p></div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2"><p className="text-xs text-slate-500">Potongan</p><p className="font-semibold">{money(d, c)}</p></div>
          <div className="rounded-lg border border-masri-primary p-2"><p className="text-xs text-slate-500">Dikembalikan</p><p className="font-bold text-masri-primary">{money(r.paidByCustomer - d, c)}</p></div>
        </div>
        <p className="text-xs text-slate-500">Setelah disetujui: tagihan angsuran berhenti, sisa piutang & margin yang belum diakui dibatalkan saat barang diterima kembali, ta'zir terutang dihapuskan.</p>
        <div><label className={labelCls}>Catatan keputusan</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} disabled={note.trim().length < 3} onClick={() => go('reject')}><XCircle className="w-4 h-4" />Tolak</button>
          <button className={btnPrimary} disabled={note.trim().length < 3} onClick={() => go('approve')}><CheckCircle className="w-4 h-4" />Setujui</button>
        </div>
      </div>
    </Modal>
  );
};

const IqalahReceive: React.FC<{ r: IqRow; onClose: () => void; onDone: (m: string) => void }> = ({ r, onClose, onDone }) => {
  const c = cur(r.currency);
  const [f, setF] = useState({ condition: 'good', note: '', refundMethod: 'transfer', bankName: '', accountNo: '', accountName: r.customerName });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.post(`/iqalah/${r.id}/receive`, { ...f, note: f.note || null }); onDone(`${r.iqalahNo} selesai. ${r.refundAmount > 0 ? `Pengembalian dana ${money(r.refundAmount, c)} dibuat di menu Retur & Refund.` : ''}`); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={`Terima barang iqalah ${r.iqalahNo}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">{r.customerName} · {r.product} · dikembalikan <b>{money(r.refundAmount, c)}</b></p>
        <ErrorBox message={err} />
        <div className="flex gap-2"><Chip on={f.condition === 'good'} onClick={() => setF({ ...f, condition: 'good' })}>Baik — kembali ke stok</Chip><Chip on={f.condition === 'damaged'} onClick={() => setF({ ...f, condition: 'damaged' })}>Rusak — ke karantina</Chip></div>
        <div><label className={labelCls}>Catatan kondisi</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        {r.refundAmount > 0 && <>
          <div className="flex gap-2"><Chip on={f.refundMethod === 'transfer'} onClick={() => setF({ ...f, refundMethod: 'transfer' })}>Transfer ke nasabah</Chip><Chip on={f.refundMethod === 'cash'} onClick={() => setF({ ...f, refundMethod: 'cash' })}>Tunai di kasir</Chip></div>
          {f.refundMethod === 'transfer' && <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Bank</label><input className={inputCls} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></div>
            <div><label className={labelCls}>No. rekening</label><input className={inputCls} value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></div>
            <div className="col-span-2"><label className={labelCls}>Atas nama</label><input className={inputCls} value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></div>
          </div>}
        </>}
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={r.refundAmount > 0 && f.refundMethod === 'transfer' && !(f.bankName && f.accountNo && f.accountName)} onClick={save}>Barang diterima</button></div>
      </div>
    </Modal>
  );
};

/** Tombol & form pengajuan iqalah di detail pembiayaan aktif (Manager / Admin Cabang). */
export const IqalahRequestBox: React.FC<{ applicationId: string; onDone: () => void }> = ({ applicationId, onDone }) => {
  const [open, setOpen] = useState(false);
  const { data } = useLoad<{ paidByCustomer: number; currency: string }>(open ? `/credit/applications/${applicationId}/iqalah-preview` : null);
  const [reason, setReason] = useState('');
  const [dep, setDep] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.post(`/credit/applications/${applicationId}/iqalah`, { reason, proposedDepreciation: dep ? Number(dep) : null }); setOpen(false); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <>
      <button className={btnSecondary} onClick={() => setOpen(true)}><Undo2 className="w-4 h-4" />Ajukan iqalah (pembatalan akad)</button>
      {open && (
        <Modal title="Ajukan iqalah" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Iqalah = pembatalan akad murabahah atas kesepakatan kedua pihak. Barang dikembalikan ke Masri-M, dana nasabah dikembalikan setelah dipotong penurunan nilai barang yang disepakati. Diputuskan Business Manager.</p>
            {!data ? <Spinner /> : <p className="text-sm">Dana yang sudah dibayar nasabah atas harga barang: <b>{money(data.paidByCustomer, cur(data.currency))}</b></p>}
            <ErrorBox message={err} />
            <div><label className={labelCls}>Alasan</label><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. nasabah pindah ke luar kota dan tidak sanggup melanjutkan, barang masih baik" /></div>
            <div><label className={labelCls}>Usulan potongan nilai barang</label><input type="number" min={0} className={inputCls} value={dep} onChange={(e) => setDep(e.target.value)} placeholder="0" /></div>
            <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={() => setOpen(false)}>Batal</button><button className={btnPrimary} disabled={reason.trim().length < 10} onClick={save}>Ajukan ke Business Manager</button></div>
          </div>
        </Modal>
      )}
    </>
  );
};
