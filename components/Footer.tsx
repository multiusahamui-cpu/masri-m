import React from 'react';
import { Mail, Phone, MapPin } from 'lucide-react';
import { PageView } from '../types';
import { useLocale } from '../lib/i18n';

interface FooterProps {
  onNavigate?: (view: PageView) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { t } = useLocale();
  const handleNav = (view: PageView) => {
    if (onNavigate) {
      onNavigate(view);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer id="contact" className="bg-slate-900 text-white pt-20 pb-10 border-t-4 border-masri-primary scroll-mt-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-1">
            {/* Updated Layout: Horizontal (flex-row) to place text beside logo */}
            <div className="flex flex-row items-center gap-4 mb-6">
               {/* Footer Logo: Synced with Navbar size (52x42px) */}
               <div className="bg-white p-0.5 rounded-lg shadow-md flex items-center justify-center h-[52px] w-[42px] border-2 border-white/20 shrink-0">
                  <img 
                      src="https://res.cloudinary.com/dkwjwf0x3/image/upload/v1768455178/Masri_M_Syariah_logo_hdk6aw.png" 
                      alt="Masri-M Logo" 
                      className="w-full h-full object-contain"
                  />
               </div>
               <div>
                 <span className="text-2xl font-extrabold tracking-tight block">MASRI-M</span>
                 <span className="text-xs font-bold text-masri-primary tracking-[0.3em] uppercase">{t('footer.tagline')}</span>
               </div>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed border-l-2 border-masri-primary pl-4">
              {t('footer.about.text')}
            </p>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-6 text-white border-b border-white/10 pb-2 inline-block">{t('footer.categories')}</h4>
            <ul className="space-y-3 text-slate-300 text-sm">
              <li><a href="#" className="hover:text-masri-accent hover:pl-2 transition-all">{t('footer.cat1')}</a></li>
              <li><a href="#" className="hover:text-masri-accent hover:pl-2 transition-all">{t('footer.cat2')}</a></li>
              <li><a href="#" className="hover:text-masri-accent hover:pl-2 transition-all">{t('footer.cat3')}</a></li>
              <li><a href="#" className="hover:text-masri-accent hover:pl-2 transition-all">{t('footer.cat4')}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-6 text-white border-b border-white/10 pb-2 inline-block">{t('footer.company')}</h4>
            <ul className="space-y-3 text-slate-300 text-sm">
              <li>
                <button onClick={() => handleNav('about')} className="hover:text-masri-accent hover:pl-2 transition-all text-left">{t('footer.about')}</button>
              </li>
              <li>
                <button onClick={() => handleNav('careers')} className="hover:text-masri-accent hover:pl-2 transition-all text-left">{t('footer.careers')}</button>
              </li>
              <li>
                <button onClick={() => handleNav('terms')} className="hover:text-masri-accent hover:pl-2 transition-all text-left">{t('footer.terms')}</button>
              </li>
              <li>
                <button onClick={() => handleNav('privacy')} className="hover:text-masri-accent hover:pl-2 transition-all text-left">{t('footer.privacy')}</button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-6 text-white border-b border-white/10 pb-2 inline-block">{t('footer.contact')}</h4>
            <ul className="space-y-4 text-slate-300 text-sm">
                <li className="flex items-start gap-4">
                    <div className="bg-white/10 p-2 rounded-lg shrink-0">
                        <MapPin className="w-5 h-5 text-masri-primary" />
                    </div>
                    <span>Jl.Lampung No 9, Ibuh,<br/>Kota Payakumbuh, Sumatera Barat</span>
                </li>
                <li className="flex items-center gap-4">
                    <div className="bg-white/10 p-2 rounded-lg shrink-0">
                        <Mail className="w-5 h-5 text-masri-primary" />
                    </div>
                    <span>support@masri-m-syariah.id</span>
                </li>
                 <li className="flex items-center gap-4">
                    <div className="bg-white/10 p-2 rounded-lg shrink-0">
                        <Phone className="w-5 h-5 text-masri-primary" />
                    </div>
                    <span>( 0752 ) 95000</span>
                </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <p className="text-slate-500 text-sm">&copy; {new Date().getFullYear()} PT. Masri Mitra Syariah. {t('footer.rights')}</p>
          <div className="flex flex-wrap justify-center gap-6 text-xs text-slate-500 font-medium">
             <span className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> {t('footer.badge1')}</span>
             <span className="flex items-center gap-2"><div className="w-2 h-2 bg-yellow-500 rounded-full"></div> {t('footer.badge2')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};