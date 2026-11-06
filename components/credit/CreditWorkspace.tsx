import React, { useEffect, useState } from 'react';
import { FileText, CheckSquare, ThumbsUp, Truck, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { AuthUser, BranchOption, CreditRow } from '../../types';
import { PageHeader, Modal, btnPrimary } from '../superadmin/ui';
import { CreditList, CreditFilter } from './CreditList';
import { CreditDetailModal } from './CreditDetail';
import { ApplyForm } from './ApplyForm';

type Mode = 'ao' | 'mc' | 'bm' | 'ba';

const CONFIG: Record<Mode, { title: string; subtitle: string; icon: React.ReactNode; chips: { label: string; statuses?: string }[]; defaultStatuses?: string; mine: (r: CreditRow, u: AuthUser) => boolean }> = {
  ao: {
    title: 'Pengajuan Saya', icon: <FileText className="w-6 h-6" />,
    subtitle: 'Pengajuan yang ditugaskan kepada Anda: verifikasi KYC, survei lapangan, rekomendasi, lalu akad setelah disetujui Pusat.',
    chips: [{ label: 'Perlu dikerjakan', statuses: 'assigned,approved' }, { label: 'Menunggu keputusan', statuses: 'branch_review,hq_review' }, { label: 'Akad / aktif', statuses: 'contracted,active' }, { label: 'Semua' }],
    defaultStatuses: 'assigned,approved', mine: (r) => r.status === 'assigned' || r.status === 'approved',
  },
  mc: {
    title: 'Pengajuan Kredit Cabang', icon: <ThumbsUp className="w-6 h-6" />,
    subtitle: 'Tugaskan AO untuk pengajuan baru, review rekomendasi AO, lalu teruskan ke Business Manager Pusat yang menetapkan keputusan kredit.',
    chips: [{ label: 'Perlu tindakan', statuses: 'submitted,branch_review' }, { label: 'Proses AO', statuses: 'assigned' }, { label: 'Di Pusat', statuses: 'hq_review' }, { label: 'Disetujui / akad', statuses: 'approved,contracted' }, { label: 'Aktif', statuses: 'active' }, { label: 'Ditolak / batal', statuses: 'rejected,cancelled' }, { label: 'Semua' }],
    defaultStatuses: 'submitted,branch_review', mine: (r) => r.status === 'submitted' || r.status === 'branch_review',
  },
  bm: {
    title: 'Approval Kredit — Kantor Pusat', icon: <CheckSquare className="w-6 h-6" />,
    subtitle: 'Keputusan penetapan kredit seluruh cabang. Pembiayaan di atas batas wewenang memerlukan dua suara Business Manager (komite).',
    chips: [{ label: 'Menunggu keputusan', statuses: 'hq_review' }, { label: 'Disetujui', statuses: 'approved,contracted,active' }, { label: 'Ditolak', statuses: 'rejected' }, { label: 'Semua' }],
    defaultStatuses: 'hq_review', mine: (r) => r.status === 'hq_review',
  },
  ba: {
    title: 'Serah Terima Barang', icon: <Truck className="w-6 h-6" />,
    subtitle: 'Pembiayaan yang sudah akad dan menunggu barang diserahkan ke nasabah. Serah terima mengaktifkan jadwal angsuran.',
    chips: [{ label: 'Siap serah terima', statuses: 'contracted' }, { label: 'Disetujui (menunggu akad)', statuses: 'approved' }, { label: 'Sudah diserahkan', statuses: 'active,paid_off' }],
    defaultStatuses: 'contracted', mine: (r) => r.status === 'contracted',
  },
};

export const CreditWorkspace: React.FC<{ mode: Mode; currentUser: AuthUser; focusId?: string | null; onFocusHandled?: () => void; startNew?: boolean }> = ({ mode, currentUser, focusId, onFocusHandled, startNew }) => {
  const cfg = CONFIG[mode];
  const [filter, setFilter] = useState<CreditFilter>({ statuses: cfg.defaultStatuses });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(!!startNew);
  const [key, setKey] = useState(0);
  const [branches, setBranches] = useState<BranchOption[] | undefined>(undefined);
  useEffect(() => { if (mode === 'bm') api.get<{ branches: BranchOption[] }>('/branches').then((r) => setBranches(r.branches)).catch(() => undefined); }, [mode]);
  useEffect(() => { if (focusId) { setOpenId(focusId); onFocusHandled?.(); } }, [focusId, onFocusHandled]);
  const canCreate = (mode === 'ao' || mode === 'mc') && currentUser.branch;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle}
        actions={canCreate ? <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Input Pengajuan</button> : undefined} />
      <CreditList filter={filter} onFilterChange={setFilter} chips={cfg.chips} onOpen={setOpenId} branches={branches} refreshKey={key} highlight={(r) => cfg.mine(r, currentUser)} />
      {openId && <CreditDetailModal id={openId} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={() => setKey((k) => k + 1)} />}
      {creating && currentUser.branch && (
        <Modal title={`Input Pengajuan — ${currentUser.branch.name}`} onClose={() => setCreating(false)} wide="xl">
          <ApplyForm mode="staff" fixedBranch={{ id: currentUser.branch.id, name: currentUser.branch.name }}
            onSubmitted={(r) => { setCreating(false); setKey((k) => k + 1); if (r.id) setOpenId(r.id); }} />
        </Modal>
      )}
    </div>
  );
};
