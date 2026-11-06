import React, { useEffect, useState } from 'react';
import { Truck, Plus, FileText, Banknote, Pencil, Ban, Clock } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { Chip, CountrySelect, Empty, Flash, Pill, Stat, Th, errMsg, money, tbody, thead, today, useLoad } from '../common/kit';

interface Supplier {
  id: string; code: string; name: string; countryCode: string; taxId: string | null; phone: string | null; email: string | null; address: string;
  bankName: string | null; accountNo: string | null; accountName: string | null; paymentTermsDays: number; isActive: boolean; outstanding: number; uninvoiced: number;
}
interface Invoice {
  id: string; invoiceNo: string; supplierId: string; supplier: string; supplierCode: string; supplierInvoiceNo: string; branchName: string; grNo: string | null;
  invoiceDate: string; dueDate: string; currency: string; receiptValue: number | null; subtotal: number; tax: number; total: number; paidAmount: number; remaining: number;
  status: string; note: string | null; bank: { bankName: string | null; accountNo: string | null; accountName: string | null };
}
interface Uninvoiced { id: string; grNo: string; supplierId: string | null; supplierName: string | null; supplierRef: string | null; createdAt: string; branchName: string; value: number | null; missingCost: boolean }
interface Aging {
  asOf: string; currency: string; total: Record<string, number>;
  suppliers: { supplierId: string; supplier: string; code: string; invoices: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90: number; total: number }[];
  dueSoon: { id: string; invoiceNo: string; supplier: string; supplierInvoiceNo: string; dueDate: string; remaining: number }[];
}

const INV_STATUS: Record<string, [string, string]> = { open: ['Belum dibayar', 'amber'], partial: ['Dibayar sebagian', 'blue'], paid: ['Lunas', 'green'], cancelled: ['Dibatalkan', 'slate'] };
let apCountry = 'ID';

/** Hutang Pemasok (Bookkeeping): faktur atas penerimaan barang, pembayaran, umur hutang, master pemasok. */
export const PayablesModule: React.FC<{ readOnly?: boolean }> = ({ readOnly }) => {
  const [tab, setTab] = useState<'invoices' | 'uninvoiced' | 'aging' | 'suppliers'>('invoices');
  const [country, setCountry] = useState(apCountry);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Truck className="w-6 h-6" />} title="Hutang Pemasok"
        subtitle="Penerimaan barang (GR) → faktur pemasok (dicocokkan dengan nilai GR) → pembayaran. Jurnal Persediaan/Hutang Dagang dibuat otomatis."
        actions={<CountrySelect value={country} onChange={(v) => { apCountry = v; setCountry(v); }} />} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <Card className="p-4 flex flex-wrap gap-2">
        <Chip on={tab === 'invoices'} onClick={() => setTab('invoices')}>Faktur</Chip>
        {!readOnly && <Chip on={tab === 'uninvoiced'} onClick={() => setTab('uninvoiced')}>GR belum difakturkan</Chip>}
        <Chip on={tab === 'aging'} onClick={() => setTab('aging')}>Umur hutang</Chip>
        <Chip on={tab === 'suppliers'} onClick={() => setTab('suppliers')}>Pemasok</Chip>
      </Card>
      {tab === 'invoices' && <Invoices country={country} readOnly={readOnly} onFlash={setFlash} />}
      {tab === 'uninvoiced' && <UninvoicedList country={country} onFlash={(m) => { setFlash(m); setTab('invoices'); }} />}
      {tab === 'aging' && <AgingView country={country} />}
      {tab === 'suppliers' && <Suppliers country={country} readOnly={readOnly} />}
    </div>
  );
};

const Invoices: React.FC<{ country: string; readOnly?: boolean; onFlash: (m: string) => void }> = ({ country, readOnly, onFlash }) => {
  const [status, setStatus] = useState('unpaid');
  const [search, setSearch] = useState('');
  const { data, error, setError, reload } = useLoad<{ invoices: Invoice[] }>(`/payables/invoices${qs({ country, status, search: search.length >= 2 ? search : undefined })}`);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const cancel = async (i: Invoice) => {
    const reason = window.prompt(`Alasan membatalkan ${i.invoiceNo}?`); if (!reason) return;
    try { await api.post(`/payables/invoices/${i.id}/cancel`, { reason }); onFlash(`${i.invoiceNo} dibatalkan.`); reload(); } catch (e) { setError(errMsg(e)); }
  };
  return (
    <>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        {[['unpaid', 'Belum lunas'], ['paid', 'Lunas'], ['cancelled', 'Dibatalkan'], ['', 'Semua']].map(([k, v]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{v}</Chip>)}
        <input className={`${inputCls} max-w-[260px] ml-auto`} placeholder="Cari no. faktur / pemasok" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>No. / faktur pemasok</Th><Th>Pemasok</Th><Th>Jatuh tempo</Th><Th right>Total</Th><Th right>Sisa</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.invoices.length === 0 && <Empty cols={7}>Tidak ada faktur.</Empty>}
              {data.invoices.map((i) => {
                const overdue = ['open', 'partial'].includes(i.status) && i.dueDate < today();
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-3"><button className="font-mono text-xs text-masri-primary hover:underline" onClick={() => setDetail(i)}>{i.invoiceNo}</button><span className="block text-xs text-slate-500">{i.supplierInvoiceNo} · {i.grNo ?? '—'}</span></td>
                    <td className="px-4 py-3">{i.supplier}<span className="block text-xs text-slate-500">{i.branchName}</span></td>
                    <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : ''}`}>{i.dueDate}{overdue && <span className="block text-xs">lewat jatuh tempo</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(i.total, country)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{money(i.remaining, country)}</td>
                    <td className="px-4 py-3"><Pill map={INV_STATUS} s={i.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {!readOnly && ['open', 'partial'].includes(i.status) && <button className={`${btnPrimary} inline-flex`} onClick={() => setPaying(i)}><Banknote className="w-4 h-4" />Bayar</button>}
                      {!readOnly && i.status === 'open' && i.paidAmount === 0 && <button className="ml-2 text-xs text-red-600 hover:underline inline-flex items-center gap-1" onClick={() => cancel(i)}><Ban className="w-3 h-3" />Batal</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {paying && <PayModal inv={paying} country={country} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); onFlash(m); reload(); }} />}
      {detail && <InvoiceDetail inv={detail} country={country} onClose={() => setDetail(null)} />}
    </>
  );
};

const PayModal: React.FC<{ inv: Invoice; country: string; onClose: () => void; onDone: (m: string) => void }> = ({ inv, country, onClose, onDone }) => {
  const [f, setF] = useState({ amount: String(inv.remaining), method: 'transfer', bankRef: '', paidAt: today(), note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ payment: { paymentNo: string } }>(`/payables/invoices/${inv.id}/pay`, { amount: Number(f.amount), method: f.method, bankRef: f.bankRef || null, paidAt: f.paidAt, note: f.note || null });
      onDone(`Pembayaran ${r.payment.paymentNo} untuk ${inv.invoiceNo} dicatat.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Bayar ${inv.invoiceNo}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
          <p><b>{inv.supplier}</b> · faktur {inv.supplierInvoiceNo}</p>
          <p className="text-slate-500">Sisa hutang {money(inv.remaining, country)}</p>
          {inv.bank.accountNo ? <p className="text-slate-500">Rek. tujuan: {inv.bank.bankName} {inv.bank.accountNo} a.n. {inv.bank.accountName}</p> : <p className="text-amber-600">Rekening pemasok belum diisi di master pemasok.</p>}
        </div>
        <ErrorBox message={err} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Nominal</label><input type="number" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><label className={labelCls}>Metode</label><select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="transfer">Transfer bank</option><option value="cash">Tunai (kas Pusat)</option></select></div>
          <div><label className={labelCls}>Tanggal bayar</label><input type="date" className={inputCls} value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></div>
          <div><label className={labelCls}>No. referensi bank</label><input className={inputCls} value={f.bankRef} onChange={(e) => setF({ ...f, bankRef: e.target.value })} /></div>
        </div>
        <div><label className={labelCls}>Catatan</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={busy || !(Number(f.amount) > 0)} onClick={submit}>Simpan pembayaran</button></div>
      </div>
    </Modal>
  );
};

const InvoiceDetail: React.FC<{ inv: Invoice; country: string; onClose: () => void }> = ({ inv, country, onClose }) => {
  const { data } = useLoad<{ payments: { id: string; paymentNo: string; amount: number; method: string; bankRef: string | null; paidAt: string; paidByName: string; note: string | null }[] }>(`/payables/invoices/${inv.id}`);
  const M: Record<string, string> = { transfer: 'Transfer', cash: 'Tunai', claim_offset: 'Nota kredit (klaim)' };
  return (
    <Modal title={`${inv.invoiceNo} — ${inv.supplier}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
        <Stat label="Nilai GR" value={money(inv.receiptValue, country)} hint={inv.grNo ?? ''} />
        <Stat label="DPP" value={money(inv.subtotal, country)} />
        <Stat label="Pajak" value={money(inv.tax, country)} />
        <Stat label="Total" value={money(inv.total, country)} hint={`Jatuh tempo ${inv.dueDate}`} />
      </div>
      {inv.note && <p className="text-sm text-slate-500 mb-3">{inv.note}</p>}
      <h4 className="font-semibold text-sm mb-2">Riwayat pembayaran</h4>
      {!data ? <Spinner /> : data.payments.length === 0 ? <p className="text-sm text-slate-500">Belum ada pembayaran.</p> : (
        <table className="w-full text-sm"><thead className={thead}><tr><Th>No.</Th><Th>Tanggal</Th><Th>Metode</Th><Th right>Nominal</Th><Th>Oleh</Th></tr></thead>
          <tbody className={tbody}>{data.payments.map((p) => <tr key={p.id}><td className="px-4 py-2 font-mono text-xs">{p.paymentNo}</td><td className="px-4 py-2">{String(p.paidAt).slice(0, 10)}</td><td className="px-4 py-2">{M[p.method] ?? p.method}{p.bankRef && <span className="block text-xs text-slate-500">{p.bankRef}</span>}</td><td className="px-4 py-2 text-right">{money(p.amount, country)}</td><td className="px-4 py-2">{p.paidByName}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
};

const UninvoicedList: React.FC<{ country: string; onFlash: (m: string) => void }> = ({ country, onFlash }) => {
  const { data, error, setError } = useLoad<{ receipts: Uninvoiced[] }>(`/payables/uninvoiced?country=${country}`);
  const [pick, setPick] = useState<Uninvoiced | null>(null);
  return (
    <>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>No. GR</Th><Th>Pemasok</Th><Th>Lokasi</Th><Th right>Nilai GR</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.receipts.length === 0 && <Empty cols={5}>Semua penerimaan barang sudah difakturkan.</Empty>}
              {data.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{r.grNo}</span><span className="block text-xs text-slate-500">{formatDateTime(r.createdAt)}</span></td>
                  <td className="px-4 py-3">{r.supplierName ?? '—'}{!r.supplierId && <span className="block text-xs text-amber-600">belum ditautkan ke master pemasok</span>}{r.supplierRef && <span className="block text-xs text-slate-500">Surat jalan {r.supplierRef}</span>}</td>
                  <td className="px-4 py-3">{r.branchName}</td>
                  <td className="px-4 py-3 text-right">{r.missingCost ? <span className="text-amber-600 text-xs">harga pokok belum lengkap</span> : money(r.value, country)}</td>
                  <td className="px-4 py-3 text-right"><button className={`${btnPrimary} inline-flex`} onClick={() => setPick(r)}><FileText className="w-4 h-4" />Catat faktur</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {pick && <InvoiceForm gr={pick} country={country} onClose={() => setPick(null)} onDone={(m) => { setPick(null); onFlash(m); }} />}
    </>
  );
};

const InvoiceForm: React.FC<{ gr: Uninvoiced; country: string; onClose: () => void; onDone: (m: string) => void }> = ({ gr, country, onClose, onDone }) => {
  const { data: sup } = useLoad<{ suppliers: Supplier[] }>(`/suppliers?country=${country}`);
  const [f, setF] = useState({ supplierId: gr.supplierId ?? '', supplierInvoiceNo: '', invoiceDate: today(), dueDate: '', subtotal: gr.value ? String(gr.value) : '', tax: '0', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = sup?.suppliers.find((x) => x.id === f.supplierId);
  useEffect(() => {
    if (s && !f.dueDate) setF((p) => ({ ...p, dueDate: new Date(Date.parse(p.invoiceDate) + s.paymentTermsDays * 86400_000).toISOString().slice(0, 10) }));
  }, [s, f.dueDate]);
  const sub = Number(f.subtotal) || 0, tax = Number(f.tax) || 0;
  const diff = gr.value ? (sub - gr.value) / gr.value : 0;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ invoice: { invoiceNo: string } }>('/payables/invoices', { supplierId: f.supplierId, receiptId: gr.id, supplierInvoiceNo: f.supplierInvoiceNo, invoiceDate: f.invoiceDate, dueDate: f.dueDate || null, subtotal: sub || null, tax, note: f.note || null });
      onDone(`Faktur ${r.invoice.invoiceNo} dicatat untuk ${gr.grNo}.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Catat faktur pemasok — ${gr.grNo}`} onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox message={err} />
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className={labelCls}>Pemasok</label>
            <select className={inputCls} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value, dueDate: '' })}>
              <option value="">— pilih —</option>{sup?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} (tempo {x.paymentTermsDays} hari)</option>)}
            </select></div>
          <div><label className={labelCls}>No. faktur pemasok</label><input className={inputCls} value={f.supplierInvoiceNo} onChange={(e) => setF({ ...f, supplierInvoiceNo: e.target.value })} /></div>
          <div><label className={labelCls}>Tanggal faktur</label><input type="date" className={inputCls} value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value, dueDate: '' })} /></div>
          <div><label className={labelCls}>DPP / nilai barang</label><input type="number" className={inputCls} value={f.subtotal} onChange={(e) => setF({ ...f, subtotal: e.target.value })} />
            {gr.value != null && Math.abs(diff) > 0.005 && <p className={`text-xs mt-1 ${Math.abs(diff) > 0.2 ? 'text-red-600' : 'text-amber-600'}`}>Selisih {(diff * 100).toFixed(1)}% dari nilai GR {money(gr.value, country)}{Math.abs(diff) > 0.2 ? ' — melebihi batas 20%, periksa kembali' : ''}</p>}</div>
          <div><label className={labelCls}>PPN / SST masukan</label><input type="number" className={inputCls} value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></div>
          <div><label className={labelCls}>Jatuh tempo</label><input type="date" className={inputCls} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>
          <div><label className={labelCls}>Total faktur</label><p className="py-2 font-bold">{money(sub + tax, country)}</p></div>
        </div>
        <div><label className={labelCls}>Catatan</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={busy || !f.supplierId || f.supplierInvoiceNo.length < 2} onClick={submit}>Simpan faktur</button></div>
      </div>
    </Modal>
  );
};

const AgingView: React.FC<{ country: string }> = ({ country }) => {
  const { data, error } = useLoad<Aging>(`/payables/aging?country=${country}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;
  const B: [string, string][] = [['current', 'Belum jatuh tempo'], ['d1_30', '1–30 hari'], ['d31_60', '31–60 hari'], ['d61_90', '61–90 hari'], ['d90', '> 90 hari']];
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {B.map(([k, v]) => <Stat key={k} label={v} value={money(data.total[k], country)} tone={k === 'd90' && data.total[k] > 0 ? 'red' : k !== 'current' && data.total[k] > 0 ? 'amber' : undefined} />)}
        <Stat label="Total hutang" value={money(data.total.total, country)} />
      </div>
      {data.dueSoon.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" />Jatuh tempo ≤ 7 hari / sudah lewat</h3>
          <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-700">
            {data.dueSoon.map((d) => <li key={d.id} className="py-1.5 flex justify-between gap-3"><span><span className="font-mono text-xs">{d.invoiceNo}</span> · {d.supplier} <span className="text-slate-500">({d.supplierInvoiceNo})</span></span><span className={d.dueDate < data.asOf ? 'text-red-600' : ''}>{d.dueDate} · {money(d.remaining, country)}</span></li>)}
          </ul>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={thead}><tr><Th>Pemasok</Th><Th right>Faktur</Th>{B.map(([k, v]) => <Th key={k} right>{v}</Th>)}<Th right>Total</Th></tr></thead>
          <tbody className={tbody}>
            {data.suppliers.length === 0 && <Empty cols={8}>Tidak ada hutang pemasok terbuka.</Empty>}
            {data.suppliers.map((s) => <tr key={s.supplierId}><td className="px-4 py-3">{s.supplier}<span className="block text-xs text-slate-500">{s.code}</span></td><td className="px-4 py-3 text-right">{s.invoices}</td>
              {B.map(([k]) => <td key={k} className={`px-4 py-3 text-right whitespace-nowrap ${k === 'd90' && s.d90 > 0 ? 'text-red-600 font-semibold' : ''}`}>{(s as unknown as Record<string, number>)[k] ? money((s as unknown as Record<string, number>)[k], country) : '—'}</td>)}
              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{money(s.total, country)}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const emptySup = (country: string) => ({ code: '', name: '', countryCode: country, taxId: '', phone: '', email: '', address: '', bankName: '', accountNo: '', accountName: '', paymentTermsDays: 30, isActive: true });

export const Suppliers: React.FC<{ country: string; readOnly?: boolean; canCreate?: boolean }> = ({ country, readOnly, canCreate }) => {
  const { data, error, setError, reload } = useLoad<{ suppliers: Supplier[] }>(`/suppliers?country=${country}&all=1`);
  const [edit, setEdit] = useState<(ReturnType<typeof emptySup> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const { id, ...b } = edit;
      const body = { ...b, taxId: b.taxId || null, phone: b.phone || null, bankName: b.bankName || null, accountNo: b.accountNo || null, accountName: b.accountName || null, paymentTermsDays: Number(b.paymentTermsDays) };
      if (id) await api.put(`/suppliers/${id}`, body); else await api.post('/suppliers', body);
      setEdit(null); reload();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const fld = (k: keyof ReturnType<typeof emptySup>, label: string, type = 'text') => (
    <div><label className={labelCls}>{label}</label><input type={type} className={inputCls} value={String(edit?.[k] ?? '')} onChange={(e) => setEdit({ ...edit!, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} /></div>
  );
  return (
    <>
      <ErrorBox message={error} onClose={() => setError(null)} />
      {(!readOnly || canCreate) && <div className="flex justify-end"><button className={btnPrimary} onClick={() => setEdit(emptySup(country))}><Plus className="w-4 h-4" />Pemasok baru</button></div>}
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>Kode</Th><Th>Nama</Th><Th>Kontak</Th><Th>Rekening</Th><Th right>Tempo</Th><Th right>Hutang terbuka</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.suppliers.length === 0 && <Empty cols={7}>Belum ada pemasok.</Empty>}
              {data.suppliers.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3">{s.name}{s.taxId && <span className="block text-xs text-slate-500">NPWP/Tax {s.taxId}</span>}{s.uninvoiced > 0 && <span className="block text-xs text-amber-600">{s.uninvoiced} GR belum difakturkan</span>}</td>
                  <td className="px-4 py-3 text-xs">{s.phone ?? '—'}<span className="block">{s.email ?? ''}</span></td>
                  <td className="px-4 py-3 text-xs">{s.accountNo ? `${s.bankName} ${s.accountNo}` : '—'}<span className="block text-slate-500">{s.accountName ?? ''}</span></td>
                  <td className="px-4 py-3 text-right">{s.paymentTermsDays} hari</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(s.outstanding, country)}</td>
                  <td className="px-4 py-3 text-right">{!readOnly && <button className="text-masri-primary" aria-label="Ubah" onClick={() => setEdit({ ...emptySup(country), ...s, taxId: s.taxId ?? '', phone: s.phone ?? '', email: s.email ?? '', bankName: s.bankName ?? '', accountNo: s.accountNo ?? '', accountName: s.accountName ?? '' })}><Pencil className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Ubah pemasok ${edit.code}` : 'Pemasok baru'} onClose={() => setEdit(null)} wide>
          <div className="grid md:grid-cols-2 gap-3">
            {fld('code', 'Kode')}{fld('name', 'Nama')}{fld('taxId', 'NPWP / Tax ID')}{fld('phone', 'Telepon')}{fld('email', 'Email', 'email')}{fld('paymentTermsDays', 'Tempo bayar (hari)', 'number')}
            <div className="md:col-span-2">{fld('address', 'Alamat')}</div>
            {readOnly ? <p className="md:col-span-2 text-xs text-slate-500">Rekening bank pemasok diisi oleh Bookkeeping (pemisahan tugas).</p> : <>{fld('bankName', 'Bank')}{fld('accountNo', 'No. rekening')}{fld('accountName', 'Atas nama')}</>}
            <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />Aktif</label>
          </div>
          <div className="flex justify-end gap-2 mt-4"><button className={btnSecondary} onClick={() => setEdit(null)}>Batal</button><button className={btnPrimary} disabled={busy} onClick={save}>Simpan</button></div>
        </Modal>
      )}
    </>
  );
};
