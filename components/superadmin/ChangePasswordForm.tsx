import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { ErrorBox, inputCls, labelCls, btnPrimary } from './ui';

const rules = [
  { test: (p: string) => p.length >= 10, label: 'Minimal 10 karakter' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'Huruf besar' },
  { test: (p: string) => /[a-z]/.test(p), label: 'Huruf kecil' },
  { test: (p: string) => /[0-9]/.test(p), label: 'Angka' },
];

export const ChangePasswordForm: React.FC<{ onDone?: () => void; submitLabel?: string }> = ({ onDone, submitLabel = 'Ganti Password' }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = rules.every((r) => r.test(next)) && next === confirm && current.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      onDone?.();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      {done && !onDone && <p className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Password berhasil diganti.</p>}
      <div>
        <label className={labelCls}>Password saat ini</label>
        <input type="password" autoComplete="current-password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Password baru</label>
        <input type="password" autoComplete="new-password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
        <div className="flex flex-wrap gap-2 mt-2">
          {rules.map((r) => (
            <span key={r.label} className={`text-[11px] px-2 py-0.5 rounded-full ${r.test(next) ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>{r.label}</span>
          ))}
        </div>
      </div>
      <div>
        <label className={labelCls}>Ulangi password baru</label>
        <input type="password" autoComplete="new-password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm && confirm !== next && <p className="text-xs text-red-500 mt-1">Password tidak sama</p>}
      </div>
      <button type="submit" className={`${btnPrimary} w-full justify-center py-3`} disabled={!valid || saving}>{saving ? 'Menyimpan...' : submitLabel}</button>
    </form>
  );
};
