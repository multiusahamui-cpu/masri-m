import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, RefreshCw, Send, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Card, PageHeader, ErrorBox, Spinner, formatDateTime, inputCls, btnPrimary, btnSecondary } from './ui';

interface Msg { id: number; channel: string; recipient: string; template: string; subject: string | null; status: string; attempts: number; lastError: string | null; provider: string | null; createdAt: string; sentAt: string | null }
interface Stats { providers: { whatsapp: string; email: string }; last7d: { status: string; channel: string; n: number }[]; recent: Msg[] }

const STATUS_CLS: Record<string, string> = {
  sent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', skipped: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};
const PROVIDER_NOTE: Record<string, string> = {
  'whatsapp-log': 'hanya dicatat di log server — isi WHATSAPP_PROVIDER=fonnte & FONNTE_TOKEN',
  'email-log': 'hanya dicatat di log server — isi SMTP_URL (lokal: Mailpit smtp://localhost:1025)',
  fonnte: 'Fonnte (WhatsApp)', smtp: 'SMTP',
};

/** Super Admin: status pengiriman notifikasi WhatsApp & email ke nasabah. */
export const SuperAdminNotify: React.FC<{ onNavigate: (menu: string) => void }> = ({ onNavigate }) => {
  const [d, setD] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState({ channel: 'whatsapp', to: '' });
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => { api.get<Stats>('/admin/notifications/outbox').then(setD).catch((e) => setError((e as ApiError).message)); }, []);
  useEffect(load, [load]);
  const sendTest = async () => {
    setError(null); setFlash(null);
    try { const r = await api.post<{ message: Msg }>('/admin/notifications/test', test); setFlash(`Pesan uji: ${r.message.status}${r.message.lastError ? ` — ${r.message.lastError}` : ''} (provider ${r.message.provider})`); load(); }
    catch (e) { setError((e as ApiError).message); }
  };
  const retry = async () => {
    const ids = d?.recent.filter((m) => m.status === 'failed' || m.status === 'skipped').map((m) => m.id) ?? [];
    if (!ids.length) return;
    try { const r = await api.post<{ retried: number }>('/admin/notifications/retry', { ids }); setFlash(`${r.retried} pesan dikirim ulang.`); load(); } catch (e) { setError((e as ApiError).message); }
  };
  const count = (status: string, channel: string) => d?.last7d.find((x) => x.status === status && x.channel === channel)?.n ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader icon={<BellRing />} title="Notifikasi Nasabah" subtitle="WhatsApp & email otomatis: pesanan, pembayaran, pengiriman, kode pengambilan, status pembiayaan, pengingat angsuran."
        actions={<><button className={btnSecondary} onClick={() => onNavigate('business-config')}>Atur aktif / pengingat</button><button className={btnSecondary} onClick={load}><RefreshCw className="w-4 h-4" />Muat ulang</button></>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {flash && <div className="p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-900/20 dark:text-green-200 dark:border-green-800">{flash}</div>}
      {!d ? <Spinner /> : (<>
        <div className="grid md:grid-cols-2 gap-4">
          {(['whatsapp', 'email'] as const).map((ch) => (
            <Card key={ch} className="p-5">
              <p className="font-bold text-slate-800 dark:text-white">{ch === 'whatsapp' ? 'WhatsApp' : 'Email'} · <span className="font-mono text-sm">{d.providers[ch]}</span></p>
              <p className="text-xs text-slate-500 mb-3">{PROVIDER_NOTE[d.providers[ch]] ?? ''}</p>
              <div className="grid grid-cols-4 gap-2 text-center text-sm">
                {['sent', 'pending', 'failed', 'skipped'].map((s) => <div key={s}><p className="text-xl font-bold">{count(s, ch)}</p><p className="text-[11px] text-slate-500">{s}</p></div>)}
              </div>
            </Card>
          ))}
        </div>
        <Card className="p-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-semibold">Kirim pesan uji</span>
          <select className={`${inputCls.replace("w-full", "")} w-36 shrink-0`} value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder={test.channel === 'whatsapp' ? '0812xxxx' : 'nama@contoh.com'} value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} />
          <button className={btnPrimary} onClick={sendTest}><Send className="w-4 h-4" />Kirim</button>
          <button className={btnSecondary} onClick={retry}><RotateCcw className="w-4 h-4" />Kirim ulang yang gagal</button>
        </Card>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-3">Waktu</th><th className="text-left px-4 py-3">Kanal</th><th className="text-left px-4 py-3">Penerima</th><th className="text-left px-4 py-3">Pesan</th><th className="text-left px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.recent.map((m) => (
                <tr key={m.id}><td className="px-4 py-2 text-xs whitespace-nowrap">{formatDateTime(m.createdAt)}</td><td className="px-4 py-2 text-xs">{m.channel}</td><td className="px-4 py-2 text-xs font-mono">{m.recipient}</td>
                  <td className="px-4 py-2 text-xs">{m.subject}<span className="block text-slate-400">{m.template}</span></td>
                  <td className="px-4 py-2 text-xs"><span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_CLS[m.status] ?? ''}`}>{m.status}</span>{m.lastError && <span className="block text-red-600 mt-1">{m.lastError}</span>}</td></tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-slate-500">Belum ada notifikasi.</td></tr>}
            </tbody>
          </table>
        </Card>
      </>)}
    </div>
  );
};
