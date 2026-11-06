import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FileText, Lock, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useLocale } from '../../lib/i18n';
import { LegalCompany, LegalDoc, privacyDoc, termsDoc } from '../../lib/legal';

type Kind = 'terms' | 'privacy';
const cache = new Map<string, LegalCompany>();

/** Dokumen hukum sesuai bahasa & negara aktif, dengan identitas badan usaha dari Parameter Bisnis (Super Admin). */
export function useLegalDoc(kind: Kind): LegalDoc {
  const { lang, country } = useLocale();
  const [company, setCompany] = useState<LegalCompany>(cache.get(country) ?? { legalName: '', address: '', privacyEmail: '', supportWhatsapp: '', brand: 'Masri-M Syariah' });
  useEffect(() => {
    if (cache.has(country)) { setCompany(cache.get(country)!); return; }
    api.get<{ config: Record<string, unknown> }>(`/config/public?country=${country}`).then((r) => {
      const s = (k: string) => (typeof r.config[k] === 'string' ? (r.config[k] as string).trim() : '');
      const c = { legalName: s('general.legal_name'), address: s('general.legal_address'), privacyEmail: s('general.privacy_email'), supportWhatsapp: s('general.support_whatsapp'), brand: s('general.company_name') || 'Masri-M Syariah' };
      cache.set(country, c); setCompany(c);
    }).catch(() => {});
  }, [country]);
  return kind === 'terms' ? termsDoc(lang, country, company) : privacyDoc(lang, country, company);
}

function DocBody({ doc }: { doc: LegalDoc }) {
  return (
    <div className="space-y-8">
      {doc.sections.map((s, i) => (
        <section key={i} className="border-b border-slate-100 dark:border-slate-800 pb-6 last:border-0">
          <h3 className="flex items-start gap-3 text-lg font-bold text-masri-dark dark:text-emerald-300 mb-3">
            <span className="bg-masri-primary/10 text-masri-primary w-7 h-7 flex items-center justify-center rounded-lg text-xs flex-shrink-0 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
            {s.title}
          </h3>
          <div className="text-slate-600 dark:text-slate-300 leading-relaxed space-y-3 pl-10 text-sm md:text-base">
            {s.body.map((b, j) => typeof b === 'string'
              ? <p key={j}>{b}</p>
              : <ul key={j} className="list-disc pl-5 space-y-1.5">{b.list.map((li, k) => <li key={k}>{li}</li>)}</ul>)}
          </div>
        </section>
      ))}
    </div>
  );
}

export const LegalPage: React.FC<{ kind: Kind; onBack: () => void }> = ({ kind, onBack }) => {
  const doc = useLegalDoc(kind);
  const { t } = useLocale();
  useEffect(() => window.scrollTo(0, 0), [kind]);
  const Icon = kind === 'terms' ? FileText : Lock;
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">
      <div className="bg-masri-dark text-white pt-24 pb-24 px-4 text-center">
        <Icon className="w-12 h-12 mx-auto mb-4 text-masri-gold" />
        <h1 className="text-3xl md:text-4xl font-bold mb-3">{doc.title}</h1>
        <p className="text-emerald-100 max-w-2xl mx-auto">{doc.subtitle}</p>
      </div>
      <div className="max-w-4xl mx-auto px-4 md:px-6 -mt-14">
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-6 md:p-12">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-5 mb-8">
            <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hover:text-masri-primary"><ArrowLeft className="w-4 h-4" />{t('common.back')}</button>
            <span className="text-xs text-slate-500">{doc.updated}</span>
          </div>
          <DocBody doc={doc} />
        </div>
      </div>
    </div>
  );
};

export const LegalModal: React.FC<{ kind: Kind; onClose: () => void }> = ({ kind, onClose }) => {
  const doc = useLegalDoc(kind);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', f, true); return () => window.removeEventListener('keydown', f, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div><h2 className="font-bold text-slate-900 dark:text-white">{doc.title}</h2><p className="text-xs text-slate-500">{doc.updated}</p></div>
          <button onClick={onClose} aria-label="Tutup" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-6"><DocBody doc={doc} /></div>
      </div>
    </div>,
    document.body,
  );
};

/** Kalimat persetujuan dengan tautan ke S&K dan Kebijakan Privasi (dibuka sebagai jendela). */
export const ConsentText: React.FC<{ textKey: string; className?: string }> = ({ textKey, className }) => {
  const { t } = useLocale();
  const [open, setOpen] = useState<Kind | null>(null);
  const parts = t(textKey).split(/(\{terms\}|\{privacy\})/);
  return (
    <span className={className}>
      {parts.map((p, i) => p === '{terms}' ? <button key={i} type="button" className="underline text-masri-primary" onClick={() => setOpen('terms')}>{t('footer.terms')}</button>
        : p === '{privacy}' ? <button key={i} type="button" className="underline text-masri-primary" onClick={() => setOpen('privacy')}>{t('footer.privacy')}</button>
        : <React.Fragment key={i}>{p}</React.Fragment>)}
      {open && <LegalModal kind={open} onClose={() => setOpen(null)} />}
    </span>
  );
};
