import React, { useEffect, useState } from 'react';
import { ArrowLeft, Briefcase, MapPin, Calendar, Clock, CheckCircle, Search, FileText, Send, User, Mail, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { JOB_OPENINGS } from '../constants';
import { JobPosting } from '../types';

interface CareersPageProps {
  onBack: () => void;
}

export const CareersPage: React.FC<CareersPageProps> = ({ onBack }) => {
    const [selectedJob, setSelectedJob] = useState<JobPosting | null>(null);
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
    
    // Application Form State
    const [applicantName, setApplicantName] = useState('');
    const [applicantEmail, setApplicantEmail] = useState('');
    const [cvLink, setCvLink] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Filter jobs that are Open and Deadline not passed
    const activeJobs = JOB_OPENINGS.filter(job => {
        const isExpired = new Date(job.deadline) < new Date();
        return job.isOpen && !isExpired;
    });

    const handleApplyClick = (job: JobPosting) => {
        setSelectedJob(job);
        setIsApplyModalOpen(true);
        setSubmitSuccess(false);
    };

    const handleSubmitApplication = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        // Simulate API
        await new Promise(resolve => setTimeout(resolve, 2000));
        setIsSubmitting(false);
        setSubmitSuccess(true);
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Back Button */}
            <button onClick={onBack} className="fixed top-6 left-4 lg:left-8 z-50 bg-white/80 backdrop-blur p-3 rounded-full shadow-lg text-slate-700 hover:text-masri-primary hover:scale-110 transition-all border border-slate-200 group">
                <ArrowLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
            </button>

            {/* Header Section */}
            <div className="bg-masri-dark text-white pt-32 pb-20 px-4 text-center relative overflow-hidden">
                <div className="relative z-10 animate-in zoom-in duration-500">
                    <h1 className="text-3xl md:text-5xl font-bold mb-4">Karir di Masri-M</h1>
                    <p className="text-blue-100 max-w-2xl mx-auto text-lg md:text-xl font-light">
                        Bergabunglah dengan tim yang membangun masa depan E-Commerce Syariah di Indonesia.
                        Jadilah bagian dari solusi, bukan polusi riba.
                    </p>
                </div>
                {/* Background Patterns */}
                <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-masri-primary rounded-full blur-3xl opacity-20 pointer-events-none"></div>
            </div>

            {/* Job Listings */}
            <div className="max-w-6xl mx-auto px-6 -mt-16 relative z-20">
                {activeJobs.length === 0 ? (
                    // Empty State
                    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-16 text-center">
                         <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
                            <Search className="w-10 h-10 text-slate-400" />
                         </div>
                         <h2 className="text-2xl font-bold text-slate-800 mb-2">Belum Ada Posisi Tersedia</h2>
                         <p className="text-slate-500 max-w-md mx-auto">
                             Saat ini kami belum membuka lowongan baru. Silakan cek kembali secara berkala atau ikuti media sosial kami untuk update terbaru.
                         </p>
                    </div>
                ) : (
                    // Job Grid
                    <div className="grid grid-cols-1 gap-6">
                        {activeJobs.map((job) => (
                            <div key={job.id} className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-xl transition-shadow group">
                                <div className="p-6 md:p-8">
                                    <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                                                    {job.department}
                                                </span>
                                                <span className="bg-green-50 text-green-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> {job.type}
                                                </span>
                                            </div>
                                            <h2 className="text-2xl font-bold text-masri-dark group-hover:text-masri-primary transition-colors">
                                                {job.title}
                                            </h2>
                                            <div className="flex items-center gap-4 mt-2 text-slate-500 text-sm">
                                                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {job.location}</span>
                                                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> Deadline: {new Date(job.deadline).toLocaleDateString('id-ID')}</span>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleApplyClick(job)}
                                            className="px-6 py-3 bg-masri-gold text-white font-bold rounded-lg hover:bg-yellow-600 transition-colors shadow-md whitespace-nowrap"
                                        >
                                            Lamar Sekarang
                                        </button>
                                    </div>

                                    <div className="border-t border-slate-100 pt-6 grid md:grid-cols-2 gap-8">
                                        {/* Description & Requirements */}
                                        <div>
                                            <h3 className="font-bold text-lg text-slate-800 mb-3 flex items-center gap-2">
                                                <FileText className="w-5 h-5 text-masri-primary" /> Syarat Umum
                                            </h3>
                                            <ul className="space-y-2">
                                                {job.requirements.map((req, idx) => (
                                                    <li key={idx} className="flex items-start gap-2 text-slate-600 text-sm">
                                                        <span className="w-1.5 h-1.5 bg-masri-primary rounded-full mt-1.5 flex-shrink-0"></span>
                                                        {req}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                        
                                        {/* Competencies */}
                                        <div>
                                            <h3 className="font-bold text-lg text-slate-800 mb-3 flex items-center gap-2">
                                                <Briefcase className="w-5 h-5 text-masri-primary" /> Kompetensi Khusus
                                            </h3>
                                            <div className="flex flex-wrap gap-2">
                                                {job.competencies.map((comp, idx) => (
                                                    <span key={idx} className="bg-slate-50 text-slate-700 px-3 py-1 rounded border border-slate-200 text-sm font-medium">
                                                        {comp}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="mt-6 bg-blue-50 p-4 rounded-lg flex items-start gap-2 text-sm text-blue-800">
                                                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                                <p>{job.description}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Application Modal */}
            {isApplyModalOpen && selectedJob && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
                        <div className="bg-masri-primary p-6 flex justify-between items-center text-white">
                            <div>
                                <h3 className="text-lg font-bold">Lamar Posisi</h3>
                                <p className="text-sm text-green-100 opacity-90">{selectedJob.title}</p>
                            </div>
                            <button onClick={() => setIsApplyModalOpen(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="p-8">
                            {submitSuccess ? (
                                <div className="text-center py-8">
                                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle className="w-10 h-10 text-green-600" />
                                    </div>
                                    <h4 className="text-xl font-bold text-slate-900 mb-2">Lamaran Terkirim!</h4>
                                    <p className="text-slate-600 mb-6">
                                        Terima kasih telah melamar. Tim HRD kami akan mereview CV Anda dan menghubungi jika memenuhi kualifikasi.
                                    </p>
                                    <button 
                                        onClick={() => setIsApplyModalOpen(false)}
                                        className="w-full py-3 bg-masri-dark text-white font-bold rounded-lg hover:bg-masri-primary transition-colors"
                                    >
                                        Tutup
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmitApplication} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label>
                                        <div className="relative">
                                            <User className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                                            <input 
                                                type="text" 
                                                required
                                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-masri-primary outline-none"
                                                placeholder="Nama sesuai KTP"
                                                value={applicantName}
                                                onChange={(e) => setApplicantName(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Email Aktif</label>
                                        <div className="relative">
                                            <Mail className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                                            <input 
                                                type="email" 
                                                required
                                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-masri-primary outline-none"
                                                placeholder="email@anda.com"
                                                value={applicantEmail}
                                                onChange={(e) => setApplicantEmail(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Link CV / Portfolio (Google Drive/LinkedIn)</label>
                                        <div className="relative">
                                            <LinkIcon className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                                            <input 
                                                type="url" 
                                                required
                                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-masri-primary outline-none"
                                                placeholder="https://..."
                                                value={cvLink}
                                                onChange={(e) => setCvLink(e.target.value)}
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400 mt-1">Pastikan link dapat diakses publik (Setting: Anyone with the link).</p>
                                    </div>
                                    
                                    <div className="pt-4">
                                        <button 
                                            type="submit" 
                                            disabled={isSubmitting}
                                            className="w-full bg-masri-gold text-white font-bold py-3 rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
                                        >
                                            {isSubmitting ? 'Mengirim...' : 'Kirim Lamaran'}
                                            {!isSubmitting && <Send className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};