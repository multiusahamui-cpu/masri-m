import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Truck, CheckCircle2, XCircle, PackageCheck, Ban, AlertTriangle } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { AuthUser, BranchOption, TransferDetail, TransferRow } from '../../types';
import { Card, ErrorBox, Spinner, Modal, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { TRANSFER_STATUS } from './labels';
import { LinesEditor, Line } from './LinesEditor';

export const TransferBadge: React.FC<{ status: TransferRow['status'] }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TRANSFER_STATUS[status].cls}`}>{TRANSFER_STATUS[status].label}</span>
);

/**
 * Daftar transfer + aksi sesuai role:
 * Admin Cabang: ajukan & terima. Manager Cabang: setujui/tolak. Warehouse Pusat: dorong stok & kirim.
 */
export const TransferPanel: React.FC<{ currentUser: AuthUser; onChanged?: () => void }> = ({ currentUser, onChanged }) => {
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const role = currentUser.roleCode;
  const canCreate = role === 'branch-admin' || role === 'warehouse';

  const load = useCallback(() => {
    api.get<{ transfers: TransferRow[] }>(`/inventory/transfers${qs({ active: activeOnly ? 'true' : undefined })}`)
      .then((r) => { setRows(r.transfers); setError(null); }).catch((e) => setError((e as ApiError).message));
  }, [activeOnly]);
  useEffect(() => { load(); }, [load, key]);
  const changed = () => { setKey((k) => k + 1); onChanged?.(); };

  const needsMe = (t: TransferRow) =>
    (role === 'branch-manager' && t.status === 'requested') || (role === 'warehouse' && t.status === 'approved') ||
    (role === 'branch-admin' && t.status === 'shipped');

  return (
    <div className="space-y-3">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button onClick={() => setActiveOnly(true)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${activeOnly ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>Sedang berjalan</button>
          <button onClick={() => setActiveOnly(false)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${!activeOnly ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>Semua</button>
        </div>
        {canCreate && <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> {role === 'warehouse' ? 'Kirim Stok ke Cabang' : 'Ajukan Permintaan Stok'}</button>}
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr><th className="text-left px-4 py-3">No. Transfer</th><th className="text-left px-4 py-3">Tujuan</th><th className="text-left px-4 py-3">Diajukan</th>
                  <th className="text-right px-4 py-3">Item / Unit</th><th className="text-left px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((t) => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${needsMe(t) ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-slate-600 dark:text-slate-300">{t.transferNo}</span>
                      {t.requestNote && <p className="text-xs text-slate-500 truncate max-w-xs">{t.requestNote}</p>}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{t.toBranchName}<span className="block text-[11px] text-slate-400">dari {t.fromBranchName}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{t.requestedByName}<span className="block">{formatDateTime(t.createdAt)}</span></td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">{t.itemCount} / {t.units}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1"><TransferBadge status={t.status} />{t.hasDiscrepancy && <span title="Ada selisih penerimaan"><AlertTriangle className="w-4 h-4 text-red-500" /></span>}</div>
                      {needsMe(t) && <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Perlu tindakan Anda</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">Tidak ada transfer.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {openId && <TransferDetailModal id={openId} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={changed} />}
      {creating && <TransferCreateModal currentUser={currentUser} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); changed(); setOpenId(id); }} />}
    </div>
  );
};

const TransferCreateModal: React.FC<{ currentUser: AuthUser; onClose: () => void; onCreated: (id: string) => void }> = ({ currentUser, onClose, onCreated }) => {
  const isWh = currentUser.roleCode === 'warehouse';
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [toBranchId, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (isWh) api.get<{ branches: BranchOption[] }>('/branches').then((r) => setBranches(r.branches.filter((b) => b.type === 'branch'))).catch(() => undefined); }, [isWh]);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const r = await api.post<{ transfer: { id: string } }>('/inventory/transfers', {
        toBranchId: isWh ? toBranchId : undefined, note: note || null, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      onCreated(r.transfer.id);
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  };

  return (
    <Modal title={isWh ? 'Kirim Stok ke Cabang' : `Permintaan Stok ke Gudang Pusat — ${currentUser.branch?.name ?? ''}`} onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        {isWh && (
          <div>
            <label className={labelCls}>Cabang tujuan</label>
            <select className={inputCls} value={toBranchId} onChange={(e) => setTo(e.target.value)}>
              <option value="">— pilih cabang —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <LinesEditor lines={lines} onChange={setLines} />
        <div>
          <label className={labelCls}>Catatan / alasan</label>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. stok pajangan, pesanan nasabah menunggu..." />
        </div>
        {!isWh && <p className="text-xs text-slate-500">Permintaan akan diteruskan ke Manager Cabang untuk disetujui (sesuai Parameter Bisnis), lalu diproses Gudang Pusat.</p>}
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>Batal</button>
          <button className={btnPrimary} disabled={saving || lines.length === 0 || (isWh && !toBranchId)} onClick={submit}>{saving ? 'Menyimpan...' : 'Kirim'}</button>
        </div>
      </div>
    </Modal>
  );
};

const TransferDetailModal: React.FC<{ id: string; currentUser: AuthUser; onClose: () => void; onChanged: () => void }> = ({ id, currentUser, onClose, onChanged }) => {
  const [d, setD] = useState<TransferDetail | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const [mode, setMode] = useState<null | 'reject' | 'cancel'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<TransferDetail>(`/inventory/transfers/${id}`).then((r) => {
      setD(r);
      const init: Record<string, number> = {};
      for (const i of r.items) init[i.productId] = r.transfer.status === 'shipped' ? (i.qtyShipped ?? 0) : Math.min(i.qtyRequested, Math.max(0, i.fromAvailable));
      setQty(init);
    }).catch((e) => setError((e as ApiError).message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (path: string, body: unknown = {}) => {
    setBusy(true); setError(null);
    try { await api.post(`/inventory/transfers/${id}/${path}`, body); setMode(null); setText(''); load(); onChanged(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  if (!d) return <Modal title="Transfer Stok" onClose={onClose} wide>{error ? <ErrorBox message={error} /> : <Spinner />}</Modal>;
  const t = d.transfer;
  const role = currentUser.roleCode;
  const canApprove = role === 'branch-manager' && t.status === 'requested' && currentUser.branch?.id === t.toBranchId;
  const canShip = role === 'warehouse' && t.status === 'approved';
  const canReceive = role === 'branch-admin' && t.status === 'shipped' && currentUser.branch?.id === t.toBranchId;
  const canCancel = ['requested', 'approved'].includes(t.status) && (currentUser.id === t.requestedBy || role === 'warehouse');
  const items = d.items.map((i) => ({ ...i, key: i.productId }));
  const editQty = canShip || canReceive;
  const discrepancy = canReceive && items.some((i) => (qty[i.productId] ?? 0) !== (i.qtyShipped ?? 0));

  const steps = [
    { label: 'Diajukan', who: d.names.requestedBy, at: t.createdAt },
    { label: t.status === 'rejected' ? 'Ditolak' : 'Disetujui', who: d.names.approvedBy, at: t.approvedAt },
    { label: 'Dikirim', who: d.names.shippedBy, at: t.shippedAt },
    { label: 'Diterima', who: d.names.receivedBy, at: t.receivedAt },
  ];

  return (
    <Modal title={<span className="flex items-center gap-3"><span className="font-mono text-sm">{t.transferNo}</span><TransferBadge status={t.status} /></span>} onClose={onClose} wide="xl">
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <p className="text-sm text-slate-600 dark:text-slate-300"><strong>{d.names.fromName}</strong> → <strong>{d.names.toName}</strong>{t.shipmentRef ? ` · Armada/resi: ${t.shipmentRef}` : ''}</p>
        {t.requestNote && <p className="text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200">{t.requestNote}</p>}
        {t.rejectReason && <p className="text-sm p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">Alasan {t.status === 'rejected' ? 'penolakan' : 'pembatalan'}: {t.rejectReason}</p>}
        {t.receiveNote && <p className={`text-sm p-3 rounded-lg ${t.hasDiscrepancy ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/20 text-green-700'}`}>Catatan penerimaan: {t.receiveNote}</p>}

        <ol className="grid grid-cols-4 gap-2">
          {steps.map((s) => (
            <li key={s.label} className={`p-2 rounded-lg border text-xs ${s.at ? 'border-masri-primary/50 bg-masri-light/50 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-700 opacity-60'}`}>
              <p className="font-bold text-slate-700 dark:text-slate-200">{s.label}</p>
              <p className="text-slate-500">{s.who ?? '—'}</p>
              <p className="text-slate-400">{s.at ? formatDateTime(s.at) : ''}</p>
            </li>
          ))}
        </ol>

        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-900/50">
            <tr><th className="text-left px-3 py-2">Produk</th><th className="text-right px-3 py-2">Diminta</th>
              {canShip && <th className="text-right px-3 py-2">Tersedia Pusat</th>}
              <th className="text-right px-3 py-2">Dikirim</th><th className="text-right px-3 py-2">Diterima</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((i) => (
              <tr key={i.key}>
                <td className="px-3 py-2"><span className="font-mono text-xs text-slate-400">{i.sku}</span> <span className="text-slate-800 dark:text-slate-200">{i.name}</span></td>
                <td className="px-3 py-2 text-right">{i.qtyRequested}</td>
                {canShip && <td className={`px-3 py-2 text-right ${i.fromAvailable < i.qtyRequested ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>{i.fromAvailable}</td>}
                <td className="px-3 py-2 text-right">
                  {canShip ? <input type="number" min={0} max={i.qtyRequested} value={qty[i.productId] ?? 0} onChange={(e) => setQty({ ...qty, [i.productId]: parseInt(e.target.value || '0', 10) })} className="w-20 px-2 py-1 text-right border rounded dark:bg-slate-700 dark:text-white dark:border-slate-600" /> : (i.qtyShipped ?? '—')}
                </td>
                <td className="px-3 py-2 text-right">
                  {canReceive ? <input type="number" min={0} max={i.qtyShipped ?? 0} value={qty[i.productId] ?? 0} onChange={(e) => setQty({ ...qty, [i.productId]: parseInt(e.target.value || '0', 10) })} className="w-20 px-2 py-1 text-right border rounded dark:bg-slate-700 dark:text-white dark:border-slate-600" />
                    : <span className={i.qtyReceived !== null && i.qtyReceived !== i.qtyShipped ? 'text-red-600 font-semibold' : ''}>{i.qtyReceived ?? '—'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(editQty || mode) && (
          <div>
            <label className={labelCls}>{canShip ? 'No. armada / resi pengiriman' : mode === 'reject' ? 'Alasan penolakan' : mode === 'cancel' ? 'Alasan pembatalan' : `Catatan penerimaan${discrepancy ? ' (wajib, ada selisih)' : ''}`}</label>
            <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {canCancel && !mode && <button className={btnSecondary} onClick={() => setMode('cancel')}><Ban className="w-4 h-4" /> Batalkan</button>}
          {mode === 'cancel' && <button className={btnSecondary} disabled={busy} onClick={() => run('cancel', { reason: text })}><Ban className="w-4 h-4" /> Konfirmasi Batal</button>}
          {canApprove && !mode && <button className={btnSecondary} onClick={() => setMode('reject')}><XCircle className="w-4 h-4" /> Tolak</button>}
          {mode === 'reject' && <button className={btnSecondary} disabled={busy} onClick={() => run('reject', { reason: text })}><XCircle className="w-4 h-4" /> Konfirmasi Tolak</button>}
          {canApprove && !mode && <button className={btnPrimary} disabled={busy} onClick={() => run('approve')}><CheckCircle2 className="w-4 h-4" /> Setujui</button>}
          {canShip && <button className={btnPrimary} disabled={busy} onClick={() => run('ship', { shipmentRef: text || null, items: items.map((i) => ({ productId: i.productId, qty: qty[i.productId] ?? 0 })) })}><Truck className="w-4 h-4" /> Kirim</button>}
          {canReceive && <button className={btnPrimary} disabled={busy} onClick={() => run('receive', { note: text || null, items: items.map((i) => ({ productId: i.productId, qty: qty[i.productId] ?? 0 })) })}><PackageCheck className="w-4 h-4" /> Terima Barang</button>}
        </div>
      </div>
    </Modal>
  );
};
