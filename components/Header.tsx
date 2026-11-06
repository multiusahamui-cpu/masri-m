import React, { useState } from 'react';
import { Menu, X, UserCircle, Sun, Moon, ShoppingCart, PackageSearch, User } from 'lucide-react';
import { useCustomer } from '../lib/customer';
import { useLocale } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useCart } from '../lib/cart';
import { NAV_LINKS } from '../constants';
import { PageView } from '../types';

interface HeaderProps {
  currentView: PageView;
  onNavigate: (view: PageView, sectionId?: string) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onNavigate, isDarkMode, toggleTheme }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const cartCount = useCart().reduce((n, l) => n + l.qty, 0);
  const customer = useCustomer();
  const { t } = useLocale();
  const accountLabel = customer ? t('nav.account') : t('nav.signin');

  const handleNavClick = (href: string) => {
    setIsMenuOpen(false);
    onNavigate('home', href.replace('#', ''));
  };

  return (
    <header className="fixed w-full top-0 z-40 bg-masri-primary dark:bg-masri-dark backdrop-blur-md border-b border-masri-dark shadow-lg text-white transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20"> 
          {/* Logo Section */}
          <button onClick={() => handleNavClick('#home')} className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="bg-white p-0 rounded-lg shadow-md flex items-center justify-center h-[48px] w-[38px] border-2 border-white/20 overflow-hidden">
                <img 
                    src="https://res.cloudinary.com/dkwjwf0x3/image/upload/v1768455178/Masri_M_Syariah_logo_hdk6aw.png" 
                    alt="Masri-M Logo" 
                    className="w-full h-full object-contain" 
                />
            </div>
            
            <div className="hidden sm:flex flex-col items-start leading-none gap-0.5 whitespace-nowrap shrink-0">
                <span className="text-2xl font-extrabold tracking-tight drop-shadow-sm text-white">MASRI-M</span>
                <span className="text-xs text-masri-light font-bold tracking-[0.25em] bg-black/20 px-1 rounded">SYARIAH</span>
            </div>
          </button>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-4 xl:gap-6 whitespace-nowrap ml-6">
            {NAV_LINKS.map((link) => (
              <button 
                key={link.key} 
                onClick={() => handleNavClick(link.href)}
                className="hidden lg:inline text-sm font-bold text-masri-light hover:text-white hover:underline underline-offset-4 transition-all whitespace-nowrap"
              >
                {t(link.key)}
              </button>
            ))}
            <div className="h-8 w-px bg-masri-light/20"></div>
            
            <div className="flex items-center gap-3">
                <LocaleSwitcher />
                <button onClick={() => onNavigate('order-track')} className="p-2 rounded-full bg-black/20 hover:bg-black/30 border border-white/10" aria-label={t('nav.track')} title={t('nav.track')}>
                    <PackageSearch className="w-5 h-5" />
                </button>
                <button onClick={() => onNavigate('checkout')} className="relative p-2 rounded-full bg-black/20 hover:bg-black/30 border border-white/10" aria-label={t('nav.cart')} title={t('nav.cart')}>
                    <ShoppingCart className="w-5 h-5" />
                    {cartCount > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-masri-gold text-white text-[10px] font-bold rounded-full flex items-center justify-center">{cartCount}</span>}
                </button>
                <button onClick={() => onNavigate('account')} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold" title="Akun nasabah">
                    <User className="w-4 h-4" /><span className="whitespace-nowrap">{accountLabel}</span>
                </button>
                {/* Theme Toggle */}
                <button 
                    onClick={toggleTheme}
                    className="p-2 rounded-full bg-black/20 hover:bg-black/30 text-yellow-300 hover:text-yellow-200 transition-colors border border-white/10"
                    aria-label="Toggle Dark Mode"
                >
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>

                <button 
                  onClick={() => onNavigate('internal-portal')}
                  title={t('nav.staff')} className="flex items-center gap-2 px-4 py-2.5 whitespace-nowrap bg-masri-dark dark:bg-black/40 text-white text-sm font-bold rounded-xl hover:bg-black/30 transition-all border border-white/20 shadow-lg"
                >
                  <UserCircle className="w-5 h-5" />
                  <span className="hidden xl:inline">{t('nav.staff')}</span>
                </button>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center gap-3">
             <LocaleSwitcher compact />
             <button 
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-black/20 text-yellow-300 border border-white/10"
            >
                {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-white hover:bg-white/10 p-2 rounded-lg">
              {isMenuOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isMenuOpen && (
        <div className="md:hidden bg-masri-primary dark:bg-masri-dark border-t border-white/10 absolute w-full shadow-2xl animate-in slide-in-from-top-5">
          <div className="px-4 pt-2 pb-6 space-y-1">
            {NAV_LINKS.map((link) => (
              <button
                key={link.key}
                onClick={() => handleNavClick(link.href)}
                className="block w-full text-left px-4 py-4 text-base font-bold text-white hover:bg-white/10 rounded-xl"
              >
                {t(link.key)}
              </button>
            ))}
            <div className="pt-4 border-t border-white/10 mt-2 space-y-2">
              <button onClick={() => { setIsMenuOpen(false); onNavigate('account'); }} className="w-full flex items-center justify-center gap-2 px-5 py-4 bg-white/10 text-white font-bold rounded-xl">
                <User className="w-5 h-5" />{accountLabel}
              </button>
              <button 
                onClick={() => { setIsMenuOpen(false); onNavigate('internal-portal'); }}
                className="w-full flex items-center justify-center gap-2 px-5 py-4 bg-masri-dark text-white font-bold rounded-xl shadow-inner"
              >
                <UserCircle className="w-5 h-5" />
                {t('nav.staff')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};