import React, { useState } from 'react';
import { Smartphone, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { customerSession } from '../../lib/customer';
import { Modal, ErrorBox, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { COUNTRIES, useLocale, type Country } from '../../lib/i18n';
import { ConsentText } from '../legal/LegalPages';

/** Masuk Akun Saya dengan kode OTP WhatsApp (tanpa password). */
export const CustomerLogin: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const L = useLocale();
  const { t } = L;
  const [country, setCountry] = useState<Country>(L.country);
  const ci = COUNTRIES.find((c) => c.code === country)!;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ sentTo: string; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = async () => {
    setBusy(true); setError(null);
    try { setSent(await api.post('/customer/auth/request-otp', { phone, country, lang: L.lang })); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try { await api.post('/customer/auth/verify', { phone, code, country, lang: L.lang }); await customerSession.refresh(); onDone(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('login.title')} onClose={onClose}>
      <div className="space-y-4">
        <ErrorBox message={error} />
        {!sent ? (<>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('login.lead')}</p>
          <div><label className={labelCls}>{t('common.phone')}</label>
            <div className="flex gap-2"><select className={`${inputCls.replace("w-full", "")} w-28 shrink-0`} value={country} onChange={(e) => setCountry(e.target.value as Country)} aria-label={t('locale.country')}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>)}</select>
            <div className="relative flex-1"><Smartphone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus className={`${inputCls} pl-9`} inputMode="tel" placeholder={ci.phoneHint} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && request()} /></div></div></div>
          <button className={`${btnPrimary} w-full justify-center py-3`} disabled={busy || phone.replace(/\D/g, '').length < 7} onClick={request}>{t('login.send')}</button>
          <p className="text-xs text-slate-500 text-center"><ConsentText textKey="legal.consentLogin" /></p>
        </>) : (<>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('login.sent', { to: sent.sentTo })}</p>
          {sent.devCode && <p className="text-xs p-2 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{t('login.dev')} <b className="font-mono">{sent.devCode}</b></p>}
          <div><label className={labelCls}>{t('login.code')}</label>
            <div className="relative"><KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus className={`${inputCls} pl-9 font-mono text-lg tracking-[0.5em]`} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()} /></div></div>
          <button className={`${btnPrimary} w-full justify-center py-3`} disabled={busy || code.length !== 6} onClick={verify}>{t('nav.signin')}</button>
          <div className="flex justify-between text-xs"><button className="underline text-slate-500" onClick={() => { setSent(null); setCode(''); }}>{t('login.change')}</button><button className="underline text-slate-500" disabled={busy} onClick={request}>{t('login.resend')}</button></div>
        </>)}
        <p className="text-[11px] text-slate-400 flex items-start gap-1"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{t('login.warn')}</p>
        <button className={`${btnSecondary} w-full justify-center`} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Modal>
  );
};
