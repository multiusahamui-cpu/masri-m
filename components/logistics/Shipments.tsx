import { Attachments } from '../files/Attachments';
import React, { useCallback, useEffect, useState } from 'react';
import { Truck, Package, Store, CalendarClock, Send, CheckCircle2, XCircle, KeyRound, Repeat, Search, Wrench } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';

export interface ShipmentRow {
  id: string; shipmentNo: string; sourceType: 'credit' | 'order' | 'return'; sourceNo: string; mode: 'internal' | 'partner' | 'pickup'; status: string;
  recipientName: string; recipientPhone: string; address: string; city: string; itemsSummary: string; isBulky: boolean; needsInstallation: boolean;
  shippingFee: number; scheduledDate: string | null; scheduledSlot: string | null; trackingNo: string | null; courierStatus?: string | null; postalCode?: string | null; vehicleRef: string | null;
  driverName?: string | null; fromName?: string; modeLabel: string; canOperate: boolean; updatedAt: string; fromBranchId: string; podName: string | null; failReason: string | null;
}

export const SHIP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Perlu diproses', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  scheduled: { label: 'Terjadwal', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  ready_pickup: { label: 'Siap diambil', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  in_transit: { label: 'Dalam perjalanan', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  delivered: { label: 'Diterima', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  failed: { label: 'Gagal antar', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Dibatalkan', cls: 'bg-slate-200 text-slate-600' },
};
export const ShipBadge = ({ status }: { status: string }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${SHIP_STATUS[status]?.cls}`}>{SHIP_STATUS[status]?.label ?? status}</span>;
const ModeIcon = ({ m }: { m: string }) => (m === 'pickup' ? <Store className="w-4 h-4" /> : m === 'internal' ? <Truck className="w-4 h-4" /> : <Package className="w-4 h-4" />);

const CHIPS = [
  { label: 'Perlu tindakan', statuses: 'pending,failed,scheduled,ready_pickup' },
  { label: 'Dalam perjalanan', statuses: 'in_transit' },
  { label: 'Selesai', statuses: 'delivered' },
  { label: 'Semua' },
];

/** Daftar pengiriman 3 mode untuk lokasi stok (Gudang Pusat / cabang) atau tugas driver. */
export const ShipmentsWorkspace: React.FC<{ currentUser: AuthUser; driverMode?: boolean; title?: string }> = ({ currentUser, driverMode, title }) => {
  const [rows, setRows] = useState<ShipmentRow[] | null>(null);
  const [statuses, setStatuses] = useState<string | undefined>(driverMode ? 'scheduled,in_transit' : CHIPS[0].statuses);
  const [mode, setMode] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ shipments: ShipmentRow[] }>(`/shipments${qs({ statuses, mode, search })}`).then((r) => { setRows(r.shipments); setError(null); }).catch((e) => setError((e as ApiError).message));
  }, [statuses, mode, search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, key]);
  const chips = driverMode ? [{ label: 'Tugas aktif', statuses: 'scheduled,in_transit' }, { label: 'Riwayat', statuses: 'delivered,failed' }] : CHIPS;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Truck className="w-6 h-6" />} title={title ?? (driverMode ? 'Tugas Pengiriman Saya' : `Pengiriman — ${currentUser.branch?.name ?? ''}`)}
        subtitle={driverMode ? 'Berangkat, antar, lalu catat bukti terima (nama penerima & foto). Bukti terima mengaktifkan cicilan / menyelesaikan order.'
          : 'Proses pengiriman dari lokasi stok Anda: armada internal (jadwal & driver), kurir mitra (booking & resi), atau ambil sendiri (kode pengambilan).'} />
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => <button key={c.label} onClick={() => setStatuses(c.statuses)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${statuses === c.statuses ? 'bg-masri-primary text-white border-masri-primary' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{c.label}</button>)}
        </div>
        {!driverMode && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative md:col-span-2"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} placeholder="Cari no. pengiriman / order / akad / nama / resi..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Semua mode</option><option value="internal">Armada internal</option><option value="partner">Kurir mitra</option><option value="pickup">Ambil sendiri</option>
            </select>
          </div>
        )}
      </Card>
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!rows ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((s) => (
            <button key={s.id} onClick={() => setOpenId(s.id)} className="text-left">
              <Card className={`p-4 h-full hover:border-masri-primary transition-colors ${s.canOperate && ['pending', 'failed'].includes(s.status) ? 'ring-1 ring-amber-400' : ''}`}>
                <div className="flex justify-between items-start gap-2">
                  <span className="font-mono text-xs text-slate-500">{s.shipmentNo}</span><ShipBadge status={s.status} />
                </div>
                <p className="font-semibold text-slate-800 dark:text-white mt-1">{s.recipientName}</p>
                <p className="text-xs text-slate-500">{s.mode === 'pickup' ? `Ambil di ${s.fromName}` : `${s.address}, ${s.city}`}</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">{s.itemsSummary}</p>
                <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-slate-600 dark:text-slate-300">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700"><ModeIcon m={s.mode} />{s.modeLabel}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700">{s.sourceType === 'credit' ? 'Kredit' : s.sourceType === 'return' ? 'Ganti retur' : 'Tunai'} · {s.sourceNo}</span>
                  {s.needsInstallation && <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700"><Wrench className="w-3 h-3" />Pasang</span>}
                  {s.scheduledDate && <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700">{s.scheduledDate} {s.scheduledSlot}{s.driverName ? ` · ${s.driverName}` : ''}</span>}
                  {s.trackingNo && <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">Resi {s.trackingNo}</span>}
                </div>
              </Card>
            </button>
          ))}
          {rows.length === 0 && <p className="col-span-full text-center py-10 text-slate-500">Tidak ada pengiriman.</p>}
        </div>
      )}
      {openId && <ShipmentDetailModal id={openId} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={() => setKey((k) => k + 1)} />}
    </div>
  );
};

interface Detail {
  shipment: ShipmentRow & { pickupExpiresAt: string | null; podNote: string | null; deliveredAt: string | null; hasPickupCode: boolean; weightKg: number };
  from: { name: string; city: string; address: string; type: string }; driver: { fullName: string; phone: string | null } | null;
  events: { id: number; status: string; message: string | null; actorName: string | null; createdAt: string }[]; modeLabel: string; canOperate: boolean; isMyTask: boolean;
}

const ShipmentDetailModal: React.FC<{ id: string; currentUser: AuthUser; onClose: () => void; onChanged: () => void }> = ({ id, currentUser, onClose, onChanged }) => {
  const [d, setD] = useState<Detail | null>(null);
  const [drivers, setDrivers] = useState<{ id: string; fullName: string; todayTasks: number }[]>([]);
  const [sch, setSch] = useState({ driverId: '', date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), slot: 'pagi', vehicleRef: '' });
  const [pod, setPod] = useState({ podName: '', podNote: '', podPhotoUrl: '', pickupCode: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.get<Detail>(`/shipments/${id}`).then((r) => { setD(r); setPod((p) => ({ ...p, podName: p.podName || r.shipment.recipientName })); }).catch((e) => setError((e as ApiError).message)); }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (d?.canOperate && d.shipment.mode === 'internal') api.get<{ drivers: typeof drivers }>(`/drivers?branchId=${d.shipment.fromBranchId}`).then((r) => setDrivers(r.drivers)).catch(() => undefined); }, [d?.canOperate, d?.shipment.mode, d?.shipment.fromBranchId]);

  const run = async (path: string, body: unknown = {}) => {
    setBusy(true); setError(null);
    try { await api.post(`/shipments/${id}/${path}`, body); load(); onChanged(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  if (!d) return <Modal title="Pengiriman" onClose={onClose} wide>{error ? <ErrorBox message={error} /> : <Spinner />}</Modal>;
  const s = d.shipment;
  const op = d.canOperate;
  const driverCan = d.isMyTask && currentUser.roleCode === 'delivery';
  const actor = op || driverCan;

  return (
    <Modal wide="xl" onClose={onClose} title={<span className="flex items-center gap-3"><span className="font-mono text-sm">{s.shipmentNo}</span><ShipBadge status={s.status} /><span className="text-sm text-slate-500">{d.modeLabel}</span></span>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <ErrorBox message={error} onClose={() => setError(null)} />
          <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm space-y-1">
            <p><span className="text-slate-500">Penerima</span> <strong>{s.recipientName}</strong> · {s.recipientPhone}</p>
            <p><span className="text-slate-500">{s.mode === 'pickup' ? 'Lokasi ambil' : 'Alamat'}</span> {s.mode === 'pickup' ? `${d.from.name} (${d.from.address || d.from.city})` : `${s.address}, ${s.city}`}</p>
            <p><span className="text-slate-500">Barang</span> {s.itemsSummary} · {s.weightKg} kg{s.isBulky ? ' · barang besar' : ''}{s.needsInstallation ? ' · perlu pemasangan' : ''}</p>
            <p><span className="text-slate-500">Asal stok</span> {d.from.name} · <span className="text-slate-500">Sumber</span> {s.sourceType === 'credit' ? 'Akad kredit' : s.sourceType === 'return' ? 'Barang pengganti retur' : 'Order tunai'} {s.sourceNo}</p>
            <p><span className="text-slate-500">Ongkir</span> {formatMoney(s.shippingFee)}</p>
            {d.driver && <p><span className="text-slate-500">Driver</span> {d.driver.fullName} {d.driver.phone ?? ''} {s.vehicleRef ? `· ${s.vehicleRef}` : ''}</p>}
            {s.trackingNo && <p><span className="text-slate-500">No. resi</span> <span className="font-mono">{s.trackingNo}</span></p>}
            {s.courierStatus && <p><span className="text-slate-500">Status kurir</span> {s.courierStatus}</p>}
            {s.podName && <p className="text-green-700"><span className="text-slate-500">Diterima</span> {s.podName} · {formatDateTime(s.deliveredAt)}{s.podNote ? ` — ${s.podNote}` : ''}</p>}
            {s.failReason && <p className="text-red-600">Gagal: {s.failReason}</p>}
          </section>
          {s.status === 'delivered' && <Attachments ownerType="shipment" ownerId={s.id} kinds={['pod']} canUpload={false} title="Foto bukti terima" compact />}
          <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-3">
            {d.events.map((e) => <li key={e.id} className="ml-4"><span className="absolute -left-[7px] w-3 h-3 rounded-full bg-masri-primary" />
              <p className="text-sm text-slate-700 dark:text-slate-200">{e.message}</p><p className="text-[11px] text-slate-400">{e.actorName} · {formatDateTime(e.createdAt)}</p></li>)}
          </ol>
        </div>

        <div className="space-y-4">
          {op && s.mode === 'internal' && ['pending', 'failed', 'scheduled'].includes(s.status) && (
            <Box title="Jadwalkan Armada Internal">
              <select className={inputCls} value={sch.driverId} onChange={(e) => setSch({ ...sch, driverId: e.target.value })}>
                <option value="">— pilih driver —</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.fullName} ({x.todayTasks} tugas aktif)</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input type="date" className={inputCls} value={sch.date} onChange={(e) => setSch({ ...sch, date: e.target.value })} />
                <select className={inputCls} value={sch.slot} onChange={(e) => setSch({ ...sch, slot: e.target.value })}><option value="pagi">Pagi</option><option value="siang">Siang</option><option value="sore">Sore</option></select>
                <input className={inputCls} placeholder="No. kendaraan" value={sch.vehicleRef} onChange={(e) => setSch({ ...sch, vehicleRef: e.target.value })} />
              </div>
              {drivers.length === 0 && <p className="text-xs text-amber-600">Belum ada akun Delivery di lokasi ini — tambahkan lewat Super Admin.</p>}
              <button className={btnPrimary} disabled={busy || !sch.driverId} onClick={() => run('schedule', { ...sch, vehicleRef: sch.vehicleRef || null })}><CalendarClock className="w-4 h-4" /> Simpan Jadwal</button>
            </Box>
          )}
          {op && s.mode === 'partner' && ['pending', 'failed'].includes(s.status) && (
            <Box title="Booking Kurir Mitra">
              <p className="text-sm text-slate-600 dark:text-slate-300">{d.modeLabel} · {formatMoney(s.shippingFee)}. Kemas barang, cetak label, lalu serahkan ke kurir.</p>
              <button className={btnPrimary} disabled={busy} onClick={() => run('book')}><Send className="w-4 h-4" /> Booking & Dapatkan Resi</button>
            </Box>
          )}
          {op && s.mode === 'pickup' && s.status === 'pending' && (
            <Box title="Siapkan Barang untuk Diambil">
              <p className="text-sm text-slate-600 dark:text-slate-300">Setelah disiapkan, sistem menerbitkan kode pengambilan yang hanya dilihat nasabah di halaman lacak.</p>
              <button className={btnPrimary} disabled={busy} onClick={() => run('prepare-pickup')}><KeyRound className="w-4 h-4" /> Barang Siap Diambil</button>
            </Box>
          )}
          {actor && s.status === 'scheduled' && (driverCan || op) && (
            <Box title="Berangkat"><button className={btnPrimary} disabled={busy} onClick={() => run('dispatch')}><Truck className="w-4 h-4" /> Barang Dibawa Driver</button></Box>
          )}
          {((actor && s.status === 'in_transit') || (op && s.status === 'ready_pickup')) && (
            <Box title={s.mode === 'pickup' ? 'Serahkan ke Nasabah (verifikasi kode)' : 'Bukti Terima (POD)'}>
              {s.mode === 'pickup' && <input className={`${inputCls} font-mono text-lg tracking-widest`} placeholder="Kode pengambilan dari nasabah" value={pod.pickupCode} onChange={(e) => setPod({ ...pod, pickupCode: e.target.value })} />}
              <input className={inputCls} placeholder="Nama penerima" value={pod.podName} onChange={(e) => setPod({ ...pod, podName: e.target.value })} />
              <input className={inputCls} placeholder="Catatan (kondisi barang, pemasangan...)" value={pod.podNote} onChange={(e) => setPod({ ...pod, podNote: e.target.value })} />
              {s.mode !== 'pickup' && <Attachments ownerType="shipment" ownerId={s.id} kinds={['pod']} canUpload title="Foto bukti terima (barang & penerima)" compact />}
              <button className={btnPrimary} disabled={busy || !pod.podName} onClick={() => run('deliver', { ...pod, podNote: pod.podNote || null, podPhotoUrl: pod.podPhotoUrl || null, pickupCode: pod.pickupCode || null })}>
                <CheckCircle2 className="w-4 h-4" /> Barang Diterima</button>
              <p className="text-[11px] text-slate-500">{s.sourceType === 'credit' ? 'Mengaktifkan jadwal angsuran Murabahah.' : s.sourceType === 'return' ? 'Menyelesaikan retur & mengeluarkan stok pengganti.' : 'Menyelesaikan order & mengeluarkan stok.'}</p>
            </Box>
          )}
          {actor && ['scheduled', 'in_transit'].includes(s.status) && (
            <details className="text-sm"><summary className="cursor-pointer text-slate-500 hover:text-red-600">Gagal antar</summary>
              <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="Alasan (alamat tidak ditemukan, nasabah tidak di tempat...)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className={btnSecondary} disabled={busy} onClick={() => run('fail', { reason })}><XCircle className="w-4 h-4" /> Catat</button></div></details>
          )}
          {op && ['pending', 'failed'].includes(s.status) && s.mode !== 'partner' && (
            <button className={`${btnSecondary} w-full justify-center`} disabled={busy} onClick={() => run('change-mode', { mode: s.mode === 'pickup' ? 'internal' : 'pickup' })}>
              <Repeat className="w-4 h-4" /> Ubah ke {s.mode === 'pickup' ? 'armada internal' : 'ambil sendiri'}</button>
          )}
          {!actor && <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-sm text-slate-500">Pengiriman ini diproses oleh {d.from.name}.</p>}
        </div>
      </div>
    </Modal>
  );
};

const Box: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="p-4 rounded-xl border border-masri-primary/40 bg-masri-light/40 dark:bg-emerald-900/10 space-y-3"><h4 className="font-bold text-masri-dark dark:text-emerald-200">{title}</h4>{children}</section>
);
