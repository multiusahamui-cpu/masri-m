import React from 'react';
import { ROLES_DATA } from '../constants';
import { User, Truck, Database, Briefcase, Calculator, Headset, Shield, Store, BarChart, Megaphone } from 'lucide-react';

const getIcon = (id: string) => {
    switch(id) {
        case 'ao': return <Briefcase className="w-6 h-6" />;
        case 'warehouse': return <Database className="w-6 h-6" />;
        case 'delivery': return <Truck className="w-6 h-6" />;
        case 'cashier': return <Store className="w-6 h-6" />;
        case 'support': return <Headset className="w-6 h-6" />;
        case 'admin': return <Shield className="w-6 h-6" />;
        case 'finance': return <Calculator className="w-6 h-6" />;
        case 'marketing': return <Megaphone className="w-6 h-6" />;
        default: return <User className="w-6 h-6" />;
    }
};

export const RolePortals: React.FC = () => {
  return (
    <section id="roles" className="py-20 bg-masri-dark text-white scroll-mt-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block px-3 py-1 mb-4 text-xs font-semibold tracking-wider text-masri-gold uppercase bg-white/10 rounded-full">
            Modular Monolithic Architecture
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Solusi Terintegrasi Untuk Setiap Role</h2>
          <p className="text-lg text-gray-300 max-w-3xl mx-auto">
            Satu platform, sepuluh fungsi. Masri-M Syariah menyediakan portal khusus yang disesuaikan dengan kebutuhan setiap pemangku kepentingan dalam ekosistem.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {ROLES_DATA.map((role) => (
            <div key={role.id} className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer group">
               <div className="flex items-center gap-3 mb-3">
                   <div className="p-2 bg-masri-primary rounded-lg text-white group-hover:bg-masri-gold transition-colors">
                       {getIcon(role.id)}
                   </div>
                   <h3 className="font-bold text-sm leading-tight">{role.title}</h3>
               </div>
               <p className="text-xs text-gray-400 mb-4 h-10 line-clamp-2">
                   {role.description}
               </p>
               <div className="pt-3 border-t border-white/5">
                   <p className="text-[10px] text-masri-accent uppercase font-bold tracking-wider mb-1">Akses Portal:</p>
                   <div className="flex flex-wrap gap-1">
                       {role.access.map(a => (
                           <span key={a} className="text-[10px] bg-black/20 px-2 py-0.5 rounded text-gray-300">
                               {a}
                           </span>
                       ))}
                   </div>
               </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};