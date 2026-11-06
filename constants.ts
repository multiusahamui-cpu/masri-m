import React from 'react';
import { RoleDefinition, MenuItem, RoleType, JobPosting } from './types';
import { 
  Home, ShoppingBag, ShoppingCart, Package, CreditCard, Wallet, User, 
  LayoutDashboard, FileText, FileCheck, MapPin, ThumbsUp, Users, Shield, 
  Settings, BarChart2, CheckSquare, PieChart, TrendingUp, Box, ArrowDownCircle, 
  PackageCheck, Truck, ClipboardList, List, Map, Activity, CheckCircle, 
  PenTool, Calendar, Scale, Banknote, PlusCircle, MessageSquare, Book, 
  AlertTriangle, BookOpen, FileBarChart, Calculator, Megaphone, Tag, Mail,
  Briefcase, Database, Store, Headset, HelpCircle, ShieldCheck, SlidersHorizontal, KeyRound, Building2, Siren, Inbox, Receipt, UserCog, Boxes, ArrowLeftRight, ClipboardCheck, Layers, Bot, RotateCcw, Vault, HandCoins, BellRing, Landmark, HeartHandshake, ListChecks, Lock, BookText, ShieldAlert, Undo2, Ticket, Image, Star
} from 'lucide-react';

export const NAV_LINKS = [
  { key: 'nav.home', href: '#home' },
  { key: 'nav.catalog', href: '#catalog' },
  { key: 'nav.sharia', href: '#syariah' },
  { key: 'nav.partners', href: '#roles' },
  { key: 'nav.contact', href: '#contact' },
];

export const ROLE_MENUS: Record<RoleType, MenuItem[]> = {
  'super-admin': [
    { id: 'overview', label: 'Ringkasan', icon: React.createElement(LayoutDashboard) },
    { id: 'branches', label: 'Kantor & Cabang', icon: React.createElement(Building2) },
    { id: 'users', label: 'Manajemen User', icon: React.createElement(Users) },
    { id: 'roles', label: 'Role & Akses', icon: React.createElement(Shield) },
    { id: 'business-config', label: 'Parameter Bisnis', icon: React.createElement(SlidersHorizontal) },
    { id: 'assistant', label: 'Asisten Virtual', icon: React.createElement(Bot) },
    { id: 'notify', label: 'Notifikasi Nasabah', icon: React.createElement(BellRing) },
    { id: 'audit', label: 'Audit Log', icon: React.createElement(FileText) },
    { id: 'account', label: 'Keamanan Akun', icon: React.createElement(KeyRound) },
  ],
  // AO cabang: KYC, survei & rekomendasi dikerjakan di dalam detail pengajuan
  ao: [
    { id: 'credit-app', label: 'Pengajuan Saya', icon: React.createElement(FileText) },
    { id: 'credit-new', label: 'Input Pengajuan', icon: React.createElement(PlusCircle) },
    { id: 'collection', label: 'Collection', icon: React.createElement(Wallet) },
  ],
  // Manajemen user, role, parameter bisnis & audit log dipindah ke Super Admin.
  admin: [
    { id: 'products', label: 'Produk', icon: React.createElement(Package) },
    { id: 'categories', label: 'Kategori Produk', icon: React.createElement(Layers) },
    { id: 'stock-overview', label: 'Posisi Stok', icon: React.createElement(Boxes) },
  ],
  'biz-mgr': [
    { id: 'approval', label: 'Approval Kredit', icon: React.createElement(CheckSquare) },
    { id: 'analytics', label: 'Credit Analytics', icon: React.createElement(PieChart) },
    { id: 'problem-status', label: 'Problem Status', icon: React.createElement(Siren) },
    { id: 'revenue', label: 'Pembayaran & Macet', icon: React.createElement(TrendingUp) },
    { id: 'fin-reports', label: 'Laporan Keuangan', icon: React.createElement(Landmark) },
    { id: 'expenses', label: 'Biaya Cabang', icon: React.createElement(Receipt) },
    { id: 'aftersales', label: 'Pembatalan & Retur', icon: React.createElement(RotateCcw) },
    { id: 'iqalah', label: 'Iqalah (Batal Akad)', icon: React.createElement(Undo2) },
    { id: 'quarantine', label: 'Karantina Barang', icon: React.createElement(ShieldAlert) },
    { id: 'payables', label: 'Hutang Pemasok', icon: React.createElement(Truck) },
    { id: 'marketing', label: 'Efektivitas Promosi', icon: React.createElement(Megaphone) },
    { id: 'team', label: 'Team Performance', icon: React.createElement(Users) },
  ],
  // Cabang: Manager Cabang membawahi AO; keputusan kredit tetap di Business Manager Pusat.
  'branch-manager': [
    { id: 'dashboard', label: 'Dashboard Cabang', icon: React.createElement(LayoutDashboard) },
    { id: 'recommendation', label: 'Pengajuan Kredit', icon: React.createElement(ThumbsUp) },
    { id: 'ao-team', label: 'Tim Account Officer', icon: React.createElement(UserCog) },
    { id: 'collection', label: 'Collection', icon: React.createElement(Wallet) },
    { id: 'stock-requests', label: 'Stok & Permintaan', icon: React.createElement(ArrowLeftRight) },
    { id: 'expenses', label: 'Biaya Operasional', icon: React.createElement(Receipt) },
    { id: 'aftersales', label: 'Retur & Refund', icon: React.createElement(RotateCcw) },
    { id: 'iqalah', label: 'Iqalah (Batal Akad)', icon: React.createElement(Undo2) },
    { id: 'quarantine', label: 'Karantina Barang', icon: React.createElement(ShieldAlert) },
    { id: 'shifts', label: 'Kas & Shift Kasir', icon: React.createElement(Vault) },
    { id: 'fin-reports', label: 'Laporan Keuangan', icon: React.createElement(Landmark) },
    { id: 'problem-status', label: 'Problem Status', icon: React.createElement(Siren) },
  ],
  'branch-admin': [
    { id: 'escalations', label: 'Tiket Eskalasi', icon: React.createElement(Inbox) },
    { id: 'stock', label: 'Stok Buffer Cabang', icon: React.createElement(Box) },
    { id: 'shipping', label: 'Pengiriman', icon: React.createElement(Truck) },
    { id: 'orders', label: 'Order Tunai', icon: React.createElement(ShoppingBag) },
    { id: 'handover', label: 'Akad Menunggu Barang', icon: React.createElement(PackageCheck) },
    { id: 'expenses', label: 'Biaya Operasional', icon: React.createElement(Receipt) },
    { id: 'aftersales', label: 'Retur & Refund', icon: React.createElement(RotateCcw) },
    { id: 'iqalah', label: 'Iqalah (Batal Akad)', icon: React.createElement(Undo2) },
    { id: 'quarantine', label: 'Karantina Barang', icon: React.createElement(ShieldAlert) },
    { id: 'shift', label: 'Shift & Kas Kecil', icon: React.createElement(Vault) },
  ],
  warehouse: [
    { id: 'dashboard', label: 'Ringkasan Stok', icon: React.createElement(LayoutDashboard) },
    { id: 'inventory', label: 'Stok per Lokasi', icon: React.createElement(Box) },
    { id: 'receipt', label: 'Penerimaan Barang', icon: React.createElement(ClipboardList) },
    { id: 'transfers', label: 'Transfer ke Cabang', icon: React.createElement(ArrowLeftRight) },
    { id: 'opname', label: 'Stock Opname', icon: React.createElement(ClipboardCheck) },
    { id: 'quarantine', label: 'Karantina Barang', icon: React.createElement(ShieldAlert) },
    { id: 'suppliers', label: 'Pemasok', icon: React.createElement(Building2) },
    { id: 'packing', label: 'Pengiriman dari Pusat', icon: React.createElement(Truck) },
    { id: 'inbound', label: 'Order dari Gudang Pusat', icon: React.createElement(ArrowDownCircle) },
  ],
  delivery: [
    { id: 'active', label: 'Tugas Pengiriman', icon: React.createElement(Truck) },
  ],
  cashier: [
    { id: 'record', label: 'Terima Angsuran', icon: React.createElement(PenTool) },
    { id: 'downpayments', label: 'Terima Uang Muka', icon: React.createElement(Wallet) },
    { id: 'verify', label: 'Order Tunai', icon: React.createElement(CheckCircle) },
    { id: 'installment', label: 'Angsuran Jatuh Tempo', icon: React.createElement(Calendar) },
    { id: 'report', label: 'Laporan Kas Harian', icon: React.createElement(Banknote) },
    { id: 'payouts', label: 'Kas Keluar', icon: React.createElement(HandCoins) },
    { id: 'shift', label: 'Shift & Setoran', icon: React.createElement(Vault) },
  ],
  // Helpdesk satu pintu di Pusat
  support: [
    { id: 'tickets', label: 'Tiket Helpdesk', icon: React.createElement(List) },
    { id: 'problem-status', label: 'Monitoring Eskalasi', icon: React.createElement(AlertTriangle) },
    { id: 'aftersales', label: 'Retur & Refund', icon: React.createElement(RotateCcw) },
  ],
  finance: [
    { id: 'dashboard', label: 'Ringkasan Akuntansi', icon: React.createElement(LayoutDashboard) },
    { id: 'journal', label: 'Jurnal', icon: React.createElement(BookText) },
    { id: 'ledger', label: 'Buku Besar', icon: React.createElement(BookOpen) },
    { id: 'trial', label: 'Neraca Saldo', icon: React.createElement(Scale) },
    { id: 'pl', label: 'Laba Rugi', icon: React.createElement(TrendingUp) },
    { id: 'bs', label: 'Neraca', icon: React.createElement(Landmark) },
    { id: 'charity', label: 'Dana Kebajikan', icon: React.createElement(HeartHandshake) },
    { id: 'recon', label: 'Rekonsiliasi Piutang', icon: React.createElement(ListChecks) },
    { id: 'payables', label: 'Hutang Pemasok', icon: React.createElement(Truck) },
    { id: 'bankrec', label: 'Rekonsiliasi Bank', icon: React.createElement(Landmark) },
    { id: 'claims', label: 'Klaim Pemasok', icon: React.createElement(ShieldAlert) },
    { id: 'coa', label: 'Bagan Akun', icon: React.createElement(FileBarChart) },
    { id: 'periods', label: 'Tutup Periode', icon: React.createElement(Lock) },
  ],
  marketing: [
    { id: 'report', label: 'Efektivitas Promosi', icon: React.createElement(BarChart2) },
    { id: 'promos', label: 'Kode Promo', icon: React.createElement(Ticket) },
    { id: 'banners', label: 'Banner Beranda', icon: React.createElement(Image) },
    { id: 'featured', label: 'Produk Unggulan', icon: React.createElement(Star) },
    { id: 'campaigns', label: 'Kampanye WA & Email', icon: React.createElement(Megaphone) },
  ],
};

export const ROLES_DATA: RoleDefinition[] = [
  { id: 'super-admin', title: 'Super Admin', description: 'Parameter Bisnis & User Internal', access: ['Web Dashboard (Login)'], kpi: 'Governance', icon: React.createElement(ShieldCheck) },
  { id: 'biz-mgr', title: 'Business Manager', description: 'Penetapan Kredit (Pusat)', access: ['Web Dashboard (Login)'], kpi: 'Revenue', icon: React.createElement(BarChart2) },
  { id: 'support', title: 'Helpdesk Pusat', description: 'Pusat Bantuan Satu Pintu', access: ['Web Dashboard (Login)'], kpi: 'Response Time', icon: React.createElement(Headset) },
  { id: 'admin', title: 'System Admin', description: 'Katalog Produk & Harga', access: ['Web Dashboard (Login)'], kpi: 'Uptime', icon: React.createElement(Shield) },
  { id: 'warehouse', title: 'Warehouse Pusat', description: 'Gudang Pusat & Distribusi', access: ['Web Dashboard (Login)'], kpi: 'Order Accuracy', icon: React.createElement(Database) },
  { id: 'marketing', title: 'Marketing', description: 'Promo, Banner & Kampanye', access: ['Web Dashboard (Login)'], kpi: 'Konversi Promo', icon: React.createElement(Megaphone) },
  { id: 'finance', title: 'Bookkeeping', description: 'Akuntansi Syariah & Laporan', access: ['Jurnal & Laporan Keuangan'], kpi: 'Report Accuracy', icon: React.createElement(Calculator) },
  { id: 'branch-manager', title: 'Manager Cabang', description: 'Pimpinan Cabang & AO', access: ['Web Dashboard (Login)'], kpi: 'Kinerja Cabang', icon: React.createElement(Building2) },
  { id: 'branch-admin', title: 'Admin Cabang', description: 'Stok, Kirim & Biaya Cabang', access: ['Web Dashboard (Login)'], kpi: 'SLA Eskalasi', icon: React.createElement(Inbox) },
  { id: 'ao', title: 'Account Officer', description: 'Survey & Verifikasi (Cabang)', access: ['Web Dashboard (Login)'], kpi: 'Approval Rate', icon: React.createElement(Briefcase) },
  { id: 'delivery', title: 'Delivery Team', description: 'Driver Armada Internal', access: ['Web Dashboard (Login)'], kpi: 'On-time Delivery', icon: React.createElement(Truck) },
  { id: 'cashier', title: 'Cashier', description: 'Kasir & Pembayaran', access: ['Web Dashboard (Login)'], kpi: 'Cash Accuracy', icon: React.createElement(Store) },
];

/** Role yang sudah memakai login sungguhan ke backend. Role lain masih mode simulasi. */
export const REAL_AUTH_ROLES: RoleType[] = ['super-admin', 'support', 'biz-mgr', 'branch-manager', 'branch-admin', 'warehouse', 'admin', 'ao', 'delivery', 'cashier', 'finance', 'marketing'];

export const JOB_OPENINGS: JobPosting[] = [
  {
    id: 'JOB-001',
    title: 'Account Officer (AO) - Area Padang',
    department: 'Sales & Operation',
    location: 'Padang, Sumatera Barat',
    type: 'Full-time',
    description: 'Bertanggung jawab melakukan survei kelayakan nasabah dan verifikasi data lapangan.',
    requirements: [
       'Pria/Wanita, Usia maks 30 tahun',
       'Pendidikan min D3 Semua Jurusan',
       'Memiliki kendaraan roda dua & SIM C aktif',
       'Jujur, Disiplin, dan berorientasi pada target',
       'Domisili Kota Padang'
    ],
    competencies: [
       'Komunikasi Interpersonal',
       'Analisa Kelayakan Kredit Dasar',
       'Penggunaan Aplikasi Mobile (Android)'
    ],
    deadline: '2025-06-30',
    isOpen: true
  },
  {
    id: 'JOB-002',
    title: 'Customer Service Representative',
    department: 'Support',
    location: 'Payakumbuh (Head Office)',
    type: 'Contract',
    description: 'Menangani keluhan dan pertanyaan pelanggan melalui channel Digital (WhatsApp, Email, Telepon).',
    requirements: [
       'Wanita, Usia maks 25 tahun',
       'Pendidikan min SMA/SMK',
       'Suara ramah dan intonasi jelas',
       'Mampu mengoperasikan komputer (Ms Office)',
       'Bersedia kerja shifting'
    ],
    competencies: [
       'Problem Solving',
       'Empati Pelanggan',
       'Typing Skill (Cepat)'
    ],
    deadline: '2025-05-15',
    isOpen: true
  }
];
