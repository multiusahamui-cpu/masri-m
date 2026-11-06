import React from 'react';
import { ShieldCheck, Tag, Clock } from 'lucide-react';
import { useLocale } from '../lib/i18n';

interface HeroProps {
  onExplore: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onExplore }) => {
  const { t } = useLocale();
  return (
    <div id="home" className="relative bg-slate-50 dark:bg-slate-900 overflow-hidden pt-20 scroll-mt-28 transition-colors duration-300">
      <div className="max-w-7xl mx-auto">
        <div className="relative z-10 pb-8 bg-slate-50 dark:bg-slate-900 sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32 transition-colors duration-300">
          <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-28">
            <div className="sm:text-center lg:text-left">
              <span className="inline-flex items-center gap-1 px-3 py-1 mb-4 text-xs font-semibold tracking-wider text-masri-primary uppercase bg-green-100 dark:bg-green-900/30 dark:text-green-400 rounded-full border border-green-200 dark:border-green-800/50">
                <ShieldCheck className="w-3 h-3" />
                {t('hero.badge')}
              </span>
              <h1 className="text-4xl tracking-tight font-extrabold text-slate-900 dark:text-white sm:text-5xl md:text-6xl">
                <span className="block xl:inline">{t('hero.title1')}</span>{' '}
                <span className="block text-masri-primary xl:inline">{t('hero.title2')}</span>
              </h1>
              <p className="mt-3 text-base text-slate-500 dark:text-slate-400 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                {t('hero.lead')}
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-4 sm:justify-center lg:justify-start">
                 <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded shadow-sm text-masri-gold"><Tag className="w-5 h-5"/></div>
                    <span>{t('hero.point1')}</span>
                 </div>
                 <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded shadow-sm text-masri-primary"><Clock className="w-5 h-5"/></div>
                    <span>{t('hero.point2')}</span>
                 </div>
              </div>

              <div className="mt-8 sm:mt-10 sm:flex sm:justify-center lg:justify-start gap-4">
                <div className="rounded-md shadow">
                  <button onClick={onExplore} className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-masri-primary hover:bg-masri-dark md:py-4 md:text-lg md:px-10 transition-colors shadow-lg shadow-green-900/20">
                    {t('hero.cta')}
                  </button>
                </div>
                <div className="mt-3 sm:mt-0 sm:ml-3">
                  <a href="#syariah" className="w-full flex items-center justify-center px-8 py-3 border border-slate-300 dark:border-slate-700 text-base font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 md:py-4 md:text-lg md:px-10 gap-2 transition-colors">
                    {t('hero.learn')}
                  </a>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2 bg-masri-primary/10 dark:bg-masri-primary/5">
        <div className="h-56 w-full sm:h-72 md:h-96 lg:w-full lg:h-full relative">
            <img
                src="https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=80&w=1600"
                alt={t('hero.imgAlt')}
                className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-50 dark:from-slate-900 via-slate-50/20 dark:via-slate-900/20 to-transparent lg:via-slate-50/0"></div>
        </div>
      </div>
    </div>
  );
};
