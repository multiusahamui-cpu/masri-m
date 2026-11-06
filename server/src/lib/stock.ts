import { and, inArray, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, notifications, stockAdjustmentItems, stockAdjustments, stockLevels, stockMovements, stockTransferItems,
  stockTransfers, goodsReceipts, goodsReceiptItems, users, products, suppliers, type StockTransfer,
} from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import type { AuthUser } from '../middleware/auth.js';
import { branchCountry } from './region.js';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MovementType = typeof stockMovements.$inferInsert['type'];

// ---------------------------------------------------------------------------
// Inti: satu-satunya jalan mengubah stok. Mengunci baris stok, memvalidasi, mencatat kartu stok.
// ---------------------------------------------------------------------------
export interface MovementInput {
  productId: string; branchId: string; type: MovementType;
  qty?: number; reservedDelta?: number;
  refType?: string; refId?: string; refNo?: string; note?: string | null; actorId?: string | null;
}

export async function applyMovement(tx: Tx, m: MovementInput) {
  const qty = m.qty ?? 0;
  const rd = m.reservedDelta ?? 0;
  const minStock = await defaultMinStock(tx, m.branchId);
  await tx.insert(stockLevels).values({ productId: m.productId, branchId: m.branchId, minStock }).onConflictDoNothing();
  const { rows: [lvl] } = await tx.execute<{ on_hand: number; reserved: number }>(
    sql`select on_hand, reserved from stock_levels where product_id = ${m.productId} and branch_id = ${m.branchId} for update`);

  const onHand = lvl.on_hand + qty;
  const reserved = lvl.reserved + rd;
  if (onHand < 0) throw new HttpError(409, await shortMsg(tx, m.productId, lvl.on_hand - lvl.reserved));
  if (reserved < 0) throw new HttpError(409, 'Reservasi stok tidak valid');
  if (reserved > onHand) throw new HttpError(409, await shortMsg(tx, m.productId, lvl.on_hand - lvl.reserved));

  await tx.update(stockLevels).set({ onHand, reserved, updatedAt: new Date() })
    .where(and(eq(stockLevels.productId, m.productId), eq(stockLevels.branchId, m.branchId)));
  await tx.insert(stockMovements).values({
    productId: m.productId, branchId: m.branchId, type: m.type, qty, reservedDelta: rd,
    onHandAfter: onHand, reservedAfter: reserved, refType: m.refType ?? null, refId: m.refId ?? null,
    refNo: m.refNo ?? null, note: m.note ?? null, actorId: m.actorId ?? null,
  });
  return { onHand, reserved, available: onHand - reserved };
}

async function shortMsg(tx: Tx, productId: string, available: number) {
  const [p] = await tx.select({ name: products.name, sku: products.sku }).from(products).where(eq(products.id, productId)).limit(1);
  return `Stok tersedia ${p?.name ?? productId} (${p?.sku ?? ''}) tidak mencukupi — tersedia ${available}`;
}

async function defaultMinStock(tx: Tx, branchId: string) {
  const [b] = await tx.select({ type: branches.type }).from(branches).where(eq(branches.id, branchId)).limit(1);
  if (b?.type !== 'branch') return 0;
  return Number(await getConfig<number>('stock.default_min_stock_branch', await branchCountry(branchId))) || 0;
}

export async function nextDocNo(tx: Tx | typeof db, prefix: string) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('stock_doc_seq')::text as seq`);
  const d = new Date();
  return `${prefix}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Reservasi untuk order (dipakai modul order & kredit)
// ---------------------------------------------------------------------------
export const reserveStock = (tx: Tx, productId: string, branchId: string, qty: number, ref: { refType: string; refId: string; refNo?: string }, actorId?: string) =>
  applyMovement(tx, { productId, branchId, type: 'reserve', reservedDelta: qty, ...ref, actorId });
export const releaseStock = (tx: Tx, productId: string, branchId: string, qty: number, ref: { refType: string; refId: string; refNo?: string }, actorId?: string) =>
  applyMovement(tx, { productId, branchId, type: 'release', reservedDelta: -qty, ...ref, actorId });
/** Barang yang sudah direservasi keluar (diserahkan ke nasabah / kurir). */
export const commitReservedOut = (tx: Tx, productId: string, branchId: string, qty: number, ref: { refType: string; refId: string; refNo?: string }, actorId?: string) =>
  applyMovement(tx, { productId, branchId, type: 'sale_out', qty: -qty, reservedDelta: -qty, ...ref, actorId });

// ---------------------------------------------------------------------------
// Hak akses lokasi
// ---------------------------------------------------------------------------
export const HQ_STOCK_ROLES = ['warehouse', 'admin', 'biz-mgr', 'super-admin'];
export const BRANCH_STOCK_ROLES = ['branch-admin', 'branch-manager'];

/** Lokasi yang boleh dilihat user; null = semua lokasi. */
export function visibleBranchId(user: AuthUser): string | null {
  if (HQ_STOCK_ROLES.includes(user.roleCode)) return null;
  if (BRANCH_STOCK_ROLES.includes(user.roleCode) && user.branch) return user.branch.id;
  throw new HttpError(403, 'Anda tidak memiliki akses ke data stok');
}

/** Boleh mengubah stok fisik lokasi ini? Gudang Pusat untuk Pusat, Admin Cabang untuk cabangnya. */
export function assertCanOperate(user: AuthUser, branchId: string) {
  if (user.roleCode === 'warehouse' && user.branch?.type === 'head_office' && user.branch.id === branchId) return;
  if (user.roleCode === 'branch-admin' && user.branch?.id === branchId) return;
  throw new HttpError(403, 'Anda hanya dapat mengelola stok di lokasi tugas Anda');
}

async function headOffice(tx: Tx | typeof db) {
  const [ho] = await tx.select().from(branches).where(eq(branches.type, 'head_office')).limit(1);
  if (!ho) throw new HttpError(500, 'Kantor Pusat belum dibuat (jalankan pnpm db:seed)');
  return ho;
}

async function notifyUsers(tx: Tx | typeof db, where: ReturnType<typeof eq>, exceptId: string | null, title: string, body: string) {
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), where));
  const targets = rows.map((r) => r.id).filter((id) => id !== exceptId);
  if (targets.length) await tx.insert(notifications).values(targets.map((userId) => ({ userId, title, body })));
}
const roleAt = (role: string, branchId: string) => and(eq(users.roleCode, role), eq(users.branchId, branchId))!;

// ---------------------------------------------------------------------------
// Penerimaan barang dari supplier
// ---------------------------------------------------------------------------
export interface LineQty { productId: string; qty: number }

function assertLines(items: LineQty[]) {
  const ids = new Set<string>();
  for (const i of items) {
    if (ids.has(i.productId)) throw new HttpError(400, 'Produk yang sama tercantum lebih dari sekali');
    ids.add(i.productId);
  }
}

export async function receiveGoods(actor: AuthUser, input: { supplierId?: string | null; supplierName?: string; supplierRef?: string | null; note?: string | null; items: (LineQty & { unitCost?: number | null })[] }) {
  const ho = await headOffice(db);
  let supplierName = (input.supplierName ?? '').trim();
  if (input.supplierId) {
    const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
    if (!sup || !sup.isActive) throw new HttpError(400, 'Pemasok tidak ditemukan / nonaktif');
    if (sup.countryCode !== actor.branch?.countryCode) throw new HttpError(400, 'Pemasok terdaftar untuk negara lain');
    supplierName = sup.name;
  }
  if (supplierName.length < 2) throw new HttpError(400, 'Pilih pemasok (atau isi nama pemasok)');
  // Cabang luar negeri (mis. Malaysia, Brunei) menerima barang langsung dari pemasok lokal — mata uang & bea masuk berbeda
  const regional = actor.roleCode === 'branch-admin' && actor.branch?.type === 'branch' && actor.branch.countryCode !== ho.countryCode;
  if (!regional && (actor.roleCode !== 'warehouse' || actor.branch?.type !== 'head_office')) throw new HttpError(403, 'Penerimaan barang supplier dilakukan Warehouse Pusat (atau Admin Cabang di luar negeri)');
  assertLines(input.items);
  return db.transaction(async (tx) => {
    const grNo = await nextDocNo(tx, 'GR');
    const [gr] = await tx.insert(goodsReceipts).values({
      grNo, branchId: actor.branch!.id, supplierName, supplierId: input.supplierId ?? null, supplierRef: input.supplierRef ?? null,
      note: input.note ?? null, createdBy: actor.id,
    }).returning();
    await tx.insert(goodsReceiptItems).values(input.items.map((i) => ({ receiptId: gr.id, productId: i.productId, qty: i.qty, unitCost: i.unitCost ?? null })));
    for (const i of input.items) {
      await applyMovement(tx, { productId: i.productId, branchId: gr.branchId, type: 'receipt', qty: i.qty, refType: 'goods_receipt', refId: gr.id, refNo: grNo, note: supplierName, actorId: actor.id });
    }
    return gr;
  });
}

// ---------------------------------------------------------------------------
// Transfer stok Pusat -> Cabang
// ---------------------------------------------------------------------------
async function loadTransfer(tx: Tx | typeof db, id: string) {
  const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1);
  if (!t) throw new HttpError(404, 'Transfer tidak ditemukan');
  return t;
}

export function canViewTransfer(user: AuthUser, t: StockTransfer) {
  if (HQ_STOCK_ROLES.includes(user.roleCode)) return true;
  return BRANCH_STOCK_ROLES.includes(user.roleCode) && !!user.branch && (t.toBranchId === user.branch.id || t.fromBranchId === user.branch.id);
}

function assertTransferStatus(t: StockTransfer, allowed: StockTransfer['status'][], action: string) {
  if (!allowed.includes(t.status)) throw new HttpError(409, `Transfer ${t.transferNo} berstatus "${t.status}" tidak dapat ${action}`);
}

/**
 * - Admin Cabang  : mengajukan permintaan stok dari Pusat ke cabangnya (perlu persetujuan Manager Cabang bila diatur).
 * - Warehouse Pusat: mendorong stok ke cabang (langsung berstatus disetujui).
 */
export async function createTransfer(actor: AuthUser, input: { toBranchId?: string; note?: string | null; items: LineQty[] }) {
  assertLines(input.items);
  const ho = await headOffice(db);
  let toBranchId: string;
  let status: StockTransfer['status'];
  if (actor.roleCode === 'branch-admin') {
    if (!actor.branch || actor.branch.type !== 'branch') throw new HttpError(403, 'Admin Cabang harus ditempatkan di cabang');
    toBranchId = actor.branch.id;
    const needApproval = await getConfig<boolean>('stock.transfer_requires_branch_manager_approval', await branchCountry(actor.branch.id));
    status = needApproval ? 'requested' : 'approved';
  } else if (actor.roleCode === 'warehouse' && actor.branch?.type === 'head_office') {
    if (!input.toBranchId) throw new HttpError(400, 'Pilih cabang tujuan');
    toBranchId = input.toBranchId;
    status = 'approved';
  } else {
    throw new HttpError(403, 'Hanya Admin Cabang atau Warehouse Pusat yang dapat membuat transfer');
  }
  const [dest] = await db.select().from(branches).where(eq(branches.id, toBranchId)).limit(1);
  if (!dest || dest.type !== 'branch' || !dest.isActive) throw new HttpError(400, 'Cabang tujuan tidak valid');
  if (dest.countryCode !== ho.countryCode) throw new HttpError(400, `Transfer lintas negara tidak didukung — cabang ${dest.name} menerima barang langsung dari pemasok lokal (menu Penerimaan Barang)`);

  return db.transaction(async (tx) => {
    const transferNo = await nextDocNo(tx, 'TRF');
    const [t] = await tx.insert(stockTransfers).values({
      transferNo, fromBranchId: ho.id, toBranchId, status, requestNote: input.note ?? null, requestedBy: actor.id,
      ...(status === 'approved' ? { approvedBy: actor.id, approvedAt: new Date() } : {}),
    }).returning();
    await tx.insert(stockTransferItems).values(input.items.map((i) => ({ transferId: t.id, productId: i.productId, qtyRequested: i.qty })));
    if (status === 'requested') {
      await notifyUsers(tx, roleAt('branch-manager', toBranchId), actor.id, `Permintaan stok ${transferNo} menunggu persetujuan`, `${actor.fullName} mengajukan ${input.items.length} item untuk ${dest.name}.`);
    } else {
      await notifyUsers(tx, roleAt('warehouse', ho.id), actor.id, `Transfer ${transferNo} siap dikirim ke ${dest.name}`, input.note ?? '');
    }
    return t;
  });
}

export async function approveTransfer(actor: AuthUser, id: string, approve: boolean, reason?: string) {
  const t = await loadTransfer(db, id);
  if (actor.roleCode !== 'branch-manager' || actor.branch?.id !== t.toBranchId) throw new HttpError(403, 'Persetujuan dilakukan Manager Cabang tujuan');
  assertTransferStatus(t, ['requested'], approve ? 'disetujui' : 'ditolak');
  if (!approve && !reason?.trim()) throw new HttpError(400, 'Isi alasan penolakan');
  return db.transaction(async (tx) => {
    const [after] = await tx.update(stockTransfers).set(approve
      ? { status: 'approved', approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() }
      : { status: 'rejected', approvedBy: actor.id, approvedAt: new Date(), rejectReason: reason, updatedAt: new Date() })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, 'requested'))).returning();
    if (!after) throw new HttpError(409, `Transfer ${t.transferNo} sudah diproses`);
    if (approve) await notifyUsers(tx, roleAt('warehouse', t.fromBranchId), actor.id, `Transfer ${t.transferNo} disetujui, siap dikirim`, `Disetujui ${actor.fullName}`);
    await notifyUsers(tx, eq(users.id, t.requestedBy), actor.id, `Permintaan stok ${t.transferNo} ${approve ? 'disetujui' : 'ditolak'}`, approve ? 'Menunggu pengiriman Gudang Pusat' : reason!);
    return after;
  });
}

export async function shipTransfer(actor: AuthUser, id: string, input: { shipmentRef?: string | null; items: LineQty[] }) {
  const t = await loadTransfer(db, id);
  assertCanOperate(actor, t.fromBranchId);
  assertTransferStatus(t, ['approved'], 'dikirim');
  const lines = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
  const byId = new Map(input.items.map((i) => [i.productId, i.qty]));
  if (lines.every((l) => (byId.get(l.productId) ?? 0) <= 0)) throw new HttpError(400, 'Minimal satu item harus dikirim');
  return db.transaction(async (tx) => {
    for (const l of lines) {
      const q = byId.get(l.productId) ?? 0;
      if (q < 0 || q > l.qtyRequested) throw new HttpError(400, 'Jumlah kirim tidak boleh melebihi jumlah diminta');
      await tx.update(stockTransferItems).set({ qtyShipped: q }).where(and(eq(stockTransferItems.transferId, id), eq(stockTransferItems.productId, l.productId)));
      if (q > 0) await applyMovement(tx, { productId: l.productId, branchId: t.fromBranchId, type: 'transfer_out', qty: -q, refType: 'transfer', refId: id, refNo: t.transferNo, actorId: actor.id });
    }
    const [after] = await tx.update(stockTransfers).set({ status: 'shipped', shippedBy: actor.id, shippedAt: new Date(), shipmentRef: input.shipmentRef ?? null, updatedAt: new Date() })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, 'approved'))).returning();
    if (!after) throw new HttpError(409, `Transfer ${t.transferNo} sudah dikirim / dibatalkan`);
    await notifyUsers(tx, roleAt('branch-admin', t.toBranchId), actor.id, `Transfer ${t.transferNo} dalam perjalanan`, input.shipmentRef ? `Armada/resi: ${input.shipmentRef}` : 'Mohon cek & terima saat barang tiba.');
    return after;
  });
}

export async function receiveTransfer(actor: AuthUser, id: string, input: { note?: string | null; items: LineQty[] }) {
  const t = await loadTransfer(db, id);
  assertCanOperate(actor, t.toBranchId);
  assertTransferStatus(t, ['shipped'], 'diterima');
  const lines = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
  const byId = new Map(input.items.map((i) => [i.productId, i.qty]));
  let discrepancy = false;
  return db.transaction(async (tx) => {
    for (const l of lines) {
      const shipped = l.qtyShipped ?? 0;
      const q = byId.get(l.productId) ?? shipped;
      if (q < 0 || q > shipped) throw new HttpError(400, 'Jumlah diterima tidak boleh melebihi jumlah dikirim');
      if (q !== shipped) discrepancy = true;
      await tx.update(stockTransferItems).set({ qtyReceived: q }).where(and(eq(stockTransferItems.transferId, id), eq(stockTransferItems.productId, l.productId)));
      if (q > 0) await applyMovement(tx, { productId: l.productId, branchId: t.toBranchId, type: 'transfer_in', qty: q, refType: 'transfer', refId: id, refNo: t.transferNo, actorId: actor.id });
    }
    if (discrepancy && !input.note?.trim()) throw new HttpError(400, 'Jumlah diterima berbeda dari yang dikirim — isi catatan selisih');
    const [after] = await tx.update(stockTransfers).set({ status: 'received', receivedBy: actor.id, receivedAt: new Date(), receiveNote: input.note ?? null, hasDiscrepancy: discrepancy, updatedAt: new Date() })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, 'shipped'))).returning();
    if (!after) throw new HttpError(409, `Transfer ${t.transferNo} sudah diterima`);
    const title = discrepancy ? `Transfer ${t.transferNo} diterima DENGAN SELISIH` : `Transfer ${t.transferNo} diterima lengkap`;
    await notifyUsers(tx, roleAt('warehouse', t.fromBranchId), actor.id, title, input.note ?? '');
    if (discrepancy) await notifyUsers(tx, roleAt('branch-manager', t.toBranchId), actor.id, title, input.note ?? '');
    return after;
  });
}

export async function cancelTransfer(actor: AuthUser, id: string, reason: string) {
  const t = await loadTransfer(db, id);
  const isRequester = actor.id === t.requestedBy;
  const isHqWarehouse = actor.roleCode === 'warehouse' && actor.branch?.id === t.fromBranchId;
  if (!isRequester && !isHqWarehouse) throw new HttpError(403, 'Hanya pembuat permintaan atau Gudang Pusat yang dapat membatalkan');
  assertTransferStatus(t, ['requested', 'approved'], 'dibatalkan');
  const [after] = await db.update(stockTransfers).set({ status: 'cancelled', rejectReason: reason, updatedAt: new Date() })
    .where(and(eq(stockTransfers.id, id), inArray(stockTransfers.status, ['requested', 'approved']))).returning();
  if (!after) throw new HttpError(409, `Transfer ${t.transferNo} sudah dikirim`);
  return after;
}

// ---------------------------------------------------------------------------
// Penyesuaian / stock opname
// ---------------------------------------------------------------------------
export async function adjustStock(actor: AuthUser, input: { branchId: string; reason: typeof stockAdjustments.$inferInsert['reason']; note?: string | null; items: { productId: string; countedQty: number }[] }) {
  assertCanOperate(actor, input.branchId);
  assertLines(input.items.map((i) => ({ productId: i.productId, qty: i.countedQty })));
  if (input.reason !== 'opname' && !input.note?.trim()) throw new HttpError(400, 'Isi keterangan penyesuaian');
  return db.transaction(async (tx) => {
    const adjNo = await nextDocNo(tx, 'ADJ');
    const [adj] = await tx.insert(stockAdjustments).values({ adjNo, branchId: input.branchId, reason: input.reason, note: input.note ?? null, createdBy: actor.id }).returning();
    for (const i of input.items) {
      await tx.insert(stockLevels).values({ productId: i.productId, branchId: input.branchId }).onConflictDoNothing();
      const { rows: [lvl] } = await tx.execute<{ on_hand: number; reserved: number }>(
        sql`select on_hand, reserved from stock_levels where product_id = ${i.productId} and branch_id = ${input.branchId} for update`);
      if (i.countedQty < lvl.reserved) throw new HttpError(409, `Jumlah fisik tidak boleh lebih kecil dari stok yang sudah dipesan (${lvl.reserved})`);
      await tx.insert(stockAdjustmentItems).values({ adjustmentId: adj.id, productId: i.productId, systemQty: lvl.on_hand, countedQty: i.countedQty });
      const diff = i.countedQty - lvl.on_hand;
      if (diff !== 0) await applyMovement(tx, { productId: i.productId, branchId: input.branchId, type: 'adjustment', qty: diff, refType: 'adjustment', refId: adj.id, refNo: adjNo, note: input.note ?? input.reason, actorId: actor.id });
    }
    return adj;
  });
}
