import React, { useCallback, useEffect, useState } from 'react';
import {
  User, Phone, Mail, MapPin, Building2, Clock, Send, ArrowUpRight, CheckCircle2, Play, Lock, RotateCcw, Users, History,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { AuthUser, BranchOption, HdTicketDetail } from '../../types';
import { Modal, ErrorBox, Spinner, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { CATEGORY_LABEL, CHANNEL_LABEL, ROLE_SHORT, WATCHER_REASON, timeLeft } from './labels';
import { HdPriorityText, HdStatusBadge } from './HdBadges';

type Action = 'escalate' | 'resolve' | 'branch-done' | 'reopen' | null;

const EVENT_LABEL: Record<string, string> = {
  created: 'membuat tiket', comment: 'berkomentar', status_changed: 'mengubah status', escalated: 'mengeskalasi ke cabang',
  branch_done: 'menyelesaikan di cabang', resolved: 'menyelesaikan tiket', closed: 'menutup tiket', reopened: 'membuka ulang tiket',
};
const EVENT_DOT: Record<string, string> = {
  created: 'bg-sky-500', comment: 'bg-slate-400', status_changed: 'bg-indigo-500', escalated: 'bg-amber-500',
  branch_done: 'bg-teal-500', resolved: 'bg-green-600', closed: 'bg-slate-500', reopened: 'bg-red-500',
};

export const TicketDetail: React.FC<{ ticketId: string; currentUser: AuthUser; branches: BranchOption[]; onClose: () => void; onChanged: () => void }> = ({ ticketId, currentUser, branches, onClose, onChanged }) => {
  const [data, setData] = useState<HdTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [actionText, setActionText] = useState('');
  const [targetBranch, setTargetBranch] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<HdTicketDetail>(`/helpdesk/tickets/${ticketId}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const run = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/helpdesk/tickets/${ticketId}/${path}`, body);
      setAction(null);
      setActionText('');
      await load();
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (comment.trim().length < 2) return;
    await run('comments', { message: comment.trim() });
    setComment('');
  };

  const openAction = (a: Action) => {
    setAction(a);
    setActionText(a === 'resolve' ? (data?.ticket.resolution ?? '') : '');
    if (a === 'escalate') setTargetBranch(data?.ticket.branch?.id ?? '');
  };

  if (!data) {
    return <Modal title="Detail Tiket" onClose={onClose} wide="xl">{error ? <ErrorBox message={error} /> : <Spinner />}</Modal>;
  }

  const t = data.ticket;
  const role = currentUser.roleCode;
  const isSupport = role === 'support';
  const done = t.status === 'resolved' || t.status === 'closed';
  const sla = timeLeft(t.dueAt, done);
  const canBranchDone = role === 'branch-admin' && t.status === 'escalated' && currentUser.branch?.id === t.branch?.id;

  return (
    <Modal wide="xl" onClose={onClose} title={
      <span className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-sm text-slate-500">{t.ticketNo}</span>
        <HdStatusBadge status={t.status} />
        <HdPriorityText priority={t.priority} />
      </span>
    }>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />

        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">{t.subject}</h2>
          <p className="text-xs text-slate-500 mt-1">
            {CATEGORY_LABEL[t.category]} · via {CHANNEL_LABEL[t.channel]}{t.orderRef ? ` · Order ${t.orderRef}` : ''} · dibuat {formatDateTime(t.createdAt)}{t.createdByName ? ` oleh ${t.createdByName}` : ''}
          </p>
        </div>

        {/* Tombol aksi sesuai role */}
        <div className="flex flex-wrap gap-2">
          {isSupport && t.status === 'open' && <button className={btnSecondary} disabled={busy} onClick={() => run('start')}><Play className="w-4 h-4" /> Mulai Tangani</button>}
          {isSupport && ['open', 'in_progress', 'branch_done'].includes(t.status) && (
            <button className={btnSecondary} disabled={busy} onClick={() => openAction('escalate')}><ArrowUpRight className="w-4 h-4" /> {t.status === 'branch_done' ? 'Eskalasi Ulang' : 'Eskalasi ke Cabang'}</button>
          )}
          {isSupport && ['open', 'in_progress', 'branch_done'].includes(t.status) && (
            <button className={btnPrimary} disabled={busy} onClick={() => openAction('resolve')}><CheckCircle2 className="w-4 h-4" /> Selesaikan</button>
          )}
          {isSupport && t.status === 'resolved' && <button className={btnPrimary} disabled={busy} onClick={() => run('close')}><Lock className="w-4 h-4" /> Tutup Tiket</button>}
          {isSupport && done && <button className={btnSecondary} disabled={busy} onClick={() => openAction('reopen')}><RotateCcw className="w-4 h-4" /> Buka Ulang</button>}
          {canBranchDone && <button className={btnPrimary} disabled={busy} onClick={() => openAction('branch-done')}><CheckCircle2 className="w-4 h-4" /> Selesai Ditangani Cabang</button>}
        </div>

        {action && (
          <div className="p-4 rounded-xl border border-masri-primary/40 bg-masri-light/50 dark:bg-emerald-900/10 space-y-3">
            {action === 'escalate' && (
              <div>
                <label className={labelCls}>Cabang tujuan</label>
                <select className={inputCls} value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}>
                  <option value="">— pilih cabang —</option>
                  {branches.filter((b) => b.type === 'branch').map((b) => <option key={b.id} value={b.id}>{b.name} ({b.city})</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">Admin Cabang menerima tugas; Manager Cabang & Business Manager otomatis menerima tembusan.</p>
              </div>
            )}
            <div>
              <label className={labelCls}>{{
                escalate: 'Instruksi untuk Admin Cabang', resolve: 'Catatan penyelesaian (dikonfirmasi ke nasabah)',
                'branch-done': 'Tindakan yang sudah dilakukan cabang', reopen: 'Alasan dibuka ulang',
              }[action]}</label>
              <textarea className={`${inputCls} h-24`} value={actionText} onChange={(e) => setActionText(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setAction(null)}>Batal</button>
              <button className={btnPrimary} disabled={busy || (action === 'escalate' && !targetBranch)} onClick={() => {
                if (action === 'escalate') run('escalate', { branchId: targetBranch, note: actionText });
                if (action === 'resolve') run('resolve', { resolution: actionText });
                if (action === 'branch-done') run('branch-done', { resolution: actionText });
                if (action === 'reopen') run('reopen', { reason: actionText });
              }}>{busy ? 'Memproses...' : 'Kirim'}</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Kiri: masalah, penyelesaian, timeline */}
          <div className="lg:col-span-2 space-y-4">
            <section className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Uraian Masalah</h4>
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{t.description}</p>
            </section>
            {t.escalationNote && (
              <section className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <h4 className="text-xs font-bold uppercase text-amber-700 dark:text-amber-300 mb-1">Instruksi Eskalasi · {formatDateTime(t.escalatedAt)}</h4>
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{t.escalationNote}</p>
              </section>
            )}
            {t.resolution && (
              <section className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <h4 className="text-xs font-bold uppercase text-green-700 dark:text-green-300 mb-1">
                  Penyelesaian {t.resolvedAt ? `· ${formatDateTime(t.resolvedAt)}` : t.branchResolvedAt ? `(cabang) · ${formatDateTime(t.branchResolvedAt)}` : ''}
                </h4>
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{t.resolution}</p>
              </section>
            )}

            <section>
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-3 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Riwayat Penanganan</h4>
              <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-4">
                {data.events.map((e) => (
                  <li key={e.id} className="ml-4">
                    <span className={`absolute -left-[7px] w-3 h-3 rounded-full ${EVENT_DOT[e.type]} ring-4 ring-white dark:ring-slate-800`} />
                    <p className="text-sm text-slate-700 dark:text-slate-200">
                      <strong>{e.actorName ?? 'Sistem'}</strong>
                      <span className="text-slate-400"> ({ROLE_SHORT[e.actorRole ?? ''] ?? e.actorRole})</span> {EVENT_LABEL[e.type]}
                    </p>
                    {e.message && e.type !== 'created' && <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">{e.message}</p>}
                    <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(e.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </section>

            {t.status !== 'closed' && (
              <div className="flex gap-2">
                <textarea className={`${inputCls} h-16`} placeholder="Tulis komentar / perkembangan penanganan..." value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className={`${btnPrimary} self-end`} disabled={busy || comment.trim().length < 2} onClick={sendComment}><Send className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Kanan: nasabah, cabang, SLA, tembusan */}
          <aside className="space-y-4">
            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Nasabah</h4>
              {t.customer ? (
                <div className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <p className="font-semibold flex items-center gap-2"><User className="w-4 h-4 text-slate-400" />{t.customer.fullName}</p>
                  <p className="text-xs font-mono text-slate-500 ml-6">{t.customer.customerNo}</p>
                  {t.customer.phone && <p className="flex items-center gap-2"><Phone className="w-4 h-4 text-slate-400" />{t.customer.phone}</p>}
                  {t.customer.email && <p className="flex items-center gap-2"><Mail className="w-4 h-4 text-slate-400" />{t.customer.email}</p>}
                  <p className="flex items-start gap-2"><MapPin className="w-4 h-4 text-slate-400 mt-0.5" />{t.customer.address || t.customer.city}</p>
                </div>
              ) : <p className="text-sm text-slate-400">Tidak terkait nasabah</p>}
            </section>

            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Cabang</h4>
              {t.branch ? (
                <div className="text-sm text-slate-700 dark:text-slate-200 space-y-1">
                  <p className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-400" />{t.branch.name}</p>
                  <p className="text-xs text-slate-500 ml-6">{t.branch.city}{t.branch.phone ? ` · ${t.branch.phone}` : ''}</p>
                </div>
              ) : <p className="text-sm text-slate-400">Belum ditentukan</p>}
            </section>

            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Target SLA</h4>
              <p className={`text-sm font-semibold flex items-center gap-2 ${sla.overdue ? 'text-red-600' : 'text-slate-700 dark:text-slate-200'}`}>
                <Clock className="w-4 h-4" />{formatDateTime(t.dueAt)}
              </p>
              {!done && <p className={`text-xs ml-6 ${sla.overdue ? 'text-red-600' : 'text-slate-500'}`}>{sla.text}</p>}
            </section>

            {data.watchers.length > 0 && (
              <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Penanggung Jawab & Tembusan</h4>
                <ul className="space-y-1.5 text-sm">
                  {data.watchers.map((w) => (
                    <li key={w.userId}>
                      <p className="text-slate-700 dark:text-slate-200">{w.fullName}</p>
                      <p className="text-[11px] text-slate-500">{WATCHER_REASON[w.reason] ?? w.reason}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.customerHistory.length > 0 && (
              <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Tiket Lain Nasabah Ini</h4>
                <ul className="space-y-2 text-sm">
                  {data.customerHistory.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2">
                      <span className="text-slate-600 dark:text-slate-300 truncate" title={h.subject}><span className="font-mono text-[11px] text-slate-400">{h.ticketNo.slice(-5)}</span> {h.subject}</span>
                      <HdStatusBadge status={h.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
};
