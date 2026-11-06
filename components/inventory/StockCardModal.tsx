import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { StockLocation, StockMovement } from '../../types';
import { Modal, ErrorBox, Spinner, formatDateTime } from '../superadmin/ui';
import { MOVEMENT_LABEL } from './labels';

/** Kartu stok: posisi di semua lokasi yang boleh dilihat + riwayat mutasi. */
export const StockCardModal: React.FC<{ productId: string; title: string; onClose: () => void }> = ({ productId, title, onClose }) => {
  const [locs, setLocs] = useState<StockLocation[] | null>(null);
  const [moves, setMoves] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      api.get<{ locations: StockLocation[] }>(`/inventory/stock/${productId}/locations`),
      api.get<{ movements: StockMovement[] }>(`/inventory/movements?productId=${productId}`),
    ]).then(([l, m]) => { setLocs(l.locations); setMoves(m.movements); }).catch((e) => setError((e as ApiError).message));
  }, [productId]);

  return (
    <Modal title={`Kartu Stok · ${title}`} onClose={onClose} wide="xl">
      <ErrorBox message={error} />
      {!locs ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {locs.map((l) => (
              <div key={l.branchId} className={`p-3 rounded-xl border ${l.branchType === 'head_office' ? 'border-masri-gold/60' : 'border-slate-200 dark:border-slate-700'}`}>
                <p className="text-xs text-slate-500">{l.branchName}</p>
                <p className="text-xl font-bold text-slate-800 dark:text-white">{l.onHand - l.reserved}<span className="text-xs font-normal text-slate-500"> tersedia</span></p>
                <p className="text-[11px] text-slate-400">fisik {l.onHand} · dipesan {l.reserved}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-900/50">
                <tr><th className="text-left px-3 py-2">Waktu</th><th className="text-left px-3 py-2">Lokasi</th><th className="text-left px-3 py-2">Mutasi</th>
                  <th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Saldo Fisik</th><th className="text-left px-3 py-2">Dokumen</th><th className="text-left px-3 py-2">Oleh</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {moves.map((m) => {
                  const q = m.qty !== 0 ? m.qty : m.reservedDelta;
                  return (
                    <tr key={m.id}>
                      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{m.branchCode}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{MOVEMENT_LABEL[m.type]}{m.note ? <span className="block text-[11px] text-slate-400">{m.note}</span> : null}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${q > 0 ? 'text-green-600' : 'text-red-600'}`}>{q > 0 ? `+${q}` : q}{m.qty === 0 && <span className="text-[10px] text-slate-400"> (rsv)</span>}</td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{m.onHandAfter}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{m.refNo ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{m.actorName ?? '—'}</td>
                    </tr>
                  );
                })}
                {moves.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-slate-500">Belum ada mutasi.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
};
