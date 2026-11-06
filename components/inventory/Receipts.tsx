import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Card, ErrorBox, Spinner, Modal, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { LinesEditor, Line } from './LinesEditor';

interface ReceiptRow { id: string; grNo: string; supplierName: string; supplierRef: string | null; note: string | null; createdAt: string; createdByName: string; itemCount: number; units: number }

/** Penerimaan barang dari supplier ke Gudang Pusat. */
export const ReceiptsPanel: React.FC<{ canCreate: boolean; onChanged?: () => void }> = ({ canCreate, onChanged }) => {
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ receipts: ReceiptRow[] }>('/inventory/receipts').then((r) => setRows(r.receipts)).catch((e) => setError((e as ApiError).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {canCreate && <div className="flex justify-end"><button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Catat Penerimaan Barang</button></div>}
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
              <tr><th className="text-left px-4 py-3">No. GR</th><th className="text-left px-4 py-3">Supplier</th><th className="text-right px-4 py-3">Item / Unit</th><th className="text-left px-4 py-3">Dicatat</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{r.grNo}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{r.supplierName}{r.supplierRef && <span className="block text-xs text-slate-500">Ref: {r.supplierRef}</span>}</td>
                  <td className="px-4 py-3 text-right">{r.itemCount} / {r.units}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{r.createdByName}<span className="block">{formatDateTime(r.createdAt)}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-500">Belum ada penerimaan barang.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <ReceiptCreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); onChanged?.(); }} />}
    </div>
  );
};

const ReceiptCreateModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [suppliers, setSuppliers] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [supplierRef, setRef] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ suppliers: { id: string; code: string; name: string }[] }>('/suppliers').then((r) => setSuppliers(r.suppliers)).catch((e) => setError((e as ApiError).message)); }, []);
  const total = lines.reduce((t, l) => t + l.qty * (Number(costs[l.productId]) || 0), 0);
  const missing = lines.some((l) => !(Number(costs[l.productId]) > 0));
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await api.post('/inventory/receipts', { supplierId, supplierRef: supplierRef || null, note: note || null,
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: Number(costs[l.productId]) > 0 ? Number(costs[l.productId]) : null })) });
      onSaved();
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  };
  return (
    <Modal title="Penerimaan Barang dari Pemasok" onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Pemasok</label>
            <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{suppliers ? '— pilih pemasok —' : 'Memuat...'}</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
            {suppliers && suppliers.length === 0 && <p className="text-xs text-amber-600 mt-1">Belum ada pemasok — Gudang Pusat / Bookkeeping menambahkannya di menu Pemasok.</p>}</div>
          <div><label className={labelCls}>No. surat jalan / faktur</label><input className={inputCls} value={supplierRef} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <LinesEditor lines={lines} onChange={setLines} qtyLabel="Jumlah diterima" />
        {lines.length > 0 && (
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold">Harga pokok per unit (sesuai faktur / PO pemasok)</p>
            {lines.map((l) => (
              <div key={l.productId} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{l.sku} · {l.name} <span className="text-slate-500">× {l.qty}</span></span>
                <input type="number" min={0} className={`${inputCls.replace('w-full', '')} w-40`} value={costs[l.productId] ?? ''} onChange={(e) => setCosts({ ...costs, [l.productId]: e.target.value })} placeholder="harga / unit" />
              </div>
            ))}
            <p className="text-xs text-slate-500">Nilai penerimaan: <b>{new Intl.NumberFormat('id-ID').format(total)}</b>{missing && <span className="text-amber-600"> — isi harga pokok semua barang (dasar nilai persediaan & hutang pemasok).</span>}</p>
          </div>
        )}
        <div><label className={labelCls}>Catatan</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>Batal</button>
          <button className={btnPrimary} disabled={saving || !supplierId || lines.length === 0 || missing} onClick={submit}>{saving ? 'Menyimpan...' : 'Simpan & Tambah Stok'}</button>
        </div>
      </div>
    </Modal>
  );
};
