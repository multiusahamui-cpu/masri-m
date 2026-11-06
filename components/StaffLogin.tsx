import React, { useEffect, useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { AuthUser, RoleType } from '../types';
import { Modal, ErrorBox, inputCls, labelCls, btnPrimary } from './superadmin/ui';
import { ChangePasswordForm } from './superadmin/ChangePasswordForm';

/**
 * Login staf internal (autentikasi nyata ke backend) untuk role tertentu.
 * - Sesi masih berlaku & role cocok -> langsung masuk.
 * - Wajib ganti password -> tampilkan form ganti password.
 */
export const StaffLogin: React.FC<{ role: RoleType; roleTitle: string; onSuccess: (user: AuthUser) => void; onClose: () => void }> = ({ role, roleTitle, onSuccess, onClose }) => {
  const [step, setStep] = useState<'checking' | 'login' | 'change-password'>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proceed = (u: AuthUser, fromSession: boolean) => {
    if (u.roleCode !== role) {
      if (fromSession) { setStep('login'); return; } // sesi milik role lain: minta login ulang
      api.post('/auth/logout').catch(() => undefined);
      setError(`Akun ini terdaftar sebagai role lain, bukan ${roleTitle}.`);
      setStep('login');
      return;
    }
    setUser(u);
    if (u.mustChangePassword) setStep('change-password');
    else onSuccess(u);
  };

  useEffect(() => {
    api.get<{ user: AuthUser }>('/auth/me')
      .then((r) => proceed(r.user, true))
      .catch((e) => {
        if ((e as ApiError).status === 0) setError((e as ApiError).message);
        setStep('login');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ user: AuthUser }>('/auth/login', { email, password });
      setPassword('');
      proceed(r.user, false);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={step === 'change-password' ? 'Ganti Password Wajib' : `Login ${roleTitle}`} onClose={onClose}>
      {step === 'checking' && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-masri-primary" /></div>}

      {step === 'login' && (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-masri-light dark:bg-emerald-900/20 text-masri-dark dark:text-emerald-200 text-sm">
            <ShieldCheck className="w-5 h-5 flex-shrink-0" />
            Area staf internal. Aktivitas login tercatat di Audit Log dan akun terkunci setelah 5 kali gagal.
          </div>
          <ErrorBox message={error} />
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" required autoFocus autoComplete="username" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Password</label>
            <input type="password" required autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className={`${btnPrimary} w-full justify-center py-3`} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Masuk
          </button>
        </form>
      )}

      {step === 'change-password' && user && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Demi keamanan, <strong>{user.email}</strong> wajib mengganti password sementara sebelum melanjutkan.
          </p>
          <ChangePasswordForm submitLabel="Simpan & Masuk" onDone={() => onSuccess({ ...user, mustChangePassword: false })} />
        </div>
      )}
    </Modal>
  );
};
