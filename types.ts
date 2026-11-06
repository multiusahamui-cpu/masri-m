import React from 'react';

export interface TimelineItem {
  year: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  details: string[];
}

export interface Product {
  id: string;
  title: string;
  category: 'Elektronik' | 'Furniture' | 'Gadget';
  priceCash: string;
  priceCredit: string;
  image: string;
  specs: string[];
  marginSyariah: string;
}

export type RoleType = 
  | 'super-admin'
  | 'branch-manager'
  | 'branch-admin'
  | 'ao' 
  | 'admin' 
  | 'biz-mgr' 
  | 'warehouse' 
  | 'delivery' 
  | 'cashier' 
  | 'support' 
  | 'finance'
  | 'marketing';

export interface RoleDefinition {
  id: RoleType;
  title: string;
  icon: React.ReactNode;
  description: string;
  access: string[];
  kpi: string;
}

export interface MenuItem {
  label: string;
  icon: React.ReactNode;
  id: string;
}

export type PageView = 'home' | 'product-detail' | 'credit-application' | 'credit-track' | 'checkout' | 'order-track' | 'account' | 'internal-portal' | 'dashboard' | 'about' | 'terms' | 'privacy' | 'careers';

export enum NavigationSection {
  HOME = 'home',
  CATALOG = 'catalog',
  SYARIAH = 'syariah',
  ROLES = 'roles',
}

export interface CourseDetailData {
  id: string;
  title: string;
  level: string;
  description: string;
  duration: string;
  price: string;
  startDates: string[];
  projectTitle: string;
  projectDesc: string;
  syllabus: {
    title: string;
    week: string;
    lessons: string[];
  }[];
  salaryRange: string;
  careerRoles: string[];
  tools: string[];
  tags?: string[];
}

// Ticketing System Types
export type TicketStatus = 'Open' | 'In Progress' | 'Closed';

export interface TicketMessage {
  id: string;
  senderName: string;
  senderRole: string; // 'Support' or 'User'
  message: string;
  timestamp: string;
  isSupport: boolean;
}

export interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: TicketStatus;
  createdBy: string; // User Name
  createdRole: RoleType;
  createdAt: string; // ISO string for sorting
  lastUpdate: string;
  messages: TicketMessage[];
}

// Career / Job Posting Types
export interface JobPosting {
  id: string;
  title: string; // Posisi / Nama Jabatan
  department: string;
  type: 'Full-time' | 'Contract' | 'Internship';
  location: string;
  description: string;
  requirements: string[]; // Syarat Umum
  competencies: string[]; // Kompetensi Khusus
  deadline: string; // Tanggal Terakhir Mendaftar
  isOpen: boolean; // Status controlled by Admin
}

// Wallet Types
export type TransactionType = 'topup' | 'payment' | 'transfer' | 'refund';

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  date: string;
  status: 'Success' | 'Pending' | 'Failed';
  reference?: string;
}

export interface LinkedAccount {
  id: string;
  provider: 'BCA' | 'Mandiri' | 'BRI' | 'BNI' | 'BSI' | 'OVO' | 'GOPAY' | 'DANA';
  accountNumber: string; // Hidden partially
  accountName: string;
  type: 'Bank' | 'E-Wallet';
  isConnected: boolean;
}

export interface PendingBill {
  id: string;
  title: string;
  amount: number;
  dueDate: string;
  type: 'Down Payment' | 'Installment';
  orderRef: string;
}

// Order Types
export type OrderStatus = 'Menunggu Pembayaran' | 'Verifikasi AO' | 'Menunggu Approval Manager' | 'Dikemas' | 'Dikirim' | 'Selesai' | 'Dibatalkan' | 'Siap Antar' | 'Menunggu Bayar Ekspedisi';

export interface OrderItem {
    productId: string;
    title: string;
    image: string;
    price: number;
    quantity: number;
}

export interface Order {
    id: string;
    date: string;
    items: OrderItem[];
    totalAmount: number;
    paymentMethod: 'Cash' | 'Credit (Murabahah)';
    status: OrderStatus;
    resi?: string;
    // Added for type safety in other components, optional
    deliveryType?: 'Internal' | 'External';
    shippingDetails?: {
        distance: number;
        cost: number;
        address: string;
    };
}
// ---------------------------------------------------------------------------
// Super Admin / Backend API types
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roleCode: RoleType;
  countryCode: string;
  mustChangePassword: boolean;
  branch: { id: string; code: string; name: string; type: BranchType; countryCode?: string } | null;
}

export type BranchType = 'head_office' | 'branch';

export interface Branch {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  countryCode: string;
  city: string;
  address: string;
  postalCode: string | null;
  phone: string | null;
  hasBufferStock: boolean;
  isActive: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export type BranchOption = Pick<Branch, 'id' | 'code' | 'name' | 'type' | 'city' | 'countryCode'>;

export type UserStatus = 'active' | 'inactive' | 'locked';

export interface InternalUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  roleCode: RoleType;
  countryCode: string;
  branchId: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInfo {
  code: RoleType;
  name: string;
  description: string;
  isInternal: boolean;
  scope: 'head_office' | 'branch' | 'any';
  userCount: number;
}

export interface Country {
  code: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  isActive: boolean;
}

export type ConfigValueType = 'number' | 'percent' | 'money' | 'boolean' | 'string' | 'json';

export interface BusinessConfig {
  key: string;
  countryCode: string;
  category: 'credit' | 'tax' | 'shipping' | 'stock' | 'finance' | 'notify' | 'helpdesk' | 'assistant' | 'general';
  label: string;
  description: string;
  valueType: ConfigValueType;
  value: unknown;
  minValue: string | null;
  maxValue: string | null;
  unit: string | null;
  isPublic: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpdesk satu pintu & Problem Status
// ---------------------------------------------------------------------------
export type HdStatus = 'open' | 'in_progress' | 'escalated' | 'branch_done' | 'resolved' | 'closed';
export type HdCategory = 'order' | 'delivery' | 'product' | 'credit' | 'payment' | 'account' | 'other';
export type HdPriority = 'low' | 'normal' | 'high' | 'urgent';
export type HdChannel = 'web' | 'whatsapp' | 'phone' | 'email' | 'walk_in' | 'chat';

export interface HdTicketRow {
  id: string;
  ticketNo: string;
  subject: string;
  category: HdCategory;
  priority: HdPriority;
  status: HdStatus;
  channel: HdChannel;
  orderRef: string | null;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  isOverdue: boolean;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  customerId: string | null;
  customerNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

export interface HdCustomer {
  id: string;
  customerNo: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  city: string;
  address?: string;
  branchId?: string | null;
  branchName?: string | null;
}

export interface HdEvent {
  id: number;
  type: 'created' | 'comment' | 'status_changed' | 'escalated' | 'branch_done' | 'resolved' | 'closed' | 'reopened';
  actorName: string | null;
  actorRole: string | null;
  message: string | null;
  fromStatus: HdStatus | null;
  toStatus: HdStatus | null;
  createdAt: string;
}

export interface HdTicketDetail {
  ticket: {
    id: string; ticketNo: string; subject: string; description: string; category: HdCategory; priority: HdPriority;
    status: HdStatus; channel: HdChannel; orderRef: string | null; dueAt: string; createdAt: string; updatedAt: string;
    escalatedAt: string | null; escalationNote: string | null; branchResolvedAt: string | null; resolution: string | null;
    resolvedAt: string | null; closedAt: string | null; isOverdue: boolean; createdByName: string | null;
    branch: { id: string; code: string; name: string; city: string; phone: string | null } | null;
    customer: HdCustomer | null;
  };
  events: HdEvent[];
  watchers: { userId: string; fullName: string; roleCode: RoleType; reason: string }[];
  customerHistory: { id: string; ticketNo: string; subject: string; status: HdStatus; createdAt: string }[];
}

export interface HdSummary {
  scope: 'all' | 'branch';
  branch: AuthUser['branch'];
  kpi: { pending: number; overdue: number; escalatedOpen: number; resolved30d: number; avgResolveHours30d: number | null; slaMet30d: number };
  byStatus: { status: HdStatus; n: number }[];
  byBranch: { branchId: string | null; branchCode: string | null; branchName: string | null; branchType: BranchType | null; pending: number; escalated: number; branchDone: number; overdue: number; resolved30d: number; total: number }[];
  byCategory: { category: HdCategory; n: number }[];
  aging: { lt1d: number; d1to3: number; d3to7: number; gt7d: number };
}

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  ticketId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Katalog produk & stok multi-lokasi
// ---------------------------------------------------------------------------
export interface ProductCategory {
  id: string;
  code: string;
  name: string;
  group: 'electronics' | 'furniture';
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export type ProductStatus = 'draft' | 'active' | 'inactive';

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  brand: string;
  status: ProductStatus;
  categoryId: string;
  categoryName: string;
  categoryGroup: 'electronics' | 'furniture';
  images: string[];
  warrantyMonths: number;
  isBulky: boolean;
  cashPrice: number | null;
  totalOnHand: number;
  totalAvailable: number;
  updatedAt: string;
}

export interface ProductFull {
  id: string; sku: string; name: string; brand: string; categoryId: string; description: string;
  specs: string[]; images: string[]; weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
  isBulky: boolean; requiresInstallation: boolean; warrantyMonths: number; status: ProductStatus;
}

export interface StockRow {
  productId: string; sku: string; name: string; brand: string; status: ProductStatus; categoryName: string;
  onHand: number; reserved: number; available: number; minStock: number; isLow: boolean;
}

export interface StockLocation {
  branchId: string; branchCode: string; branchName: string; branchType: BranchType;
  onHand: number; reserved: number; minStock: number;
}

export interface StockMovement {
  id: number; type: 'receipt' | 'transfer_out' | 'transfer_in' | 'adjustment' | 'reserve' | 'release' | 'sale_out' | 'return_in';
  qty: number; reservedDelta: number; onHandAfter: number; reservedAfter: number; refType: string | null; refNo: string | null;
  note: string | null; createdAt: string; branchCode: string; branchName: string; actorName: string | null;
}

export type TransferStatus = 'requested' | 'approved' | 'rejected' | 'shipped' | 'received' | 'cancelled';

export interface TransferRow {
  id: string; transferNo: string; status: TransferStatus; fromBranchName: string; toBranchId: string; toBranchName: string;
  toBranchCode: string; requestNote: string | null; requestedByName: string; hasDiscrepancy: boolean; shipmentRef: string | null;
  createdAt: string; updatedAt: string; itemCount: number; units: number;
}

export interface TransferDetail {
  transfer: {
    id: string; transferNo: string; fromBranchId: string; toBranchId: string; status: TransferStatus; requestNote: string | null;
    requestedBy: string; approvedAt: string | null; rejectReason: string | null; shippedAt: string | null; shipmentRef: string | null;
    receivedAt: string | null; receiveNote: string | null; hasDiscrepancy: boolean; createdAt: string;
  };
  items: { productId: string; sku: string; name: string; qtyRequested: number; qtyShipped: number | null; qtyReceived: number | null; fromAvailable: number; toAvailable: number }[];
  names: { fromName: string; toName: string; requestedBy: string; approvedBy: string | null; shippedBy: string | null; receivedBy: string | null };
}

export interface InventorySummary {
  locations: { branchId: string; branchCode: string; branchName: string; branchType: BranchType; skuInStock: number; units: number; reserved: number; lowCount: number }[];
  transfers: { status: TransferStatus; n: number }[];
}

export interface CatalogProduct {
  id: string; sku: string; name: string; brand: string; specs: string[]; images: string[]; warrantyMonths: number;
  categoryName: string; categoryGroup: 'electronics' | 'furniture'; cashPrice: number; inStock: boolean;
  installmentFrom: { tenor: number; monthly: number; downPayment: number } | null;
  featured?: 'featured' | 'promo' | 'new' | 'bestseller' | null;
}

export interface InstallmentOption {
  tenor: number; marginPct: number; downPayment: number; financed: number; marginAmount: number; salePrice: number; monthly: number; totalPayable: number;
}

// ---------------------------------------------------------------------------
// Pembiayaan Murabahah
// ---------------------------------------------------------------------------
export type CreditStatus = 'submitted' | 'assigned' | 'branch_review' | 'hq_review' | 'approved' | 'contracted' | 'active' | 'paid_off' | 'rejected' | 'cancelled';

export interface CreditRow {
  id: string; appNo: string; status: CreditStatus; channel: 'web' | 'branch'; cashPrice: number; currency: string;
  requestedTenor: number; tenor: number | null; monthly: number | null; financed: number | null; requiresCommittee: boolean;
  aoRecommendation: 'approve' | 'reject' | null; createdAt: string; updatedAt: string; customerName: string; customerPhone: string | null;
  productName: string; qty: number; branchId: string; branchName: string; branchCode: string; aoName: string | null;
}

export interface CreditCustomer {
  id: string; customerNo: string; fullName: string; phone: string | null; email: string | null; city: string; address: string;
  nik: string | null; birthDate: string | null; maritalStatus: string | null; dependents: number | null; occupation: string | null;
  employer: string | null; monthlyIncome: number | null; kycStatus: string;
}

export interface CreditSurvey {
  visitedAt: string; addressVerified: boolean; residenceStatus: string; lengthOfStayYears: number; incomeVerified: boolean;
  verifiedIncome: number; otherObligations: number; characterScore: number; photos: string[]; notes: string | null;
}

/** Tagihan uang muka akad yang belum dibayar. */
export interface DpDue {
  amount: number; downPayment: number | null; shippingFee: number | null;
  payment: { paymentNo: string; channel: string; method: string; bank: string | null; vaNumber: string | null; qrString: string | null; qrUrl: string | null; payUrl: string | null; amount: number; expiresAt: string | null } | null;
}

export interface CreditDetail {
  application: {
    id: string; appNo: string; status: CreditStatus; channel: string; qty: number; currency: string; cashPrice: number;
    requestedTenor: number; requestedDpPct: number; purpose: string | null; aoId: string | null; assignedAt: string | null;
    kycChecklist: Record<string, { ok: boolean; note?: string }> | null; kycCompletedAt: string | null;
    aoRecommendation: 'approve' | 'reject' | null; aoSuggestedTenor: number | null; aoSuggestedDpPct: number | null; aoNotes: string | null; aoRecommendedAt: string | null;
    mcNotes: string | null; mcReviewedAt: string | null; requiresCommittee: boolean; decisionNotes: string | null; decidedAt: string | null;
    tenor: number | null; dpPct: number | null; downPayment: number | null; financed: number | null; marginPct: number | null; marginAmount: number | null;
    salePrice: number | null; monthly: number | null; fulfillBranchId: string | null; fulfillBranchName: string | null;
    contractNo: string | null; contractSignedAt: string | null; dpPaidAmount: number | null; dpPaidAt: string | null; dpMethod: string | null; dpRef: string | null; shippingFee: number | null;
    handoverAt: string | null; handoverMethod: string | null; handoverNote: string | null; closedReason: string | null; createdAt: string; branchId: string;
  };
  dpDue: DpDue | null;
  customer: CreditCustomer;
  product: { id: string; sku: string; name: string; brand: string; images: string[] };
  branch: { id: string; code: string; name: string; city: string };
  ao: { id: string; fullName: string; phone: string | null } | null;
  survey: CreditSurvey | null;
  votes: { userId: string; fullName: string; decision: string; notes: string | null; createdAt: string }[];
  events: { id: number; type: string; actorName: string | null; actorRole: string | null; message: string | null; toStatus: CreditStatus | null; createdAt: string }[];
  installments: { id: string; seq: number; dueDate: string; amount: number; paidAmount: number; status: string }[];
  kycItems: string[];
  analysis: { preview: (InstallmentOption & { requiresCommittee: boolean; dpPct: number }) | null; dsr: number | null; maxDsr: number; income: number };
}

export interface CreditSummary {
  byStatus: { status: CreditStatus; n: number; amount: number }[];
  byBranch: { branchId: string; branchCode: string; branchName: string; submitted: number; branchReview: number; hqReview: number; approved: number; active: number; activeFinanced: number; rejected: number }[];
  kpi: { decided30d: number; approved30d: number; avgDaysToDecision: number | null; activeOutstanding: number };
}
