import React, { useState } from 'react';
import { AuthUser, RoleType } from '../types';
import { ROLE_MENUS } from '../constants';
import { SuperAdminModule } from './superadmin/SuperAdminModule';
import { HelpdeskWorkspace } from './helpdesk/HelpdeskWorkspace';
import { ProblemStatus } from './helpdesk/ProblemStatus';
import { NotificationBell } from './NotificationBell';
import { WarehouseModule, BranchStockModule } from './inventory/InventoryModules';
import { ProductAdmin } from './products/ProductAdmin';
import { CategoryAdmin } from './products/CategoryAdmin';
import { CreditWorkspace } from './credit/CreditWorkspace';
import { CreditAnalytics, AoTeam } from './credit/CreditAnalytics';
import { ShipmentsWorkspace } from './logistics/Shipments';
import { CashierModule, CollectionList, PortfolioQuality } from './cashier/CashierModule';
import { ExpenseWorkspace } from './finance/Expenses';
import { AccountingModule, ACCOUNTING_MENUS, FinancialReports } from './accounting/Accounting';
import { CashierShiftPage, ShiftVerifyPage } from './finance/Shift';
import { AfterSalesWorkspace, PayoutsWorkspace } from './aftersales/AfterSales';
import { PayablesModule, Suppliers } from './accounting/Payables';
import { BankRecModule } from './accounting/BankRec';
import { QuarantineWorkspace, IqalahWorkspace } from './operations/Operations';
import { MarketingModule } from './marketing/Marketing';
import { PageHeader } from './superadmin/ui';
import { Menu, LogOut, Building2 as SupIcon, Bell, UserCircle, Search, Settings, Sun, Moon } from 'lucide-react';

interface RoleDashboardProps {
  role: RoleType;
  authUser?: AuthUser | null;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

export const RoleDashboard: React.FC<RoleDashboardProps> = ({ role, authUser, onLogout, isDarkMode, toggleTheme }) => {
  const [activeMenu, setActiveMenu] = useState(ROLE_MENUS[role][0].id);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [focusTicketId, setFocusTicketId] = useState<string | null>(null);
  const clearFocus = React.useCallback(() => setFocusTicketId(null), []);

  // Menu tempat tiket dibuka saat notifikasi diklik
  const TICKET_MENU: Partial<Record<RoleType, string>> = {
    support: 'tickets', 'branch-admin': 'escalations', 'biz-mgr': 'problem-status', 'branch-manager': 'problem-status',
  };
  const openTicketFromNotification = (ticketId: string) => {
    const menu = TICKET_MENU[role];
    if (!menu) return;
    setActiveMenu(menu);
    setFocusTicketId(ticketId);
  };

  const menuItems = ROLE_MENUS[role];
  const ROLE_TITLES: Partial<Record<RoleType, string>> = {
    'super-admin': 'Super Admin', 'biz-mgr': 'Business Manager', ao: 'Account Officer',
    'branch-manager': 'Manager Cabang', 'branch-admin': 'Admin Cabang', support: 'Helpdesk Pusat', warehouse: 'Warehouse Pusat',
    admin: 'System Admin', delivery: 'Delivery', cashier: 'Kasir', finance: 'Bookkeeping', marketing: 'Marketing',
  };
  const roleTitle = ROLE_TITLES[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace('-', ' ');

  // Function to render content based on active menu
  const renderContent = () => {
    // Role: Super Admin (terhubung ke backend API)
    if (role === 'super-admin' && authUser) {
        return <SuperAdminModule menu={activeMenu} currentUser={authUser} onNavigate={setActiveMenu} />;
    }

    // Helpdesk satu pintu & Problem Status (terhubung ke backend)
    if (authUser) {
        const focus = { focusTicketId, onFocusHandled: clearFocus };
        if ((role === 'support' && activeMenu === 'tickets') || (role === 'branch-admin' && activeMenu === 'escalations')) {
            return <HelpdeskWorkspace key={role} currentUser={authUser} {...focus} />;
        }
        if (activeMenu === 'problem-status' && ['support', 'biz-mgr', 'branch-manager'].includes(role)) {
            return <ProblemStatus currentUser={authUser} {...focus} />;
        }
        // Pembiayaan Murabahah
        if (role === 'ao' && (activeMenu === 'credit-app' || activeMenu === 'credit-new')) {
            return <CreditWorkspace key={activeMenu} mode="ao" currentUser={authUser} startNew={activeMenu === 'credit-new'} />;
        }
        if (role === 'branch-manager') {
            if (activeMenu === 'dashboard') return <CreditAnalytics currentUser={authUser} />;
            if (activeMenu === 'recommendation') return <CreditWorkspace mode="mc" currentUser={authUser} />;
            if (activeMenu === 'ao-team') return <AoTeam />;
        }
        if (role === 'biz-mgr') {
            if (activeMenu === 'approval') return <CreditWorkspace mode="bm" currentUser={authUser} />;
            if (activeMenu === 'analytics') return <CreditAnalytics currentUser={authUser} />;
            if (activeMenu === 'team') return <AoTeam pickBranch />;
        }
        // Pengiriman, order tunai, pembayaran
        if (role === 'branch-admin') {
            if (activeMenu === 'shipping') return <ShipmentsWorkspace currentUser={authUser} />;
            if (activeMenu === 'orders') return <CashierModule menu="verify" currentUser={authUser} />;
            if (activeMenu === 'handover') return <CreditWorkspace mode="ba" currentUser={authUser} />;
        }
        if (role === 'warehouse') {
            if (activeMenu === 'packing') return <ShipmentsWorkspace currentUser={authUser} title="Pengiriman dari Gudang Pusat" />;
            if (activeMenu === 'inbound') return <CashierModule menu="verify" currentUser={authUser} />;
        }
        if (role === 'delivery' && activeMenu === 'active') return <ShipmentsWorkspace currentUser={authUser} driverMode />;
        if (role === 'cashier' && ['record', 'downpayments', 'verify', 'installment', 'report'].includes(activeMenu)) return <CashierModule key={activeMenu} menu={activeMenu} currentUser={authUser} onGoShift={() => setActiveMenu('shift')} />;
        // Keuangan cabang & purna jual
        if (activeMenu === 'expenses' && ['branch-admin', 'branch-manager', 'biz-mgr'].includes(role)) return <ExpenseWorkspace key={role} currentUser={authUser} />;
        if (activeMenu === 'aftersales' && ['branch-admin', 'branch-manager', 'biz-mgr', 'support'].includes(role)) return <AfterSalesWorkspace key={role} currentUser={authUser} />;
        if (activeMenu === 'shift' && ['cashier', 'branch-admin'].includes(role)) return <CashierShiftPage currentUser={authUser} />;
        if (activeMenu === 'shifts' && role === 'branch-manager') return <ShiftVerifyPage currentUser={authUser} />;
        if (activeMenu === 'payouts' && role === 'cashier') return <PayoutsWorkspace currentUser={authUser} onGoShift={() => setActiveMenu('shift')} />;
        if ((role === 'ao' || role === 'branch-manager') && activeMenu === 'collection') return <CollectionList currentUser={authUser} />;
        if (role === 'biz-mgr' && activeMenu === 'revenue') return <PortfolioQuality />;

        // Kelompok 2: hutang pemasok, rekonsiliasi bank, karantina, iqalah, marketing
        if (role === 'finance' && activeMenu === 'payables') return <PayablesModule />;
        if (role === 'biz-mgr' && activeMenu === 'payables') return <PayablesModule readOnly />;
        if (role === 'finance' && activeMenu === 'bankrec') return <BankRecModule />;
        if ((role === 'finance' && activeMenu === 'claims') || (activeMenu === 'quarantine' && ['warehouse', 'branch-admin', 'branch-manager', 'biz-mgr'].includes(role))) return <QuarantineWorkspace key={role} currentUser={authUser} />;
        if (activeMenu === 'iqalah' && ['branch-manager', 'branch-admin', 'biz-mgr'].includes(role)) return <IqalahWorkspace currentUser={authUser} />;
        if (role === 'warehouse' && activeMenu === 'suppliers') return (
            <div className="space-y-6"><PageHeader icon={<SupIcon className="w-6 h-6" />} title="Pemasok" subtitle="Master pemasok dipilih saat penerimaan barang. Perubahan rekening & tempo bayar oleh Bookkeeping." />
            <Suppliers country={authUser.branch?.countryCode ?? 'ID'} readOnly canCreate /></div>);
        if (role === 'marketing') return <MarketingModule key={activeMenu} menu={activeMenu} currentUser={authUser} />;
        if (role === 'biz-mgr' && activeMenu === 'marketing') return <MarketingModule menu="report" currentUser={authUser} />;

        // Akuntansi syariah
        if (role === 'finance' && (ACCOUNTING_MENUS as readonly string[]).includes(activeMenu)) return <AccountingModule key={activeMenu} menu={activeMenu} currentUser={authUser} onNavigate={setActiveMenu} />;
        if (activeMenu === 'fin-reports' && ['biz-mgr', 'branch-manager'].includes(role)) return <FinancialReports currentUser={authUser} />;

        // Katalog & stok
        if (role === 'admin') {
            if (activeMenu === 'products') return <ProductAdmin />;
            if (activeMenu === 'categories') return <CategoryAdmin />;
            if (activeMenu === 'stock-overview') return <WarehouseModule menu="inventory" currentUser={authUser} onNavigate={setActiveMenu} />;
        }
        if (role === 'warehouse' && ['dashboard', 'inventory', 'receipt', 'transfers', 'opname'].includes(activeMenu)) {
            return <WarehouseModule menu={activeMenu} currentUser={authUser} onNavigate={setActiveMenu} />;
        }
        if ((role === 'branch-admin' && activeMenu === 'stock') || (role === 'branch-manager' && activeMenu === 'stock-requests')) {
            return <BranchStockModule key={role} currentUser={authUser} />;
        }
    }

    // Default Placeholder
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 min-h-[500px] transition-colors">
            <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                        {menuItems.find(m => m.id === activeMenu)?.label}
                    </h2>
                    <button className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-slate-400">
                        <Settings className="w-5 h-5" />
                    </button>
            </div>
            
            {/* Empty State Placeholder */}
            <div className="flex flex-col items-center justify-center h-96 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm mb-4 text-slate-400 dark:text-slate-500">
                    {menuItems.find(m => m.id === activeMenu)?.icon}
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Module Belum Tersedia</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-md">
                    Fitur <strong>{menuItems.find(m => m.id === activeMenu)?.label}</strong> untuk role {roleTitle} sedang dalam tahap pengembangan.
                </p>
            </div>
        </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex transition-colors duration-300">
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 dark:bg-slate-950 text-white transition-all duration-300 flex flex-col fixed h-full z-20 border-r border-slate-800`}
      >
        <div className="h-16 flex items-center justify-center border-b border-slate-800">
             {isSidebarOpen ? (
                 <span className="text-xl font-bold tracking-tight text-masri-accent">MASRI-M</span>
             ) : (
                 <span className="text-xl font-bold text-masri-accent">M</span>
             )}
        </div>

        <nav className="flex-1 py-6 space-y-1 px-3 overflow-y-auto">
            {menuItems.map((item) => (
                <button
                    key={item.id}
                    onClick={() => setActiveMenu(item.id)}
                    className={`w-full flex items-center p-3 rounded-lg transition-colors ${
                        activeMenu === item.id 
                            ? 'bg-masri-primary text-white' 
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                >
                    <div className="flex-shrink-0">{item.icon}</div>
                    {isSidebarOpen && <span className="ml-3 text-sm font-medium">{item.label}</span>}
                </button>
            ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
            <button 
                onClick={onLogout}
                className="w-full flex items-center p-3 rounded-lg text-slate-400 hover:bg-red-900/20 hover:text-red-400 transition-colors"
            >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                {isSidebarOpen && <span className="ml-3 text-sm font-medium">Logout</span>}
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-20'}`}>
        {/* Top Header */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center px-6 sticky top-0 z-10 transition-colors">
            <div className="flex items-center gap-4">
                <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300"
                >
                    <Menu className="w-5 h-5" />
                </button>
                <h1 className="text-lg font-bold text-slate-800 dark:text-white capitalize">{roleTitle} Dashboard</h1>
            </div>

            <div className="flex items-center gap-4">
                {/* Dashboard Toggle */}
                <button 
                    onClick={toggleTheme}
                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-yellow-500 dark:text-yellow-400 transition-colors"
                >
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>

                <div className="relative hidden md:block">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Search..." 
                        className="pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-full text-sm focus:outline-none focus:border-masri-primary w-64 transition-colors"
                    />
                </div>
                {authUser ? (
                    <NotificationBell onOpenTicket={openTicketFromNotification} />
                ) : (
                    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-600 dark:text-slate-300 relative">
                        <Bell className="w-5 h-5" />
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
                    </button>
                )}
                <div className="flex items-center gap-2 pl-4 border-l border-slate-200 dark:border-slate-700">
                    <div className="text-right hidden md:block">
                        <p className="text-sm font-bold text-slate-800 dark:text-white">{authUser?.fullName ?? 'Staff User'}</p>
                        <p className={`text-xs text-slate-500 dark:text-slate-400 ${authUser ? '' : 'uppercase'}`}>{authUser ? `${authUser.branch?.name ?? ''} · ${authUser.email}` : role}</p>
                    </div>
                    <UserCircle className="w-8 h-8 text-slate-400" />
                </div>
            </div>
        </header>

        {/* Dashboard Content */}
        <main className="p-8 flex-1 overflow-y-auto">
            {renderContent()}
        </main>
      </div>
    </div>
  );
};