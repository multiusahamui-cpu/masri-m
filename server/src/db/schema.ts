import {
  pgTable, pgEnum, pgSequence, text, varchar, uuid, boolean, integer, timestamp, jsonb,
  bigserial, primaryKey, index, uniqueIndex, numeric, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Master: negara operasional (persiapan ekspansi Asia)
// ---------------------------------------------------------------------------
export const countries = pgTable('countries', {
  code: varchar('code', { length: 2 }).primaryKey(), // ISO 3166-1 alpha-2
  name: text('name').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(), // ISO 4217
  locale: varchar('locale', { length: 10 }).notNull(), // mis. id-ID, ms-MY
  timezone: text('timezone').notNull(),
  isActive: boolean('is_active').notNull().default(false),
});

// ---------------------------------------------------------------------------
// Kantor: 1 Kantor Pusat (head_office) + banyak Cabang (branch)
// ---------------------------------------------------------------------------
export const branchType = pgEnum('branch_type', ['head_office', 'branch']);

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 16 }).notNull().unique(), // mis. HO, JKT01, BDG01
  name: text('name').notNull(),
  type: branchType('type').notNull().default('branch'),
  countryCode: varchar('country_code', { length: 2 }).notNull().default('ID').references(() => countries.code),
  city: text('city').notNull().default(''),
  address: text('address').notNull().default(''),
  postalCode: varchar('postal_code', { length: 10 }), // dipakai agregator kurir (Biteship)
  phone: varchar('phone', { length: 32 }),
  hasBufferStock: boolean('has_buffer_stock').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Role & User internal
// ---------------------------------------------------------------------------
/** head_office = hanya di Pusat, branch = hanya di Cabang, any = bisa keduanya */
export const roleScope = pgEnum('role_scope', ['head_office', 'branch', 'any']);

export const roles = pgTable('roles', {
  code: varchar('code', { length: 32 }).primaryKey(), // sama dengan RoleType di frontend
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isInternal: boolean('is_internal').notNull().default(true),
  scope: roleScope('scope').notNull().default('any'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const userStatus = pgEnum('user_status', ['active', 'inactive', 'locked']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  fullName: text('full_name').notNull(),
  phone: varchar('phone', { length: 32 }),
  passwordHash: text('password_hash').notNull(),
  roleCode: varchar('role_code', { length: 32 }).notNull().references(() => roles.code),
  countryCode: varchar('country_code', { length: 2 }).notNull().default('ID').references(() => countries.code),
  branchId: uuid('branch_id').references(() => branches.id), // wajib untuk user internal (divalidasi di API)
  status: userStatus('status').notNull().default('active'),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }), // kunci sementara setelah gagal login berulang
  sessionVersion: integer('session_version').notNull().default(0), // naik saat ganti/reset password -> sesi lama tidak berlaku
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('users_role_idx').on(t.roleCode), index('users_status_idx').on(t.status), index('users_branch_idx').on(t.branchId)]);

// ---------------------------------------------------------------------------
// Parameter konfigurasi bisnis (per negara)
// ---------------------------------------------------------------------------
export const configValueType = pgEnum('config_value_type', ['number', 'percent', 'money', 'boolean', 'string', 'json']);

export const businessConfigs = pgTable('business_configs', {
  key: varchar('key', { length: 100 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  category: varchar('category', { length: 32 }).notNull(), // credit | tax | shipping | general
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  valueType: configValueType('value_type').notNull(),
  value: jsonb('value').notNull(),
  minValue: numeric('min_value'),
  maxValue: numeric('max_value'),
  unit: varchar('unit', { length: 16 }),
  isPublic: boolean('is_public').notNull().default(false), // boleh dibaca frontend publik
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.key, t.countryCode] }), index('config_category_idx').on(t.category)]);

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: uuid('actor_id'),
  actorEmail: varchar('actor_email', { length: 255 }),
  action: varchar('action', { length: 64 }).notNull(), // mis. user.create, config.update, auth.login
  entityType: varchar('entity_type', { length: 32 }),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_created_idx').on(t.createdAt), index('audit_action_idx').on(t.action)]);

// ---------------------------------------------------------------------------
// Nasabah (minimal, untuk helpdesk; modul KYC lengkap menyusul)
// ---------------------------------------------------------------------------
export const customerSeq = pgSequence('customer_no_seq', { startWith: 1 });

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerNo: varchar('customer_no', { length: 24 }).notNull().unique(),
  fullName: text('full_name').notNull(),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 255 }),
  city: text('city').notNull().default(''),
  address: text('address').notNull().default(''),
  branchId: uuid('branch_id').references(() => branches.id), // cabang yang melayani nasabah
  // --- Data KYC (diisi saat pengajuan kredit, diverifikasi AO) ---
  nik: varchar('nik', { length: 32 }),                 // No. identitas (KTP/MyKad)
  birthDate: varchar('birth_date', { length: 10 }),     // YYYY-MM-DD
  maritalStatus: varchar('marital_status', { length: 16 }),
  dependents: integer('dependents'),
  occupation: text('occupation'),
  employer: text('employer'),
  monthlyIncome: numeric('monthly_income', { precision: 18, scale: 2, mode: 'number' }),
  kycStatus: varchar('kyc_status', { length: 16 }).notNull().default('none'), // none | submitted | verified | rejected
  kycVerifiedAt: timestamp('kyc_verified_at', { withTimezone: true }),
  kycVerifiedBy: uuid('kyc_verified_by'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }), // login Akun Saya (OTP)
  lang: varchar('lang', { length: 2 }),                 // bahasa notifikasi: id | ms | en (null = mengikuti negara)
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false), // bersedia menerima promo (persetujuan tercatat di consents)
  marketingOptInAt: timestamp('marketing_opt_in_at', { withTimezone: true }),
  lastPromoAt: timestamp('last_promo_at', { withTimezone: true }),     // pembatasan frekuensi kampanye
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('customers_branch_idx').on(t.branchId), index('customers_phone_idx').on(t.phone), index('customers_nik_idx').on(t.nik)]);

// ---------------------------------------------------------------------------
// Helpdesk satu pintu (Pusat) + eskalasi ke Admin Cabang
// ---------------------------------------------------------------------------
export const ticketSeq = pgSequence('helpdesk_ticket_seq', { startWith: 1 });

export const ticketCategory = pgEnum('ticket_category', ['order', 'delivery', 'product', 'credit', 'payment', 'account', 'other']);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);
/**
 * open        : diterima Helpdesk Pusat
 * in_progress : sedang ditangani Helpdesk Pusat
 * escalated   : dieskalasi ke Admin Cabang, menunggu tindakan cabang
 * branch_done : cabang selesai menangani, menunggu konfirmasi Helpdesk Pusat
 * resolved    : selesai, dikonfirmasi ke nasabah
 * closed      : ditutup (arsip)
 */
export const ticketStatus = pgEnum('ticket_status', ['open', 'in_progress', 'escalated', 'branch_done', 'resolved', 'closed']);
export const ticketChannel = pgEnum('ticket_channel', ['web', 'whatsapp', 'phone', 'email', 'walk_in', 'chat']);

export const tickets = pgTable('helpdesk_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketNo: varchar('ticket_no', { length: 24 }).notNull().unique(),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  category: ticketCategory('category').notNull(),
  priority: ticketPriority('priority').notNull().default('normal'),
  status: ticketStatus('status').notNull().default('open'),
  channel: ticketChannel('channel').notNull().default('phone'),
  customerId: uuid('customer_id').references(() => customers.id),
  branchId: uuid('branch_id').references(() => branches.id), // cabang terkait masalah
  orderRef: varchar('order_ref', { length: 64 }),
  createdBy: uuid('created_by').references(() => users.id), // null = dibuat oleh Asisten Virtual (channel chat)
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  escalatedBy: uuid('escalated_by').references(() => users.id),
  escalationNote: text('escalation_note'),
  branchResolvedAt: timestamp('branch_resolved_at', { withTimezone: true }),
  branchResolvedBy: uuid('branch_resolved_by').references(() => users.id),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(), // target SLA
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('tickets_status_idx').on(t.status),
  index('tickets_branch_idx').on(t.branchId),
  index('tickets_customer_idx').on(t.customerId),
  index('tickets_created_idx').on(t.createdAt),
]);

export const ticketEventType = pgEnum('ticket_event_type', ['created', 'comment', 'status_changed', 'escalated', 'branch_done', 'resolved', 'closed', 'reopened']);

export const ticketEvents = pgTable('helpdesk_ticket_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  type: ticketEventType('type').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'),
  actorRole: varchar('actor_role', { length: 32 }),
  message: text('message'),
  fromStatus: ticketStatus('from_status'),
  toStatus: ticketStatus('to_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ticket_events_ticket_idx').on(t.ticketId)]);

/** Tembusan (CC): Business Manager & Manager Cabang yang ikut menerima informasi tiket. */
export const ticketWatchers = pgTable('helpdesk_ticket_watchers', {
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: varchar('reason', { length: 32 }).notNull(), // assignee | cc_biz_mgr | cc_branch_manager
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ticketId, t.userId] })]);

// ---------------------------------------------------------------------------
// Notifikasi in-app (lonceng di header dashboard)
// ---------------------------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.readAt)]);

export type User = typeof users.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type BusinessConfig = typeof businessConfigs.$inferSelect;

// ===========================================================================
// KATALOG PRODUK
// ===========================================================================
export const productCategories = pgTable('product_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 32 }).notNull().unique(), // mis. TV, KULKAS, SOFA
  name: text('name').notNull(),
  group: varchar('group', { length: 16 }).notNull(), // electronics | furniture
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const productStatus = pgEnum('product_status', ['draft', 'active', 'inactive']);

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: varchar('sku', { length: 40 }).notNull().unique(),
  name: text('name').notNull(),
  brand: varchar('brand', { length: 60 }).notNull().default(''),
  categoryId: uuid('category_id').notNull().references(() => productCategories.id),
  description: text('description').notNull().default(''),
  specs: jsonb('specs').$type<string[]>().notNull().default([]),
  images: jsonb('images').$type<string[]>().notNull().default([]),
  weightKg: numeric('weight_kg', { precision: 8, scale: 2, mode: 'number' }).notNull().default(0),
  lengthCm: integer('length_cm').notNull().default(0),
  widthCm: integer('width_cm').notNull().default(0),
  heightCm: integer('height_cm').notNull().default(0),
  isBulky: boolean('is_bulky').notNull().default(false), // perlu kargo/truk
  requiresInstallation: boolean('requires_installation').notNull().default(false),
  warrantyMonths: integer('warranty_months').notNull().default(0),
  status: productStatus('status').notNull().default('draft'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('products_category_idx').on(t.categoryId), index('products_status_idx').on(t.status)]);

/** Harga tunai per negara (mata uang mengikuti negara). Harga kredit dihitung dari margin Murabahah per tenor. */
export const productPrices = pgTable('product_prices', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  cashPrice: numeric('cash_price', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.productId, t.countryCode] })]);

// ===========================================================================
// STOK MULTI-LOKASI (Gudang Pusat + buffer cabang). Lokasi = branches.
// ===========================================================================
export const stockLevels = pgTable('stock_levels', {
  productId: uuid('product_id').notNull().references(() => products.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  onHand: integer('on_hand').notNull().default(0),     // fisik di lokasi
  reserved: integer('reserved').notNull().default(0),  // dipesan, belum keluar
  minStock: integer('min_stock').notNull().default(0), // batas stok menipis
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.productId, t.branchId] }), index('stock_levels_branch_idx').on(t.branchId),
  // Lapisan terakhir: stok tidak pernah negatif & reservasi tidak melebihi stok fisik, apa pun bug di kode
  check('stock_levels_nonneg_ck', sql`${t.onHand} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`)]);

export const stockMovementType = pgEnum('stock_movement_type', [
  'receipt', 'transfer_out', 'transfer_in', 'adjustment', 'reserve', 'release', 'sale_out', 'return_in',
]);

/** Kartu stok (append-only). qty = perubahan on_hand, reservedDelta = perubahan reserved. */
export const stockMovements = pgTable('stock_movements', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  type: stockMovementType('type').notNull(),
  qty: integer('qty').notNull().default(0),
  reservedDelta: integer('reserved_delta').notNull().default(0),
  onHandAfter: integer('on_hand_after').notNull(),
  reservedAfter: integer('reserved_after').notNull(),
  refType: varchar('ref_type', { length: 24 }), // goods_receipt | transfer | adjustment | order
  refId: text('ref_id'),
  refNo: varchar('ref_no', { length: 32 }),
  note: text('note'),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('stock_mov_product_branch_idx').on(t.productId, t.branchId, t.id)]);

export const docSeq = pgSequence('stock_doc_seq', { startWith: 1 });

/** Penerimaan barang dari supplier (di Gudang Pusat). */
export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  grNo: varchar('gr_no', { length: 32 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  supplierName: text('supplier_name').notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id), // master pemasok (hutang dagang per faktur)
  supplierRef: varchar('supplier_ref', { length: 64 }), // no. surat jalan / faktur
  note: text('note'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goodsReceiptItems = pgTable('goods_receipt_items', {
  receiptId: uuid('receipt_id').notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 2, mode: 'number' }),
}, (t) => [primaryKey({ columns: [t.receiptId, t.productId] })]);

/**
 * Transfer stok Pusat -> Cabang (atau antar lokasi).
 * requested -> approved -> shipped -> received   (rejected / cancelled sebagai akhir alternatif)
 */
export const transferStatus = pgEnum('stock_transfer_status', ['requested', 'approved', 'rejected', 'shipped', 'received', 'cancelled']);

export const stockTransfers = pgTable('stock_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  transferNo: varchar('transfer_no', { length: 32 }).notNull().unique(),
  fromBranchId: uuid('from_branch_id').notNull().references(() => branches.id),
  toBranchId: uuid('to_branch_id').notNull().references(() => branches.id),
  status: transferStatus('status').notNull().default('requested'),
  requestNote: text('request_note'),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectReason: text('reject_reason'),
  shippedBy: uuid('shipped_by').references(() => users.id),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  shipmentRef: varchar('shipment_ref', { length: 64 }), // no. armada / resi
  receivedBy: uuid('received_by').references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receiveNote: text('receive_note'),
  hasDiscrepancy: boolean('has_discrepancy').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('transfers_status_idx').on(t.status), index('transfers_to_idx').on(t.toBranchId)]);

export const stockTransferItems = pgTable('stock_transfer_items', {
  transferId: uuid('transfer_id').notNull().references(() => stockTransfers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qtyRequested: integer('qty_requested').notNull(),
  qtyShipped: integer('qty_shipped'),
  qtyReceived: integer('qty_received'),
}, (t) => [primaryKey({ columns: [t.transferId, t.productId] })]);

/** Penyesuaian stok (stock opname, rusak, hilang). */
export const adjustmentReason = pgEnum('stock_adjustment_reason', ['opname', 'damaged', 'lost', 'found', 'other']);

export const stockAdjustments = pgTable('stock_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  adjNo: varchar('adj_no', { length: 32 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  reason: adjustmentReason('reason').notNull(),
  note: text('note'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockAdjustmentItems = pgTable('stock_adjustment_items', {
  adjustmentId: uuid('adjustment_id').notNull().references(() => stockAdjustments.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  systemQty: integer('system_qty').notNull(),
  countedQty: integer('counted_qty').notNull(),
}, (t) => [primaryKey({ columns: [t.adjustmentId, t.productId] })]);

export type Product = typeof products.$inferSelect;
export type StockTransfer = typeof stockTransfers.$inferSelect;

// ===========================================================================
// PEMBIAYAAN MURABAHAH
// ===========================================================================
export const creditSeq = pgSequence('credit_doc_seq', { startWith: 1 });

/**
 * submitted        : pengajuan masuk (web / cabang), menunggu Manager Cabang menugaskan AO
 * assigned         : AO ditugaskan, verifikasi KYC & survei berjalan
 * branch_review    : AO sudah memberi rekomendasi, menunggu Manager Cabang
 * hq_review        : diteruskan Manager Cabang, menunggu keputusan Business Manager Pusat
 * approved         : disetujui; stok direservasi; menunggu akad & uang muka
 * contracted       : akad ditandatangani & DP diterima; menunggu serah terima barang
 * active           : barang diserahkan; jadwal angsuran berjalan
 * paid_off         : lunas
 * rejected / cancelled
 */
export const creditStatus = pgEnum('credit_status', [
  'submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted', 'active', 'paid_off', 'rejected', 'cancelled',
]);

export const creditApplications = pgTable('credit_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  appNo: varchar('app_no', { length: 24 }).notNull().unique(),
  status: creditStatus('status').notNull().default('submitted'),
  channel: varchar('channel', { length: 16 }).notNull().default('web'), // web | branch
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull().default(1),
  currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
  cashPrice: numeric('cash_price', { precision: 18, scale: 2, mode: 'number' }).notNull(), // snapshot saat pengajuan (x qty), setelah potongan promo
  listPrice: numeric('list_price', { precision: 18, scale: 2, mode: 'number' }),            // harga katalog sebelum potongan promo
  promoCode: varchar('promo_code', { length: 32 }),
  requestedTenor: integer('requested_tenor').notNull(),
  requestedDpPct: numeric('requested_dp_pct', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  purpose: text('purpose'),

  aoId: uuid('ao_id').references(() => users.id),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),

  kycChecklist: jsonb('kyc_checklist').$type<Record<string, { ok: boolean; note?: string }>>(),
  kycCompletedAt: timestamp('kyc_completed_at', { withTimezone: true }),

  aoRecommendation: varchar('ao_recommendation', { length: 8 }), // approve | reject
  aoSuggestedTenor: integer('ao_suggested_tenor'),
  aoSuggestedDpPct: numeric('ao_suggested_dp_pct', { precision: 5, scale: 2, mode: 'number' }),
  aoNotes: text('ao_notes'),
  aoRecommendedAt: timestamp('ao_recommended_at', { withTimezone: true }),

  mcId: uuid('mc_id').references(() => users.id),
  mcNotes: text('mc_notes'),
  mcReviewedAt: timestamp('mc_reviewed_at', { withTimezone: true }),

  requiresCommittee: boolean('requires_committee').notNull().default(false),
  decidedBy: uuid('decided_by').references(() => users.id),
  decisionNotes: text('decision_notes'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),

  // Syarat final (dikunci saat disetujui)
  tenor: integer('tenor'),
  dpPct: numeric('dp_pct', { precision: 5, scale: 2, mode: 'number' }),
  downPayment: numeric('down_payment', { precision: 18, scale: 2, mode: 'number' }),
  financed: numeric('financed', { precision: 18, scale: 2, mode: 'number' }),
  marginPct: numeric('margin_pct', { precision: 6, scale: 2, mode: 'number' }),
  marginAmount: numeric('margin_amount', { precision: 18, scale: 2, mode: 'number' }),
  salePrice: numeric('sale_price', { precision: 18, scale: 2, mode: 'number' }),
  monthly: numeric('monthly', { precision: 18, scale: 2, mode: 'number' }),

  fulfillBranchId: uuid('fulfill_branch_id').references(() => branches.id), // lokasi stok yang direservasi

  contractNo: varchar('contract_no', { length: 24 }).unique(),
  contractSignedAt: timestamp('contract_signed_at', { withTimezone: true }),
  contractSignedBy: uuid('contract_signed_by').references(() => users.id),
  dpPaidAmount: numeric('dp_paid_amount', { precision: 18, scale: 2, mode: 'number' }),
  dpPaidAt: timestamp('dp_paid_at', { withTimezone: true }),
  dpMethod: varchar('dp_method', { length: 16 }),
  dpRef: varchar('dp_ref', { length: 64 }),
  shippingFee: numeric('shipping_fee', { precision: 18, scale: 2, mode: 'number' }), // ongkir dibayar bersama DP saat akad
  // Rencana pengiriman yang disepakati saat akad; pengiriman dibuat setelah uang muka lunas
  deliveryPlan: jsonb('delivery_plan').$type<{ mode: string; address: string; city: string; postalCode: string | null; courierCode: string | null; service: string | null; label: string }>(),

  handoverAt: timestamp('handover_at', { withTimezone: true }),
  handoverBy: uuid('handover_by').references(() => users.id),
  handoverMethod: varchar('handover_method', { length: 16 }), // pickup | internal | partner
  handoverNote: text('handover_note'),

  settledEarlyAt: timestamp('settled_early_at', { withTimezone: true }),   // pelunasan dipercepat
  ibraAmount: numeric('ibra_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // potongan (ibra') saat pelunasan
  closedReason: text('closed_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('credit_status_idx').on(t.status), index('credit_branch_idx').on(t.branchId),
  index('credit_ao_idx').on(t.aoId), index('credit_customer_idx').on(t.customerId),
]);

/** Hasil survei lapangan AO (satu aktif per pengajuan; revisi menimpa). */
export const creditSurveys = pgTable('credit_surveys', {
  applicationId: uuid('application_id').primaryKey().references(() => creditApplications.id, { onDelete: 'cascade' }),
  surveyorId: uuid('surveyor_id').notNull().references(() => users.id),
  visitedAt: timestamp('visited_at', { withTimezone: true }).notNull(),
  addressVerified: boolean('address_verified').notNull(),
  residenceStatus: varchar('residence_status', { length: 16 }).notNull(), // own | family | rent | official
  lengthOfStayYears: integer('length_of_stay_years').notNull().default(0),
  incomeVerified: boolean('income_verified').notNull(),
  verifiedIncome: numeric('verified_income', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  otherObligations: numeric('other_obligations', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // cicilan lain / bulan
  characterScore: integer('character_score').notNull(), // 1-5 (wawancara & lingkungan)
  photos: jsonb('photos').$type<string[]>().notNull().default([]),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Suara Business Manager (komite bila melebihi batas wewenang). */
export const creditHqVotes = pgTable('credit_hq_votes', {
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  decision: varchar('decision', { length: 8 }).notNull(), // approve | reject | return
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.applicationId, t.userId] })]);

export const creditEvents = pgTable('credit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'),
  actorRole: varchar('actor_role', { length: 32 }),
  message: text('message'),
  fromStatus: creditStatus('from_status'),
  toStatus: creditStatus('to_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('credit_events_app_idx').on(t.applicationId)]);

export const installmentStatus = pgEnum('installment_status', ['scheduled', 'paid', 'partial']);

export const installments = pgTable('installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  dueDate: varchar('due_date', { length: 10 }).notNull(), // YYYY-MM-DD
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  paidAmount: numeric('paid_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  status: installmentStatus('status').notNull().default('scheduled'),
}, (t) => [uniqueIndex('installments_app_seq_uq').on(t.applicationId, t.seq), index('installments_due_idx').on(t.dueDate),
  check('installments_amount_ck', sql`${t.amount} > 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount} + 0.01`)]);

export type CreditApplication = typeof creditApplications.$inferSelect;

// ===========================================================================
// ORDER TUNAI (checkout website)
// ===========================================================================
export const orderSeq = pgSequence('order_doc_seq', { startWith: 1 });

/** awaiting_payment -> paid -> fulfilling (dikirim / siap diambil) -> completed  |  cancelled / expired */
export const orderStatus = pgEnum('order_status', ['awaiting_payment', 'paid', 'fulfilling', 'completed', 'cancelled', 'expired']);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNo: varchar('order_no', { length: 24 }).notNull().unique(),
  status: orderStatus('status').notNull().default('awaiting_payment'),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),        // cabang yang melayani
  fulfillBranchId: uuid('fulfill_branch_id').notNull().references(() => branches.id), // lokasi stok utama (ongkir dihitung dari sini)
  // Alokasi stok per lokasi; lebih dari satu lokasi = pengiriman dipecah (stok tersebar)
  allocation: jsonb('allocation').$type<{ productId: string; branchId: string; qty: number }[]>(),
  currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
  subtotal: numeric('subtotal', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  discount: numeric('discount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // potongan kode promo
  promoCode: varchar('promo_code', { length: 32 }),
  tax: numeric('tax', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  shippingFee: numeric('shipping_fee', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  total: numeric('total', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  deliveryMode: varchar('delivery_mode', { length: 16 }).notNull(), // internal | partner | pickup
  courierCode: varchar('courier_code', { length: 24 }),
  courierService: varchar('courier_service', { length: 40 }),
  recipientName: text('recipient_name').notNull(),
  recipientPhone: varchar('recipient_phone', { length: 32 }).notNull(),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  postalCode: varchar('postal_code', { length: 10 }),
  note: text('note'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('orders_status_idx').on(t.status), index('orders_branch_idx').on(t.branchId), check('orders_amount_ck', sql`${t.total} >= 0 and ${t.discount} >= 0`)]);

export const orderItems = pgTable('order_items', {
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  name: text('name').notNull(),
  qty: integer('qty').notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 2, mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.orderId, t.productId] })]);

/** Isi tiap pengiriman (order dapat dikirim dari beberapa lokasi stok). */
export const shipmentItems = pgTable('shipment_items', {
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
}, (t) => [primaryKey({ columns: [t.shipmentId, t.productId] })]);

// ===========================================================================
// PENGIRIMAN 3 MODE: armada internal, kurir mitra, ambil sendiri
// ===========================================================================
export const shipmentStatus = pgEnum('shipment_status', ['pending', 'scheduled', 'ready_pickup', 'in_transit', 'delivered', 'failed', 'cancelled']);

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentNo: varchar('shipment_no', { length: 24 }).notNull().unique(),
  sourceType: varchar('source_type', { length: 16 }).notNull(), // credit | order
  sourceId: uuid('source_id').notNull(),
  sourceNo: varchar('source_no', { length: 24 }).notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),      // cabang pelayanan nasabah
  fromBranchId: uuid('from_branch_id').notNull().references(() => branches.id), // lokasi stok asal
  mode: varchar('mode', { length: 16 }).notNull(), // internal | partner | pickup
  status: shipmentStatus('status').notNull().default('pending'),
  recipientName: text('recipient_name').notNull(),
  recipientPhone: varchar('recipient_phone', { length: 32 }).notNull(),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  postalCode: varchar('postal_code', { length: 10 }),
  itemsSummary: text('items_summary').notNull(),
  weightKg: numeric('weight_kg', { precision: 10, scale: 2, mode: 'number' }).notNull().default(0),
  isBulky: boolean('is_bulky').notNull().default(false),
  needsInstallation: boolean('needs_installation').notNull().default(false),
  shippingFee: numeric('shipping_fee', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  // internal
  driverId: uuid('driver_id').references(() => users.id),
  vehicleRef: varchar('vehicle_ref', { length: 40 }),
  scheduledDate: varchar('scheduled_date', { length: 10 }),
  scheduledSlot: varchar('scheduled_slot', { length: 16 }), // pagi | siang | sore
  // mitra
  courierCode: varchar('courier_code', { length: 24 }),
  courierService: varchar('courier_service', { length: 40 }),
  trackingNo: varchar('tracking_no', { length: 64 }),
  externalRef: varchar('external_ref', { length: 64 }),   // id order di agregator kurir (Biteship)
  courierStatus: varchar('courier_status', { length: 32 }), // status terakhir dari kurir
  // ambil sendiri
  pickupCode: varchar('pickup_code', { length: 8 }),
  pickupExpiresAt: timestamp('pickup_expires_at', { withTimezone: true }),
  // bukti terima
  podName: text('pod_name'),
  podNote: text('pod_note'),
  podPhotoUrl: text('pod_photo_url'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deliveredBy: uuid('delivered_by').references(() => users.id),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('shipments_status_idx').on(t.status), index('shipments_from_idx').on(t.fromBranchId), index('shipments_driver_idx').on(t.driverId), index('shipments_source_idx').on(t.sourceType, t.sourceId)]);

export const shipmentEvents = pgTable('shipment_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 24 }).notNull(),
  message: text('message'),
  actorName: text('actor_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('shipment_events_idx').on(t.shipmentId)]);

// ===========================================================================
// PEMBAYARAN (order tunai, uang muka, angsuran)
// ===========================================================================
export const paymentSeq = pgSequence('payment_doc_seq', { startWith: 1 });
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'failed', 'expired', 'cancelled']);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentNo: varchar('payment_no', { length: 24 }).notNull().unique(),
  kind: varchar('kind', { length: 16 }).notNull(), // order | installment | down_payment
  refId: uuid('ref_id').notNull(),                  // orders.id | credit_applications.id
  refNo: varchar('ref_no', { length: 24 }).notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  tazirAmount: numeric('tazir_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // denda -> dana sosial
  ibraAmount: numeric('ibra_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),   // potongan pelunasan dipercepat (bukan kas)
  shiftId: uuid('shift_id'),                                                                              // shift kasir (pembayaran tunai)
  method: varchar('method', { length: 16 }).notNull(), // cash | transfer | va | qris
  status: paymentStatus('status').notNull().default('pending'),
  channel: varchar('channel', { length: 16 }).notNull(), // gateway | cashier
  vaNumber: varchar('va_number', { length: 32 }),
  bank: varchar('bank', { length: 16 }),            // bank VA (bca, bni, bri, permata)
  qrString: text('qr_string'),                      // payload QRIS
  qrUrl: text('qr_url'),                            // URL gambar QR dari gateway
  payUrl: text('pay_url'),                          // halaman bayar (Billplz FPX, dll.)
  gatewayRef: varchar('gateway_ref', { length: 64 }),
  proofRef: varchar('proof_ref', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  receivedBy: uuid('received_by').references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payments_ref_idx').on(t.kind, t.refId), index('payments_status_idx').on(t.status), index('payments_branch_idx').on(t.branchId, t.paidAt),
  check('payments_amount_ck', sql`${t.amount} >= 0 and ${t.tazirAmount} >= 0 and ${t.ibraAmount} >= 0`)]);

export const paymentAllocations = pgTable('payment_allocations', {
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  installmentId: uuid('installment_id').notNull().references(() => installments.id),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.paymentId, t.installmentId] })]);

export type Shipment = typeof shipments.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Payment = typeof payments.$inferSelect;

// ---------------------------------------------------------------------------
// Asisten Virtual (Claude) — pemakaian harian untuk kontrol biaya
// ---------------------------------------------------------------------------
export const assistantUsage = pgTable('assistant_usage', {
  day: varchar('day', { length: 10 }).notNull(),          // YYYY-MM-DD
  model: varchar('model', { length: 64 }).notNull(),
  requests: integer('requests').notNull().default(0),
  toolCalls: integer('tool_calls').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  errors: integer('errors').notNull().default(0),
  ticketsCreated: integer('tickets_created').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.model] })]);

// ===========================================================================
// KEUANGAN CABANG: shift kasir, biaya operasional, ta'zir, refund & retur
// ===========================================================================
export const financeDocSeq = pgSequence('finance_doc_seq', { startWith: 1 });

/** Shift kasir: saldo awal -> penerimaan & pengeluaran tunai -> hitung fisik, selisih, setoran bank -> verifikasi Manager Cabang. */
export const cashierShifts = pgTable('cashier_shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  shiftNo: varchar('shift_no', { length: 24 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  status: varchar('status', { length: 16 }).notNull().default('open'), // open | closed | verified
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  openingCash: numeric('opening_cash', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  cashIn: numeric('cash_in', { precision: 18, scale: 2, mode: 'number' }),
  cashOut: numeric('cash_out', { precision: 18, scale: 2, mode: 'number' }),
  expectedCash: numeric('expected_cash', { precision: 18, scale: 2, mode: 'number' }),
  countedCash: numeric('counted_cash', { precision: 18, scale: 2, mode: 'number' }),
  variance: numeric('variance', { precision: 18, scale: 2, mode: 'number' }),
  depositAmount: numeric('deposit_amount', { precision: 18, scale: 2, mode: 'number' }),
  depositRef: varchar('deposit_ref', { length: 64 }),
  closingNote: text('closing_note'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifyNote: text('verify_note'),
}, (t) => [index('shifts_branch_idx').on(t.branchId, t.openedAt), index('shifts_user_idx').on(t.userId, t.status),
  uniqueIndex('shifts_one_open_uq').on(t.userId).where(sql`${t.status} = 'open'`)]);

/** Biaya operasional cabang: diajukan Admin Cabang -> disetujui Manager Cabang (BM bila di atas batas) -> dibayarkan. */
export const branchExpenses = pgTable('branch_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseNo: varchar('expense_no', { length: 24 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  category: varchar('category', { length: 24 }).notNull(),
  description: text('description').notNull(),
  vendor: text('vendor'),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  expenseDate: varchar('expense_date', { length: 10 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(), // cash | transfer
  receiptRef: varchar('receipt_ref', { length: 64 }),   // no. nota / faktur vendor
  status: varchar('status', { length: 16 }).notNull().default('submitted'), // submitted | hq_review | approved | rejected | paid | cancelled
  requiresHq: boolean('requires_hq').notNull().default(false),
  submittedBy: uuid('submitted_by').notNull().references(() => users.id),
  mcBy: uuid('mc_by').references(() => users.id),
  mcAt: timestamp('mc_at', { withTimezone: true }),
  hqBy: uuid('hq_by').references(() => users.id),
  hqAt: timestamp('hq_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  paidBy: uuid('paid_by').references(() => users.id),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paidRef: varchar('paid_ref', { length: 64 }),
  shiftId: uuid('shift_id').references(() => cashierShifts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('expenses_branch_idx').on(t.branchId, t.expenseDate), index('expenses_status_idx').on(t.status), check('expenses_amount_ck', sql`${t.amount} > 0`)]);

/** Ta'zir (denda keterlambatan) per angsuran yang terlambat melewati masa tenggang — disalurkan ke dana sosial. */
export const tazirCharges = pgTable('tazir_charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id, { onDelete: 'cascade' }),
  installmentId: uuid('installment_id').notNull().unique().references(() => installments.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  assessedOn: varchar('assessed_on', { length: 10 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('unpaid'), // unpaid | paid | waived
  paymentId: uuid('payment_id').references(() => payments.id),
  waivedBy: uuid('waived_by').references(() => users.id),
  waiveReason: text('waive_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('tazir_app_idx').on(t.applicationId, t.status)]);

/** Pengembalian dana: pembatalan order lunas, pembatalan akad sebelum barang diterima, atau hasil retur. */
export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  refundNo: varchar('refund_no', { length: 24 }).notNull().unique(),
  sourceType: varchar('source_type', { length: 16 }).notNull(), // order | credit | return
  sourceId: uuid('source_id').notNull(),
  sourceNo: varchar('source_no', { length: 24 }).notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  customerName: text('customer_name').notNull(),
  customerPhone: varchar('customer_phone', { length: 32 }),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  method: varchar('method', { length: 16 }).notNull(), // cash | transfer
  bankName: text('bank_name'),
  accountNo: varchar('account_no', { length: 40 }),
  accountName: text('account_name'),
  status: varchar('status', { length: 16 }).notNull().default('requested'), // requested | approved | rejected | paid
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  paidBy: uuid('paid_by').references(() => users.id),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paidRef: varchar('paid_ref', { length: 64 }),
  shiftId: uuid('shift_id').references(() => cashierShifts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('refunds_branch_idx').on(t.branchId, t.status), index('refunds_source_idx').on(t.sourceType, t.sourceId), check('refunds_amount_ck', sql`${t.amount} > 0`)]);

/** Retur barang setelah diterima: ganti barang, refund (order tunai), atau perbaikan garansi. */
export const productReturns = pgTable('product_returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  returnNo: varchar('return_no', { length: 24 }).notNull().unique(),
  sourceType: varchar('source_type', { length: 16 }).notNull(), // order | credit
  sourceId: uuid('source_id').notNull(),
  sourceNo: varchar('source_no', { length: 24 }).notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  customerName: text('customer_name').notNull(),
  customerPhone: varchar('customer_phone', { length: 32 }),
  reason: varchar('reason', { length: 24 }).notNull(),       // damaged | wrong_item | defect | other
  description: text('description').notNull(),
  resolution: varchar('resolution', { length: 16 }).notNull(), // replace | refund | repair
  status: varchar('status', { length: 16 }).notNull().default('requested'), // requested | approved | rejected | received | completed
  condition: varchar('condition', { length: 16 }),            // good | damaged (saat diterima)
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  receivedBy: uuid('received_by').references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  replacementShipmentId: uuid('replacement_shipment_id').references(() => shipments.id),
  refundId: uuid('refund_id').references(() => refunds.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completionNote: text('completion_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('returns_branch_idx').on(t.branchId, t.status), index('returns_source_idx').on(t.sourceType, t.sourceId)]);

export type CashierShift = typeof cashierShifts.$inferSelect;
export type BranchExpense = typeof branchExpenses.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type ProductReturn = typeof productReturns.$inferSelect;

// ===========================================================================
// FILE (foto KTP/survei, bukti terima, nota biaya) & NOTIFIKASI KELUAR (WhatsApp / email)
// ===========================================================================
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerType: varchar('owner_type', { length: 24 }).notNull(), // credit | shipment | expense | return
  ownerId: uuid('owner_id').notNull(),
  kind: varchar('kind', { length: 24 }).notNull(),            // ktp | selfie | kk | income_proof | address_proof | survey | pod | receipt | other
  filename: text('filename').notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('files_owner_idx').on(t.ownerType, t.ownerId)]);

export const notificationOutbox = pgTable('notification_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  channel: varchar('channel', { length: 16 }).notNull(),      // whatsapp | email
  recipient: text('recipient').notNull(),
  template: varchar('template', { length: 48 }).notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  refType: varchar('ref_type', { length: 24 }),
  refId: varchar('ref_id', { length: 64 }),
  dedupeKey: varchar('dedupe_key', { length: 160 }).unique(), // mencegah kiriman ganda (mis. pengingat per angsuran per hari)
  status: varchar('status', { length: 16 }).notNull().default('pending'), // pending | sent | failed | skipped
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  provider: varchar('provider', { length: 24 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('outbox_status_idx').on(t.status, t.nextAttemptAt), index('outbox_ref_idx').on(t.refType, t.refId)]);

export type StoredFile = typeof files.$inferSelect;

// ===========================================================================
// AKUN NASABAH (login OTP WhatsApp)
// ===========================================================================
export const customerOtps = pgTable('customer_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 20 }).notNull(),       // dinormalkan: 08xxxxxxxx
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  ip: varchar('ip', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('customer_otps_phone_idx').on(t.phone, t.createdAt)]);

// ===========================================================================
// AKUNTANSI SYARIAH (PSAK 102 Murabahah) — role Bookkeeping
// ===========================================================================
/** Bagan akun. normal = sisi saldo normal (debit/credit); akun kontra memakai sisi kebalikan tipenya. */
export const coaAccounts = pgTable('coa_accounts', {
  code: varchar('code', { length: 8 }).primaryKey(),
  name: text('name').notNull(),
  type: varchar('type', { length: 12 }).notNull(),     // asset | liability | equity | income | expense
  normal: varchar('normal', { length: 6 }).notNull(),  // debit | credit
  groupName: varchar('group_name', { length: 48 }).notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false), // dipakai posting otomatis, tidak bisa dinonaktifkan
  isActive: boolean('is_active').notNull().default(true),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalSeq = pgSequence('journal_seq', { startWith: 1 });

/** Jurnal. Satu sumber (dokumen operasional) = satu jurnal per event; dijaga indeks unik agar posting idempoten. */
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryNo: varchar('entry_no', { length: 24 }).notNull().unique(),
  date: varchar('date', { length: 10 }).notNull(),     // YYYY-MM-DD (WIB)
  sourceType: varchar('source_type', { length: 16 }).notNull(), // stock | payment | refund | expense | shift | charity | manual | reversal
  sourceId: varchar('source_id', { length: 64 }).notNull(),
  event: varchar('event', { length: 16 }).notNull().default('main'),
  sourceNo: varchar('source_no', { length: 32 }),
  memo: text('memo').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('posted'), // posted | reversed
  reversalOf: uuid('reversal_of'),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('journal_source_uq').on(t.sourceType, t.sourceId, t.event), index('journal_date_idx').on(t.date)]);

export const journalLines = pgTable('journal_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  accountCode: varchar('account_code', { length: 8 }).notNull().references(() => coaAccounts.code),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  debit: numeric('debit', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  credit: numeric('credit', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  memo: text('memo'),
  subType: varchar('sub_type', { length: 16 }), // buku pembantu: credit (pembiayaan)
  subId: uuid('sub_id'),
}, (t) => [index('jl_entry_idx').on(t.entryId), index('jl_account_idx').on(t.accountCode, t.branchId), index('jl_sub_idx').on(t.subType, t.subId)]);

/** Periode yang ditutup: tidak bisa lagi menerima jurnal manual; posting otomatis dialihkan ke tanggal berjalan. */
export const accountingPeriods = pgTable('accounting_periods', {
  period: varchar('period', { length: 7 }).primaryKey(), // YYYY-MM
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note'),
});

/** Penyaluran dana kebajikan (dari ta'zir) — bukan pendapatan perusahaan. */
export const charityDisbursements = pgTable('charity_disbursements', {
  id: uuid('id').primaryKey().defaultRandom(),
  disbNo: varchar('disb_no', { length: 24 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  date: varchar('date', { length: 10 }).notNull(),
  recipient: text('recipient').notNull(),
  purpose: varchar('purpose', { length: 24 }).notNull(), // social | education | health | disaster | worship | other
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  method: varchar('method', { length: 16 }).notNull(), // cash | transfer
  ref: varchar('ref', { length: 64 }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('charity_branch_idx').on(t.branchId, t.date)]);

/** Event operasional yang gagal diposting (ditampilkan di dashboard Bookkeeping). */
export const postingErrors = pgTable('posting_errors', {
  sourceType: varchar('source_type', { length: 16 }).notNull(),
  sourceId: varchar('source_id', { length: 64 }).notNull(),
  message: text('message').notNull(),
  attempts: integer('attempts').notNull().default(1),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sourceType, t.sourceId] })]);

export type JournalEntry = typeof journalEntries.$inferSelect;

// ---------------------------------------------------------------------------
// Persetujuan (consent) nasabah atas Syarat & Ketentuan, Kebijakan Privasi, dan pemeriksaan data
// — bukti persetujuan sesuai UU PDP (ID) / PDPA (MY) / PDPO (BN). Tidak pernah diubah atau dihapus.
// ---------------------------------------------------------------------------
export const consents = pgTable('consents', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  subjectType: varchar('subject_type', { length: 24 }).notNull(), // customer | credit_application | order
  subjectId: text('subject_id').notNull(),
  phone: varchar('phone', { length: 32 }),
  document: varchar('document', { length: 24 }).notNull(),     // terms | privacy | credit_check
  version: varchar('version', { length: 16 }).notNull(),
  lang: varchar('lang', { length: 5 }),
  countryCode: varchar('country_code', { length: 2 }),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('consents_subject_idx').on(t.subjectType, t.subjectId), index('consents_phone_idx').on(t.phone)]);

// ===========================================================================
// HUTANG PEMASOK (per faktur)
// ===========================================================================
export const apSeq = pgSequence('ap_doc_seq', { startWith: 1 });

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 24 }).notNull().unique(),
  name: text('name').notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  taxId: varchar('tax_id', { length: 32 }),           // NPWP / SST no.
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 255 }),
  address: text('address').notNull().default(''),
  bankName: text('bank_name'),
  accountNo: varchar('account_no', { length: 40 }),
  accountName: text('account_name'),
  paymentTermsDays: integer('payment_terms_days').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Faktur pemasok. Nilai barang (DPP) diakui saat penerimaan barang; faktur menambah PPN masukan & selisih harga. */
export const supplierInvoices = pgTable('supplier_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceNo: varchar('invoice_no', { length: 24 }).notNull().unique(),    // nomor internal AP-YYMM-xxxxx
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  supplierInvoiceNo: varchar('supplier_invoice_no', { length: 64 }).notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),  // kantor yang menerima barang & berhutang
  receiptId: uuid('receipt_id').references(() => goodsReceipts.id),
  invoiceDate: varchar('invoice_date', { length: 10 }).notNull(),
  dueDate: varchar('due_date', { length: 10 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  receiptValue: numeric('receipt_value', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // nilai penerimaan barang yang sudah dijurnal
  subtotal: numeric('subtotal', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  tax: numeric('tax', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  total: numeric('total', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  paidAmount: numeric('paid_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('open'), // open | partial | paid | cancelled
  note: text('note'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ap_inv_supplier_idx').on(t.supplierId, t.status), uniqueIndex('ap_inv_supplier_no_uq').on(t.supplierId, t.supplierInvoiceNo), index('ap_inv_due_idx').on(t.status, t.dueDate),
  // Satu penerimaan barang hanya boleh punya satu faktur aktif
  uniqueIndex('ap_inv_receipt_open_uq').on(t.receiptId).where(sql`${t.status} <> 'cancelled'`),
  check('ap_inv_amount_ck', sql`${t.total} >= 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.total} + 0.01`)]);

export const supplierPayments = pgTable('supplier_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentNo: varchar('payment_no', { length: 24 }).notNull().unique(),
  invoiceId: uuid('invoice_id').notNull().references(() => supplierInvoices.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  amount: numeric('amount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  method: varchar('method', { length: 16 }).notNull(), // transfer | cash | claim_offset
  bankRef: varchar('bank_ref', { length: 64 }),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  paidBy: uuid('paid_by').notNull().references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ap_pay_invoice_idx').on(t.invoiceId), check('ap_pay_amount_ck', sql`${t.amount} > 0`)]);

// ===========================================================================
// REKONSILIASI REKENING KORAN
// ===========================================================================
export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),  // kantor pemilik rekening (akun 1102 kantor ini)
  bankName: text('bank_name').notNull(),
  accountNo: varchar('account_no', { length: 40 }).notNull(),
  accountName: text('account_name').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  preset: varchar('preset', { length: 16 }).notNull().default('generic'), // generic | bca | mandiri | bsi
  columnMap: jsonb('column_map').$type<{ date: string; description: string; debit?: string; credit?: string; amount?: string; dc?: string; balance?: string; reference?: string; dateFormat: string; decimal?: ',' | '.'; delimiter?: string; skipRows?: number }>(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('bank_acc_no_uq').on(t.bankName, t.accountNo)]);

export const bankImports = pgTable('bank_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => bankAccounts.id),
  filename: text('filename').notNull(),
  rowsTotal: integer('rows_total').notNull(),
  rowsNew: integer('rows_new').notNull(),
  dateFrom: varchar('date_from', { length: 10 }),
  dateTo: varchar('date_to', { length: 10 }),
  closingBalance: numeric('closing_balance', { precision: 18, scale: 2, mode: 'number' }),
  importedBy: uuid('imported_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Baris mutasi rekening koran. debit = uang keluar, credit = uang masuk (sudut pandang rekening). */
export const bankLines = pgTable('bank_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => bankAccounts.id),
  importId: uuid('import_id').notNull().references(() => bankImports.id),
  txDate: varchar('tx_date', { length: 10 }).notNull(),
  description: text('description').notNull(),
  reference: varchar('reference', { length: 80 }),
  debit: numeric('debit', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  credit: numeric('credit', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  balance: numeric('balance', { precision: 18, scale: 2, mode: 'number' }),
  seq: integer('seq').notNull().default(0), // urutan baris di rekening koran (untuk saldo terakhir per tanggal)
  hash: varchar('hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('unmatched'), // unmatched | matched | posted | ignored
  matchType: varchar('match_type', { length: 24 }), // shift_deposit | customer_transfer | gateway_settlement | supplier_payment | refund | expense | charity | bank_fee | other_income | manual
  matchRefs: jsonb('match_refs').$type<{ type: string; id: string; no: string; amount: number }[]>(),
  note: text('note'),
  matchedBy: uuid('matched_by').references(() => users.id),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('bank_line_hash_uq').on(t.accountId, t.hash), index('bank_line_status_idx').on(t.accountId, t.status, t.txDate)]);

// ===========================================================================
// KARANTINA BARANG RUSAK & KLAIM PEMASOK
// ===========================================================================
export const quarantineItems = pgTable('quarantine_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  qNo: varchar('q_no', { length: 24 }).notNull().unique(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  source: varchar('source', { length: 16 }).notNull(),         // return | receipt | opname | iqalah
  sourceRef: varchar('source_ref', { length: 32 }),
  sourceId: uuid('source_id'),
  creditTo: varchar('credit_to', { length: 8 }),               // akun lawan saat masuk karantina (5101/5102/5103/1301)
  conditionNote: text('condition_note').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('quarantined'), // quarantined | restocked | written_off | claimed | claim_settled
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  claimNo: varchar('claim_no', { length: 24 }),
  claimAmount: numeric('claim_amount', { precision: 18, scale: 2, mode: 'number' }),
  settledAmount: numeric('settled_amount', { precision: 18, scale: 2, mode: 'number' }),
  settledMethod: varchar('settled_method', { length: 16 }),   // credit_note | transfer | replacement
  decisionNote: text('decision_note'),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('quarantine_branch_idx').on(t.branchId, t.status)]);

// ===========================================================================
// IQALAH — pembatalan akad Murabahah setelah serah terima (atas kesepakatan)
// ===========================================================================
export const iqalahRequests = pgTable('iqalah_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  iqalahNo: varchar('iqalah_no', { length: 24 }).notNull().unique(),
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('requested'), // requested | approved | rejected | completed | cancelled
  depreciation: numeric('depreciation', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),  // penurunan nilai barang yang disepakati
  paidByCustomer: numeric('paid_by_customer', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0), // uang muka (tanpa ongkir) + angsuran
  refundAmount: numeric('refund_amount', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  conditionNote: text('condition_note'),
  goodsCondition: varchar('goods_condition', { length: 16 }),  // good | damaged
  refundMethod: varchar('refund_method', { length: 16 }),
  bankName: text('bank_name'), accountNo: varchar('account_no', { length: 40 }), accountName: text('account_name'),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  receivedBy: uuid('received_by').references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  refundId: uuid('refund_id').references(() => refunds.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('iqalah_app_idx').on(t.applicationId), index('iqalah_branch_idx').on(t.branchId, t.status),
  uniqueIndex('iqalah_one_open_uq').on(t.applicationId).where(sql`${t.status} in ('requested','approved')`)]);

// ===========================================================================
// MARKETING: kode promo, banner, produk unggulan, kampanye
// ===========================================================================
export const promoCodes = pgTable('promo_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 32 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  type: varchar('type', { length: 8 }).notNull(),             // percent | amount
  value: numeric('value', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  maxDiscount: numeric('max_discount', { precision: 18, scale: 2, mode: 'number' }),
  minPurchase: numeric('min_purchase', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
  appliesTo: varchar('applies_to', { length: 8 }).notNull().default('both'), // cash | credit | both
  categoryIds: jsonb('category_ids').$type<string[]>().notNull().default([]),
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  quota: integer('quota'),                                    // total pemakaian (null = tanpa batas)
  perCustomer: integer('per_customer').notNull().default(1),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('promo_code_country_uq').on(t.code, t.countryCode)]);

export const promoRedemptions = pgTable('promo_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  promoId: uuid('promo_id').notNull().references(() => promoCodes.id),
  phone: varchar('phone', { length: 32 }).notNull(),
  sourceType: varchar('source_type', { length: 16 }).notNull(), // order | credit
  sourceId: uuid('source_id').notNull(),
  sourceNo: varchar('source_no', { length: 24 }).notNull(),
  discount: numeric('discount', { precision: 18, scale: 2, mode: 'number' }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('active'), // active | void
  campaignId: uuid('campaign_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('promo_red_source_uq').on(t.sourceType, t.sourceId), index('promo_red_promo_idx').on(t.promoId, t.status), index('promo_red_phone_idx').on(t.phone)]);

export const banners = pgTable('banners', {
  id: uuid('id').primaryKey().defaultRandom(),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  title: jsonb('title').$type<Record<string, string>>().notNull(),      // { id, ms, en }
  subtitle: jsonb('subtitle').$type<Record<string, string>>().notNull().default({}),
  imageUrl: text('image_url'),
  theme: varchar('theme', { length: 16 }).notNull().default('emerald'), // emerald | gold | dark
  linkType: varchar('link_type', { length: 12 }).notNull().default('none'), // none | product | category | promo | url
  linkValue: text('link_value'),
  sortOrder: integer('sort_order').notNull().default(0),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('banners_country_idx').on(t.countryCode, t.isActive)]);

export const featuredProducts = pgTable('featured_products', {
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  rank: integer('rank').notNull().default(0),
  label: varchar('label', { length: 16 }).notNull().default('featured'), // featured | promo | new | bestseller
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.countryCode, t.productId] })]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull().references(() => countries.code),
  channel: varchar('channel', { length: 8 }).notNull(),      // whatsapp | email | both
  segment: jsonb('segment').$type<{ type: 'all' | 'buyers' | 'active_credit' | 'paid_off' | 'branch'; branchId?: string | null; sinceDays?: number | null }>().notNull(),
  subject: text('subject').notNull(),
  body: jsonb('body').$type<Record<string, string>>().notNull(), // isi per bahasa { id, ms, en }
  promoId: uuid('promo_id').references(() => promoCodes.id),
  link: text('link'),
  status: varchar('status', { length: 12 }).notNull().default('draft'), // draft | scheduled | sending | sent | cancelled
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  recipients: integer('recipients').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
