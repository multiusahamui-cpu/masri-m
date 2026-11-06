import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { StockLocation } from '../../types';
import { Card, ErrorBox, Spinner, Modal, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { LinesEditor, Line } from './LinesEditor';
import { ADJ_REASON } from './labels';

interface AdjRow { id: string; adjNo: string; reason: string; note: string | null; createdAt: string; createdByName: string; branchName: string; netDiff: number; itemCount: number }

/** Stock opname & penyesuaian untuk satu lokasi (Pusat oleh Warehouse, cabang oleh Admin Cabang). */
export const AdjustmentsPanel: React.FC<{ branchId: string; canCreate: boolean; onChanged?: () => void }> = ({ branchId, canCreate, onChanged }) => {
  const [rows, setRows] = useState<AdjRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ adjustments: AdjRow[] }>('/inventory/adjustments').then((r) => setRows(r.adjustments)).catch((e) => setError((e as ApiError).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      {canCreate && <div className="flex justify-end"><button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Stock Opname / Penyesuaian</button></div>}
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
              <tr><th className="text-left px-4 py-3">No.</th><th className="text-left px-4 py-3">Lokasi</th><th className="text-left px-4 py-3">Alasan</th><th className="text-right px-4 py-3">Selisih</th><th className="text-left px-4 py-3">Dicatat</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{r.adjNo}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.branchName}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{ADJ_REASON[r.reason] ?? r.reason}{r.note && <span className="block text-xs text-slate-500">{r.note}</span>}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.netDiff > 0 ? 'text-green-600' : r.netDiff < 0 ? 'text-red-600' : 'text-slate-500'}`}>{r.netDiff > 0 ? `+${r.netDiff}` : r.netDiff} <span className="text-xs font-normal text-slate-400">({r.itemCount} item)</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{r.createdByName}<span className="block">{formatDateTime(r.createdAt)}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">Belum ada penyesuaian.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <AdjustmentModal branchId={branchId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); onChanged?.(); }} />}
    </div>
  );
};

const AdjustmentModal: React.FC<{ branchId: string; onClose: () => void; onSaved: () => void }> = ({ branchId, onClose, onSaved }) => {
  const [reason, setReason] = useState('opname');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Isi kolom "Sistem" dengan stok fisik saat produk ditambahkan
  const onLines = async (next: Line[]) => {
    const added = next.find((l) => !lines.some((x) => x.productId === l.productId));
    if (added) {
      try {
        const r = await api.get<{ locations: StockLocation[] }>(`/inventory/stock/${added.productId}/locations`);
        const sys = r.locations.find((x) => x.branchId === branchId)?.onHand ?? 0;
        next = next.map((l) => (l.productId === added.productId ? { ...l, extra: sys, qty: sys } : l));
      } catch { /* abaikan */ }
    }
    setLines(next);
  };

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await api.post('/inventory/adjustments', { branchId, reason, note: note || null, items: lines.map((l) => ({ productId: l.productId, countedQty: l.qty })) });
      onSaved();
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  };
  return (
    <Modal title="Stock Opname / Penyesuaian Stok" onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Alasan</label>
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(ADJ_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className={labelCls}>Keterangan {reason !== 'opname' && '(wajib)'}</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <LinesEditor lines={lines} onChange={onLines} qtyLabel="Hasil Hitung Fisik" extraLabel="Sistem" min={0} />
        <p className="text-xs text-slate-500">Selisih antara hasil hitung dan stok sistem dicatat di kartu stok dan Audit. Stok yang sudah dipesan nasabah tidak dapat dikurangi.</p>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>Batal</button>
          <button className={btnPrimary} disabled={saving || lines.length === 0} onClick={submit}>{saving ? 'Menyimpan...' : 'Simpan Penyesuaian'}</button>
        </div>
      </div>
    </Modal>
  );
};
