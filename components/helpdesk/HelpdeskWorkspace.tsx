import React, { useEffect, useState } from 'react';
import { Headset, Inbox, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { AuthUser, BranchOption } from '../../types';
import { PageHeader, btnPrimary } from '../superadmin/ui';
import { TicketList, TicketFilter } from './TicketList';
import { TicketDetail } from './TicketDetail';
import { CreateTicketModal } from './CreateTicketModal';

/**
 * Ruang kerja tiket:
 * - Helpdesk Pusat : semua tiket, buat tiket, eskalasi, selesaikan, tutup.
 * - Admin Cabang   : tiket yang dieskalasi ke cabangnya, tandai selesai ditangani cabang.
 */
export const HelpdeskWorkspace: React.FC<{ currentUser: AuthUser; focusTicketId?: string | null; onFocusHandled?: () => void }> = ({ currentUser, focusTicketId, onFocusHandled }) => {
  const isSupport = currentUser.roleCode === 'support';
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [filter, setFilter] = useState<TicketFilter>({ status: isSupport ? 'pending' : 'escalated' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.get<{ branches: BranchOption[] }>('/branches').then((r) => setBranches(r.branches)).catch(() => undefined); }, []);
  useEffect(() => { if (focusTicketId) { setOpenId(focusTicketId); onFocusHandled?.(); } }, [focusTicketId, onFocusHandled]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={isSupport ? <Headset className="w-6 h-6" /> : <Inbox className="w-6 h-6" />}
        title={isSupport ? 'Helpdesk Pusat — Satu Pintu' : `Tiket Eskalasi — ${currentUser.branch?.name ?? ''}`}
        subtitle={isSupport
          ? 'Semua keluhan nasabah masuk ke sini. Eskalasi ke Admin Cabang bila perlu tindakan di cabang; Manager Cabang & Business Manager otomatis mendapat tembusan.'
          : 'Tiket yang dieskalasi Helpdesk Pusat ke cabang Anda. Tindak lanjuti, beri komentar perkembangan, lalu tandai "Selesai Ditangani Cabang".'}
        actions={isSupport ? <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Tiket Baru</button> : undefined}
      />

      <TicketList filter={filter} onFilterChange={setFilter} onOpen={setOpenId} refreshKey={refreshKey}
        branches={isSupport ? branches : undefined}
        hideStatuses={isSupport ? [] : ['open', 'in_progress']} />

      {openId && (
        <TicketDetail ticketId={openId} currentUser={currentUser} branches={branches}
          onClose={() => setOpenId(null)} onChanged={() => setRefreshKey((k) => k + 1)} />
      )}
      {creating && (
        <CreateTicketModal branches={branches} onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setRefreshKey((k) => k + 1); setOpenId(id); }} />
      )}
    </div>
  );
};
