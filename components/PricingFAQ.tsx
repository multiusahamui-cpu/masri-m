import React from 'react';
import { CreditCard, FileText, ShoppingBag, ArrowRight, Building2, UserCheck, Smartphone } from 'lucide-react';
import { useLocale } from '../lib/i18n';

/** Cara kredit di Masri-M (5 langkah) + kanal pembayaran resmi per negara. */
export const CustomerOnboarding: React.FC = () => {
  const { t, country } = useLocale();
  const steps = [
    { id: 1, icon: <ShoppingBag className="w-6 h-6 text-white" /> },
    { id: 2, icon: <FileText className="w-6 h-6 text-white" /> },
    { id: 3, icon: <UserCheck className="w-6 h-6 text-white" /> },
    { id: 4, icon: <CreditCard className="w-6 h-6 text-white" /> },
    { id: 5, icon: <Smartphone className="w-6 h-6 text-white" /> },
  ];
  const channels: Record<string, string[]> = { ID: ['VA BCA', 'VA BNI', 'VA BRI', 'VA Permata', 'QRIS'], MY: ['FPX', 'DuitNow', 'Visa / Mastercard'], BN: ['BIBD', 'Baiduri', 'TAIB'] };

  return (
    <section className="py-20 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-masri-dark dark:text-white mb-4">{t('howto.title')}</h2>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">{t('howto.lead')}</p>
        </div>

        <div className="relative">
          <div className="hidden lg:block absolute top-8 left-0 w-full h-1 bg-slate-200 dark:bg-slate-700 -z-0"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            {steps.map((step, idx) => (
              <div key={step.id} className="relative z-10 flex flex-col items-center text-center group">
                <div className="w-16 h-16 rounded-full bg-masri-primary dark:bg-masri-dark flex items-center justify-center mb-6 shadow-lg border-4 border-slate-50 dark:border-slate-900 group-hover:scale-110 transition-transform duration-300">
                  {step.icon}
                </div>
                <div className="lg:hidden absolute top-0 right-1/3 bg-masri-gold text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-white">{step.id}</div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">{t(`howto.s${step.id}`)}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed px-2">{t(`howto.s${step.id}d`)}</p>
                {idx < steps.length - 1 && (
                  <div className="lg:hidden mt-6 text-slate-300 dark:text-slate-600"><ArrowRight className="w-6 h-6 transform rotate-90" /></div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-20 bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm border border-slate-100 dark:border-slate-700">
          <h4 className="flex items-center gap-2 font-bold text-xl text-masri-dark dark:text-masri-light mb-4">
            <Building2 className="w-6 h-6" />
            {t(`howto.pay.${country}`)}
          </h4>
          <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm">
            {t(`howto.payd.${country}`)}
            <span className="text-red-500 font-bold block mt-1">{t('howto.warning')}</span>
          </p>
          <div className="flex flex-wrap gap-3">
            {channels[country].map((c) => (
              <div key={c} className="bg-slate-100 dark:bg-slate-700 px-4 py-2 rounded-lg font-bold text-slate-600 dark:text-slate-300 text-sm border border-slate-200 dark:border-slate-600">{c}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
