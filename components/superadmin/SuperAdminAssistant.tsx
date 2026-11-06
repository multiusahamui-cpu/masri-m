import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { Card, PageHeader, ErrorBox, Spinner, btnSecondary } from './ui';

interface UsageRow { day: string; model: string; requests: number; toolCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; errors: number; ticketsCreated: number }
interface Usage { configured: boolean; model: string; rows: UsageRow[] }

/** Status & pemakaian Asisten Virtual (Claude) untuk kontrol biaya. */
export const SuperAdminAssistant: React.FC<{ onNavigate: (menu: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api.get<Usage>('/admin/assistant/usage?days=30')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal memuat data'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sum = (k: keyof UsageRow) => (data?.rows ?? []).reduce((s, r) => s + Number(r[k]), 0);
  const tiles = [
    { label: 'Percakapan (30 hari)', value: sum('requests') },
    { label: 'Pemanggilan data (tool)', value: sum('toolCalls') },
    { label: 'Token input', value: sum('inputTokens') },
    { label: 'Token output', value: sum('outputTokens') },
    { label: 'Tiket dibuat asisten', value: sum('ticketsCreated') },
    { label: 'Gagal', value: sum('errors') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader icon={<Bot />} title="Asisten Virtual" subtitle="Asisten chat website berbasis Claude (Anthropic), dipanggil dari server — API key tidak pernah sampai ke browser."
        actions={<button className={btnSecondary} onClick={load}><RefreshCw className="w-4 h-4" />Muat ulang</button>} />
      {error && <ErrorBox message={error} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Card className="p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex items-start gap-3">
              {data.configured ? <CheckCircle className="w-6 h-6 text-green-600 mt-0.5" /> : <AlertTriangle className="w-6 h-6 text-amber-500 mt-0.5" />}
              <div className="text-sm">
                <p className="font-semibold text-slate-800 dark:text-white">{data.configured ? 'API key terpasang' : 'API key belum diatur'}</p>
                <p className="text-slate-500 dark:text-slate-400">
                  Model: <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">{data.model}</code>
                  {!data.configured && <> — isi <code className="text-xs">ANTHROPIC_API_KEY</code> di <code className="text-xs">server/.env</code> lalu restart server.</>}
                </p>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Ganti model lewat <code className="text-xs">ASSISTANT_MODEL</code> di server/.env (mis. model Sonnet untuk jawaban lebih kaya, Haiku untuk biaya rendah).</p>
              </div>
            </div>
            <button className={btnSecondary} onClick={() => onNavigate('business-config')}>Atur aktif/nonaktif & batas pemakaian</button>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {tiles.map((t) => (
              <Card key={t.label} className="p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t.label}</p>
                <p className="text-2xl font-bold text-slate-800 dark:text-white mt-1 tabular-nums">{formatNumber(t.value)}</p>
              </Card>
            ))}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>{['Tanggal', 'Model', 'Percakapan', 'Tool', 'Token input', 'Token output', 'Cache dibaca', 'Tiket', 'Gagal'].map((h, i) => <th key={h} className={`px-4 py-3 ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Belum ada pemakaian.</td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.day + r.model} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-2.5">{r.day}</td>
                    <td className="px-4 py-2.5 text-xs">{r.model}</td>
                    {[r.requests, r.toolCalls, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.ticketsCreated, r.errors].map((v, i) => <td key={i} className="px-4 py-2.5 text-right tabular-nums">{formatNumber(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
};
