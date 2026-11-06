import React, { useState } from 'react';
import { ROLES_DATA } from '../constants';
import { AuthUser, RoleType } from '../types';
import { StaffLogin } from './StaffLogin';
import { REAL_AUTH_ROLES } from '../constants';
import { Briefcase, Database, Truck, Store, Headset, Shield, ShieldCheck, Calculator, BarChart, User, Sun, Moon, Lock, Building2, Inbox, Megaphone } from 'lucide-react';

interface RoleLoginProps {
  onSelectRole: (role: RoleType) => void;
  onAuthenticated: (user: AuthUser) => void;
  onBack: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

const getIcon = (id: string) => {
    switch(id) {
        case 'super-admin': return <ShieldCheck className="w-8 h-8" />;
        case 'branch-manager': return <Building2 className="w-8 h-8" />;
        case 'branch-admin': return <Inbox className="w-8 h-8" />;
        case 'ao': return <Briefcase className="w-8 h-8" />;
        case 'warehouse': return <Database className="w-8 h-8" />;
        case 'delivery': return <Truck className="w-8 h-8" />;
        case 'cashier': return <Store className="w-8 h-8" />;
        case 'support': return <Headset className="w-8 h-8" />;
        case 'admin': return <Shield className="w-8 h-8" />;
        case 'finance': return <Calculator className="w-8 h-8" />;
        case 'marketing': return <Megaphone className="w-8 h-8" />;
        default: return <User className="w-8 h-8" />;
    }
};

export const RoleLogin: React.FC<RoleLoginProps> = ({ onSelectRole, onAuthenticated, onBack, isDarkMode, toggleTheme }) => {
  const [loginRole, setLoginRole] = useState<RoleType | null>(null);
  const loginTitle = ROLES_DATA.find((r) => r.id === loginRole)?.title ?? '';

  const handleSelect = (role: RoleType) => {
    // Semua role staf wajib login dengan akun terdaftar (tidak ada lagi mode simulasi).
    if (REAL_AUTH_ROLES.includes(role)) setLoginRole(role);
  };

  return (
    <div className="min-h-screen pt-24 pb-20 px-4 bg-slate-900 dark:bg-slate-950 transition-colors duration-300">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-white">Login Portal Staf</h2>
            
            <div className="flex items-center gap-4">
                <button 
                    onClick={toggleTheme}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-yellow-300 transition-colors"
                >
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
                    &larr; Kembali ke Website Utama
                </button>
            </div>
        </div>
        
        <p className="text-slate-400 mb-12 max-w-3xl">
            Khusus karyawan Masri-M. Pilih peran Anda <Lock className="inline w-4 h-4 text-masri-gold" /> lalu masuk dengan akun yang dibuat Super Admin.
            Nasabah tidak masuk lewat halaman ini — gunakan tombol <strong className="text-slate-200">Masuk</strong> (Akun Saya) di website.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {ROLES_DATA.map((role) => (
            <div 
                key={role.id} 
                onClick={() => handleSelect(role.id as RoleType)}
                className={`relative ${REAL_AUTH_ROLES.includes(role.id) ? 'ring-1 ring-masri-gold/60' : ''} bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-masri-primary/20 hover:border-masri-primary hover:scale-105 transition-all cursor-pointer group flex flex-col items-center text-center`}
            >
               {REAL_AUTH_ROLES.includes(role.id) && (
                   <span className="absolute top-3 right-3 text-masri-gold" title="Memerlukan login"><Lock className="w-4 h-4" /></span>
               )}
               <div className="p-4 bg-masri-dark rounded-full text-masri-accent mb-4 group-hover:bg-masri-primary group-hover:text-white transition-colors">
                   {getIcon(role.id)}
               </div>
               <h3 className="font-bold text-white text-lg mb-2">{role.title}</h3>
               <p className="text-sm text-gray-400 mb-4 h-10 line-clamp-2">
                   {role.description}
               </p>
               <div className="w-full pt-4 border-t border-white/5">
                   <div className="flex justify-between text-xs">
                       <span className="text-slate-500">Access:</span>
                       <span className="text-masri-light">{role.access[0]}</span>
                   </div>
               </div>
            </div>
          ))}
        </div>
      </div>

      {loginRole && (
        <StaffLogin
          role={loginRole}
          roleTitle={loginTitle}
          onClose={() => setLoginRole(null)}
          onSuccess={(user) => { setLoginRole(null); onAuthenticated(user); }}
        />
      )}
    </div>
  );
};