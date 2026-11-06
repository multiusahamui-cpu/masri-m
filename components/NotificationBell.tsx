import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { AppNotification } from '../types';
import { formatDateTime } from './superadmin/ui';

const POLL_MS = 30_000;

/** Lonceng notifikasi (tembusan eskalasi, tiket selesai, komentar). Polling tiap 30 detik. */
export const NotificationBell: React.FC<{ onOpenTicket: (ticketId: string) => void }> = ({ onOpenTicket }) => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<{ notifications: AppNotification[]; unread: number }>('/notifications')
      .then((r) => { setItems(r.notifications); setUnread(r.unread); })
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const click = async (n: AppNotification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    load();
    if (n.ticketId) onOpenTicket(n.ticketId);
  };

  const readAll = async () => { await api.post('/notifications/read-all').catch(() => undefined); load(); };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-600 dark:text-slate-300 relative" aria-label="Notifikasi">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 max-h-[70vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-30">
          <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="font-bold text-sm text-slate-800 dark:text-white">Notifikasi</span>
            {unread > 0 && <button onClick={readAll} className="text-xs text-masri-primary flex items-center gap-1 hover:underline"><CheckCheck className="w-3.5 h-3.5" /> Tandai semua dibaca</button>}
          </div>
          {items.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Belum ada notifikasi.</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => click(n)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${n.readAt ? '' : 'bg-masri-light/60 dark:bg-emerald-900/10'}`}>
                    <p className={`text-sm ${n.readAt ? 'text-slate-600 dark:text-slate-300' : 'font-semibold text-slate-800 dark:text-white'}`}>{n.title}</p>
                    {n.body && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{n.body}</p>}
                    <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
