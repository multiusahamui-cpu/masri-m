import React, { useEffect, useState } from 'react';
import { Boxes, ClipboardList, ArrowLeftRight, ClipboardCheck, AlertTriangle, Warehouse } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { AuthUser, BranchOption, InventorySummary } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, inputCls } from '../superadmin/ui';
import { StockTable } from './StockTable';
import { TransferPanel } from './Transfers';
import { ReceiptsPanel } from './Receipts';
import { AdjustmentsPanel } from './Adjustments';
import { TRANSFER_STATUS } from './labels';

/** Ringkasan stok semua lokasi (Warehouse / System Admin / BM) atau satu cabang. */
export const InventoryOverview: React.FC<{ onPick?: (branchId: string) => void }> = ({ onPick }) => {
  const [s, setS] = useState<InventorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<InventorySummary>('/inventory/summary').then(setS).catch((e) => setError((e as ApiError).message)); }, []);
  if (error) return <ErrorBox message={error} />;
  if (!s) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['requested', 'approved', 'shipped'] as const).map((st) => (
          <Card key={st} className="p-4">
            <p className="text-2xl font-bold text-slate-800 dark:text-white">{s.transfers.find((t) => t.status === st)?.n ?? 0}</p>
            <p className="text-xs text-slate-500">Transfer {TRANSFER_STATUS[st].label.toLowerCase()}</p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {s.locations.map((l) => (
          <button key={l.branchId} onClick={() => onPick?.(l.branchId)} className="text-left">
            <Card className={`p-5 hover:border-masri-primary transition-colors ${l.branchType === 'head_office' ? 'ring-1 ring-masri-gold/60' : ''}`}>
              <p className="text-xs text-slate-400 flex items-center gap-1">{l.branchType === 'head_office' && <Warehouse className="w-3.5 h-3.5" />}{l.branchCode}</p>
              <p className="font-bold text-slate-800 dark:text-white">{l.branchName}</p>
              <p className="text-3xl font-bold text-masri-primary mt-2">{l.units - l.reserved}<span className="text-sm font-normal text-slate-500"> unit tersedia</span></p>
              <p className="text-xs text-slate-500">{l.skuInStock} SKU · fisik {l.units} · dipesan {l.reserved}</p>
              {l.lowCount > 0 && <p className="text-xs text-amber-600 font-semibold mt-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{l.lowCount} produk stok menipis</p>}
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
};

/** Gudang Pusat: ringkasan, stok per lokasi, penerimaan, transfer, opname. */
export const WarehouseModule: React.FC<{ menu: string; currentUser: AuthUser; onNavigate: (m: string) => void }> = ({ menu, currentUser, onNavigate }) => {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loc, setLoc] = useState<string>(currentUser.branch?.id ?? '');
  const [key, setKey] = useState(0);
  const isWh = currentUser.roleCode === 'warehouse';
  useEffect(() => { api.get<{ branches: BranchOption[] }>('/branches').then((r) => setBranches(r.branches)).catch(() => undefined); }, []);
  const bump = () => setKey((k) => k + 1);

  const header = (icon: React.ReactNode, title: string, subtitle: string) => <PageHeader icon={icon} title={title} subtitle={subtitle} />;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {menu === 'dashboard' && (<>
        {header(<Boxes className="w-6 h-6" />, 'Ringkasan Stok', 'Posisi stok Gudang Pusat dan buffer seluruh cabang. Klik lokasi untuk melihat rincian.')}
        <InventoryOverview key={key} onPick={(id) => { setLoc(id); onNavigate('inventory'); }} />
      </>)}
      {menu === 'inventory' && (<>
        {header(<Boxes className="w-6 h-6" />, 'Stok per Lokasi', 'Fisik = barang di lokasi, Dipesan = sudah direservasi order, Tersedia = bisa dijual / ditransfer.')}
        <Card className="p-4 flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Lokasi:</span>
          <select className={`${inputCls} max-w-sm`} value={loc} onChange={(e) => setLoc(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.type === 'head_office' ? ' (Gudang Pusat)' : ''}</option>)}
          </select>
        </Card>
        {loc && <StockTable branchId={loc} canEditMin={isWh && loc === currentUser.branch?.id} refreshKey={key} />}
      </>)}
      {menu === 'receipt' && (<>
        {header(<ClipboardList className="w-6 h-6" />, 'Penerimaan Barang', 'Barang masuk dari supplier ke Gudang Pusat. Stok bertambah otomatis dan tercatat di kartu stok.')}
        <ReceiptsPanel canCreate={isWh} onChanged={bump} />
      </>)}
      {menu === 'transfers' && (<>
        {header(<ArrowLeftRight className="w-6 h-6" />, 'Transfer ke Cabang', 'Proses permintaan stok cabang yang sudah disetujui, atau dorong stok langsung ke cabang.')}
        <TransferPanel currentUser={currentUser} onChanged={bump} />
      </>)}
      {menu === 'opname' && currentUser.branch && (<>
        {header(<ClipboardCheck className="w-6 h-6" />, 'Stock Opname Gudang Pusat', 'Catat hasil hitung fisik, barang rusak atau hilang.')}
        <AdjustmentsPanel branchId={currentUser.branch.id} canCreate={isWh} onChanged={bump} />
      </>)}
    </div>
  );
};

/** Cabang: stok buffer, permintaan & penerimaan transfer, opname (Admin Cabang) atau persetujuan (Manager Cabang). */
export const BranchStockModule: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [tab, setTab] = useState<'stock' | 'transfers' | 'opname' | 'receipts'>(currentUser.roleCode === 'branch-manager' ? 'transfers' : 'stock');
  const [key, setKey] = useState(0);
  const isAdmin = currentUser.roleCode === 'branch-admin';
  const branchId = currentUser.branch?.id;
  // Cabang luar negeri menerima barang langsung dari pemasok lokal (tidak ada transfer lintas negara)
  const regional = !!currentUser.branch?.countryCode && currentUser.branch.countryCode !== 'ID';
  if (!branchId) return <ErrorBox message="Akun Anda belum ditempatkan di cabang." />;
  const tabs = [
    { id: 'stock', label: 'Stok Buffer' },
    ...(regional ? [{ id: 'receipts', label: 'Penerimaan Barang (Pemasok Lokal)' }] : [{ id: 'transfers', label: isAdmin ? 'Permintaan & Penerimaan' : 'Persetujuan Permintaan Stok' }]),
    ...(isAdmin ? [{ id: 'opname', label: 'Stock Opname' }] : []),
  ] as { id: 'stock' | 'transfers' | 'opname' | 'receipts'; label: string }[];
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Boxes className="w-6 h-6" />} title={`Stok ${currentUser.branch?.name}`}
        subtitle={isAdmin ? 'Kelola buffer stok cabang: ajukan permintaan ke Gudang Pusat, terima kiriman, dan lakukan stock opname.'
          : 'Pantau stok buffer cabang dan setujui permintaan stok yang diajukan Admin Cabang.'} />
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? 'border-masri-primary text-masri-primary' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'stock' && <StockTable branchId={branchId} canEditMin={isAdmin} refreshKey={key} />}
      {tab === 'transfers' && <TransferPanel currentUser={currentUser} onChanged={() => setKey((k) => k + 1)} />}
      {tab === 'receipts' && <ReceiptsPanel canCreate={isAdmin} onChanged={() => setKey((k) => k + 1)} />}
      {tab === 'opname' && <AdjustmentsPanel branchId={branchId} canCreate={isAdmin} onChanged={() => setKey((k) => k + 1)} />}
    </div>
  );
};
