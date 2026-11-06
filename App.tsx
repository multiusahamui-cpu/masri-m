import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { ShariaPrinciples } from './components/ShariaPrinciples';
import { ProductShowcase } from './components/ProductShowcase';
import { HomeBanners } from './components/HomeBanners';
import { CustomerOnboarding } from './components/PricingFAQ';
import { RolePortals } from './components/RolePortals';
import { Partners } from './components/Partners';
import { Footer } from './components/Footer';
import { VirtualAssistant } from './components/VirtualAssistant';
import { PublicCreditApplication, PublicCreditTrack } from './components/credit/PublicCreditPages';
import { ApplyPrefill } from './components/credit/ApplyForm';
import { CheckoutPage, OrderTrackPage } from './components/shop/ShopPages';
import { CustomerAccount } from './components/account/CustomerAccount';
import { RoleLogin } from './components/RoleLogin';
// Dashboard staf dimuat terpisah agar website nasabah lebih ringan
const RoleDashboard = lazy(() => import('./components/RoleDashboard').then((m) => ({ default: m.RoleDashboard })));
import { AboutPage } from './components/StaticPages';
import { LegalPage } from './components/legal/LegalPages';
import { CareersPage } from './components/CareersPage';
import { AuthUser, PageView, RoleType } from './types';
import { api } from './lib/api';
import { useLocale } from './lib/i18n';

function App() {
  const { t } = useLocale();
  const [view, setView] = useState<PageView>('home');
  const [activeRole, setActiveRole] = useState<RoleType | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [creditPrefill, setCreditPrefill] = useState<ApplyPrefill | undefined>(undefined);
  const [trackAppNo, setTrackAppNo] = useState<string | undefined>(undefined);
  const [trackOrderNo, setTrackOrderNo] = useState<string | undefined>(undefined);
  const [trackPhone, setTrackPhone] = useState<string | undefined>(undefined);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  
  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Tautan dari WhatsApp / email: ?lacak=ORD-... atau ?pengajuan=APP-...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ord = q.get('lacak'), app = q.get('pengajuan');
    if (ord) { setTrackOrderNo(ord); setView('order-track'); }
    else if (app) { setTrackAppNo(app); setView('credit-track'); }
    else if (q.has('akun')) setView('account');
    if (ord || app || q.has('akun')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Initialize Dark Mode from LocalStorage
  useEffect(() => {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.theme = 'light';
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.theme = 'dark';
      setIsDarkMode(true);
    }
  };

  // Handle navigation
  const handleNavigate = (newView: PageView, sectionId?: string) => {
    setView(newView);
    setTrackPhone(undefined);
    
    if (newView === 'home') {
      setActiveRole(null);
      setSelectedProductId(null);
      // Wait for render to complete before scrolling
      setTimeout(() => {
        if (sectionId) {
          const element = document.getElementById(sectionId);
          element?.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);
    }
  };

  const handleRegisterClick = (prefill?: ApplyPrefill) => {
    setCreditPrefill(prefill);
    setView('credit-application');
  };

  const handleRoleSelect = (role: RoleType) => {
    setActiveRole(role);
    setView('dashboard');
  };

  const handleAuthenticated = (user: AuthUser) => {
    setAuthUser(user);
    setActiveRole(user.roleCode);
    setView('dashboard');
  };

  const handleLogout = () => {
    if (authUser) {
      api.post('/auth/logout').catch(() => undefined);
      setAuthUser(null);
    }
    setActiveRole(null);
    setView('home');
  };

  // Routing Logic
  if (view === 'dashboard' && activeRole) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Memuat dashboard…</div>}>
        <RoleDashboard
          role={activeRole}
          authUser={authUser}
          onLogout={handleLogout}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
        />
      </Suspense>
    );
  }

  if (view === 'internal-portal') {
    return (
      <RoleLogin 
        onSelectRole={handleRoleSelect} 
        onAuthenticated={handleAuthenticated}
        onBack={() => handleNavigate('home')} 
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
      />
    );
  }

  if (view === 'about') {
    return <AboutPage onBack={() => handleNavigate('home')} />;
  }

  if (view === 'terms') {
    return <LegalPage kind="terms" onBack={() => handleNavigate('home')} />;
  }

  if (view === 'privacy') {
    return <LegalPage kind="privacy" onBack={() => handleNavigate('home')} />;
  }

  if (view === 'careers') {
    return <CareersPage onBack={() => handleNavigate('home')} />;
  }

  // Public Website Home & Sub-pages
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans selection:bg-masri-primary selection:text-white transition-colors duration-300">
      <Header 
        currentView={view} 
        onNavigate={handleNavigate} 
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
      />
      
      <main>
        {view === 'home' && (
          <div className="animate-in fade-in duration-500 pt-20">
            <Hero onExplore={() => handleNavigate('home', 'catalog')} />
            <HomeBanners />
            <Partners />
            <ShariaPrinciples />
            <ProductShowcase onApply={handleRegisterClick} onCheckout={() => setView('checkout')} />
            <CustomerOnboarding />
            <RolePortals />
            
            {/* Call to Action Section */}
            <section className="bg-masri-primary py-20 relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
              <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
                <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">{t('cta.title')}</h2>
                <p className="text-xl text-green-100 mb-10">
                  {t('cta.lead')}
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                  <button onClick={() => handleRegisterClick()} className="px-8 py-4 bg-masri-gold text-white font-bold rounded-full hover:bg-amber-600 transition-colors shadow-xl text-lg">
                    {t('cta.apply')}
                  </button>
                  <button onClick={() => { setTrackAppNo(undefined); setTrackPhone(undefined); setView('credit-track'); }} className="px-8 py-4 bg-white text-masri-primary font-bold rounded-full hover:bg-gray-100 transition-colors shadow-xl text-lg">
                    {t('cta.track')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {view === 'credit-application' && (
          <PublicCreditApplication
            prefill={creditPrefill}
            onBack={() => handleNavigate('home')}
            onTrack={(no) => { setTrackAppNo(no); setTrackPhone(undefined); setView('credit-track'); }}
          />
        )}
        {view === 'credit-track' && <PublicCreditTrack key={`${trackAppNo}-${trackPhone}`} initialAppNo={trackAppNo} initialPhone={trackPhone} onBack={() => handleNavigate('home')} />}
        {view === 'checkout' && <CheckoutPage onBack={() => handleNavigate('home')} onTrack={(no) => { setTrackOrderNo(no); setTrackPhone(undefined); setView('order-track'); }} />}
        {view === 'account' && <CustomerAccount onBack={() => handleNavigate('home')} onApply={() => handleRegisterClick()} />}
        {view === 'order-track' && <OrderTrackPage key={`${trackOrderNo}-${trackPhone}`} initialOrderNo={trackOrderNo} initialPhone={trackPhone} onBack={() => handleNavigate('home')} />}
      </main>

      <Footer onNavigate={handleNavigate} />
      <VirtualAssistant
        onApply={(p) => handleRegisterClick(p)}
        onCheckout={() => setView('checkout')}
        onTrackOrder={(no, phone) => { setTrackOrderNo(no || undefined); setTrackPhone(phone); setView('order-track'); window.scrollTo({ top: 0 }); }}
        onTrackCredit={(no, phone) => { setTrackAppNo(no || undefined); setTrackPhone(phone); setView('credit-track'); window.scrollTo({ top: 0 }); }}
      />
    </div>
  );
}

export default App;