import React from 'react';
import { Scale, HeartHandshake, Search, BookOpen } from 'lucide-react';
import { useLocale } from '../lib/i18n';

export const ShariaPrinciples: React.FC = () => {
  const { t } = useLocale();
  return (
    <section id="syariah" className="py-20 bg-white dark:bg-slate-800 relative overflow-hidden scroll-mt-28 transition-colors duration-300">
      {/* Decorative pattern */}
      <div className="absolute top-0 right-0 opacity-5 pointer-events-none">
          <svg width="400" height="400" viewBox="0 0 100 100">
             <path d="M50 0 L100 50 L50 100 L0 50 Z" fill="currentColor" className="text-masri-primary" />
          </svg>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-masri-dark dark:text-white mb-4">{t('sharia.title')}</h2>
          <p className="text-lg text-slate-600 dark:text-slate-300 max-w-3xl mx-auto">
            {t('sharia.lead')}
            <span className="italic block mt-2 text-masri-gold">{t('sharia.quote')}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Card 1 */}
          <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-masri-primary dark:hover:border-masri-accent transition-colors duration-300">
            <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl shadow-sm flex items-center justify-center mb-4 text-masri-primary dark:text-masri-accent">
              <Scale className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('sharia.c1')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('sharia.c1d')}</p>
          </div>

          {/* Card 2 */}
          <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-masri-primary dark:hover:border-masri-accent transition-colors duration-300">
            <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl shadow-sm flex items-center justify-center mb-4 text-masri-primary dark:text-masri-accent">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('sharia.c2')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('sharia.c2d')}</p>
          </div>

           {/* Card 3 */}
           <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-masri-primary dark:hover:border-masri-accent transition-colors duration-300">
            <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl shadow-sm flex items-center justify-center mb-4 text-masri-primary dark:text-masri-accent">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('sharia.c3')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('sharia.c3d')}</p>
          </div>

           {/* Card 4 */}
           <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-masri-primary dark:hover:border-masri-accent transition-colors duration-300">
            <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl shadow-sm flex items-center justify-center mb-4 text-masri-primary dark:text-masri-accent">
              <BookOpen className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('sharia.c4')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('sharia.c4d')}</p>
          </div>
        </div>
      </div>
    </section>
  );
};