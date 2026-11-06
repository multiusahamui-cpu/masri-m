import React from 'react';
import { Wallet } from 'lucide-react';

export const Partners: React.FC = () => {
  return (
    <section className="py-12 bg-white border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm font-medium text-slate-400 uppercase tracking-widest mb-8">
            Pembayaran Aman & Terintegrasi Dengan E-Wallet Terpercaya
        </p>
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 grayscale hover:grayscale-0 transition-all duration-500 opacity-70 hover:opacity-100">
            {/* Bayarind Mockup */}
            <div className="flex items-center gap-2">
                <div className="bg-blue-600 text-white p-1.5 rounded font-bold text-xl italic">Bayarind</div>
            </div>

            {/* OVO Mockup */}
            <div className="flex items-center gap-2">
                 <div className="w-8 h-8 rounded-lg bg-purple-600"></div>
                 <span className="font-bold text-2xl text-purple-800">OVO</span>
            </div>

            {/* DANA Mockup */}
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-500"></div>
                <span className="font-bold text-2xl text-blue-500">DANA</span>
            </div>
            
             {/* Divider for internal tech */}
             <div className="hidden md:block w-px h-8 bg-slate-200"></div>

             <div className="flex items-center gap-2 text-slate-500">
                <Wallet className="w-5 h-5" />
                <span className="font-medium">Masri-Pay</span>
             </div>
        </div>
      </div>
    </section>
  );
};