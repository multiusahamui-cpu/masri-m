import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, Shield, FileText, Users, Lock, ChevronRight, AlertCircle, CheckSquare, Square } from 'lucide-react';

// --- Shared Components ---

const PageHeader = ({ title, subtitle }: { title: string, subtitle: string }) => (
  <div className="bg-masri-dark text-white pt-32 pb-20 px-4 text-center relative overflow-hidden">
     {/* Prominent Logo Display - FIXED: Larger Size & Less Padding */}
     <div className="relative z-10 mb-8 animate-in zoom-in duration-500">
        <div className="bg-white p-4 rounded-3xl shadow-2xl inline-block border-4 border-masri-gold/30">
            <img 
                src="https://res.cloudinary.com/dkwjwf0x3/image/upload/v1768455178/Masri_M_Syariah_logo_hdk6aw.png" 
                alt="Masri-M Logo" 
                className="h-28 md:h-40 w-auto object-contain" // Increased Height
            />
        </div>
        <div className="mt-4">
             <span className="text-3xl font-extrabold tracking-tight block">MASRI-M</span>
             <span className="text-sm font-bold bg-masri-primary px-3 py-1 rounded-full text-white tracking-[0.2em] inline-block mt-2 shadow-lg">SYARIAH</span>
        </div>
     </div>

     <h1 className="text-3xl md:text-5xl font-bold mb-4 relative z-10">{title}</h1>
     <p className="text-blue-100 max-w-2xl mx-auto text-lg md:text-xl relative z-10 leading-relaxed font-light">{subtitle}</p>
     
     {/* Background Pattern */}
     <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>
     <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-masri-primary rounded-full blur-3xl opacity-20 pointer-events-none"></div>
     <div className="absolute top-10 -left-10 w-64 h-64 bg-masri-gold rounded-full blur-3xl opacity-20 pointer-events-none"></div>
  </div>
);

const LegalSection = ({ number, title, children }: { number: string, title: string, children?: React.ReactNode }) => (
    <div className="mb-8 border-b border-slate-100 pb-8 last:border-0">
        <h3 className="flex items-start gap-3 text-xl font-bold text-masri-dark mb-4">
            <span className="bg-masri-primary/10 text-masri-primary w-8 h-8 flex items-center justify-center rounded-lg text-sm flex-shrink-0 mt-0.5">
                {number}
            </span>
            {title}
        </h3>
        <div className="text-slate-600 leading-relaxed space-y-3 pl-11 text-justify">
            {children}
        </div>
    </div>
);

const ConsentFooter = ({ type, onAgree }: { type: 'terms' | 'privacy', onAgree: () => void }) => {
    const [checked, setChecked] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleAgree = () => {
        setSubmitted(true);
        setTimeout(() => {
            onAgree(); // Callback to navigate back or close
        }, 1000);
    };

    if (submitted) {
        return (
            <div className="mt-12 bg-green-50 border border-green-200 rounded-xl p-6 text-center animate-in fade-in">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <h4 className="font-bold text-green-800 text-lg">Terima Kasih</h4>
                <p className="text-green-700">Persetujuan Anda telah tercatat dalam sistem kami.</p>
            </div>
        );
    }

    return (
        <div className="mt-12 bg-slate-50 border border-slate-200 rounded-xl p-6 md:p-8">
            <h4 className="font-bold text-slate-900 text-lg mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-masri-primary" />
                Pernyataan Persetujuan Pengguna
            </h4>
            <div className="bg-white p-4 rounded-lg border border-slate-200 mb-6 cursor-pointer hover:border-masri-primary transition-colors" onClick={() => setChecked(!checked)}>
                <div className="flex items-start gap-3">
                    <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? 'bg-masri-primary border-masri-primary' : 'border-slate-300'}`}>
                        {checked && <CheckSquare className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <p className="text-sm text-slate-700 select-none">
                        {type === 'terms' 
                            ? "Saya telah membaca, memahami, dan menyetujui seluruh Syarat & Ketentuan yang berlaku di Platform Masri-M Syariah. Saya sadar bahwa pelanggaran atas aturan ini dapat menyebabkan penangguhan akun."
                            : "Saya mengerti bagaimana data pribadi saya dikumpulkan, digunakan, dan dilindungi sesuai Kebijakan Privasi ini. Saya memberikan izin kepada Masri-M untuk memproses data saya untuk keperluan layanan."}
                    </p>
                </div>
            </div>
            <button 
                onClick={handleAgree}
                disabled={!checked}
                className="w-full bg-masri-dark text-white font-bold py-3 rounded-lg hover:bg-masri-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2"
            >
                {type === 'terms' ? 'Setujui Syarat & Ketentuan' : 'Saya Mengerti & Setuju'}
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    );
};

// --- Pages ---

export const AboutPage = ({ onBack }: { onBack: () => void }) => {
    useEffect(() => window.scrollTo(0,0), []);
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <button onClick={onBack} className="fixed top-6 left-4 lg:left-8 z-50 bg-white/80 backdrop-blur p-3 rounded-full shadow-lg text-slate-700 hover:text-masri-primary hover:scale-110 transition-all border border-slate-200 group">
                <ArrowLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
            </button>
            <PageHeader title="Tentang Kami" subtitle="Membangun Ekonomi Umat dengan Prinsip Syariah yang Murni, Transparan, dan Berkeadilan." />
            
            <div className="max-w-5xl mx-auto px-6 -mt-16 relative z-20">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
                    <div className="p-8 md:p-12 space-y-12">
                        {/* Intro */}
                        <section className="flex flex-col md:flex-row gap-8 items-center">
                            <div className="flex-1 space-y-4">
                                <h2 className="text-3xl font-bold text-masri-dark flex items-center gap-3">
                                    <span className="w-2 h-8 bg-masri-gold rounded-full"></span>
                                    Siapa Kami?
                                </h2>
                                <p className="text-lg text-slate-600 leading-relaxed text-justify">
                                    PT. Masri Mitra Syariah (Masri-M) bukan sekadar toko online. Kami adalah perusahaan teknologi finansial yang lahir dari keresahan masyarakat akan sulitnya memiliki barang kebutuhan (Elektronik & Furniture) tanpa terjerat bunga (Riba).
                                </p>
                                <p className="text-lg text-slate-600 leading-relaxed text-justify">
                                    Menggunakan akad <strong>Murabahah</strong> (Jual Beli), kami hadir sebagai perantara yang adil. Kami membeli barang tunai dari supplier, lalu menjualnya kepada Anda dengan cicilan tetap. Transparan, Halal, dan Menenangkan.
                                </p>
                            </div>
                            <div className="w-full md:w-1/3 flex justify-center">
                                <Users className="w-32 h-32 text-masri-primary/20" />
                            </div>
                        </section>

                        {/* Visi Misi */}
                        <section className="grid md:grid-cols-2 gap-8 bg-slate-50 p-8 rounded-2xl border border-slate-100">
                            <div>
                                <h3 className="font-bold text-xl text-masri-dark mb-4 flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-masri-primary" /> Visi Kami
                                </h3>
                                <p className="text-slate-600">Menjadi ekosistem E-Commerce Syariah terpercaya No. 1 di Indonesia yang menjadi rujukan utama transaksi halal dan berkah.</p>
                            </div>
                            <div>
                                <h3 className="font-bold text-xl text-masri-dark mb-4 flex items-center gap-2">
                                    <CheckCircle className="w-5 h-5 text-masri-primary" /> Misi Kami
                                </h3>
                                <ul className="space-y-3">
                                    <li className="flex gap-3 text-slate-600 items-start text-sm">
                                        <div className="w-1.5 h-1.5 bg-masri-gold rounded-full mt-1.5"></div>
                                        Mengedukasi masyarakat tentang bahaya riba dan solusinya.
                                    </li>
                                    <li className="flex gap-3 text-slate-600 items-start text-sm">
                                        <div className="w-1.5 h-1.5 bg-masri-gold rounded-full mt-1.5"></div>
                                        Menyediakan akses pembiayaan barang yang mudah dan cepat.
                                    </li>
                                    <li className="flex gap-3 text-slate-600 items-start text-sm">
                                        <div className="w-1.5 h-1.5 bg-masri-gold rounded-full mt-1.5"></div>
                                        Membangun teknologi yang amanah dan user-friendly.
                                    </li>
                                </ul>
                            </div>
                        </section>

                        {/* Founder Message */}
                        <section className="border-l-4 border-masri-primary pl-6 py-2 bg-gradient-to-r from-masri-primary/5 to-transparent">
                            <p className="text-xl font-serif italic text-masri-dark mb-2">
                                "Kami percaya bahwa muamalah yang benar akan membawa keberkahan. Teknologi hanyalah alat, ketaatan pada syariat adalah tujuan."
                            </p>
                            <p className="font-bold text-slate-500">— Direksi Masri-M Syariah</p>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    )
}
