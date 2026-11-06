import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, goodsReceiptItems, goodsReceipts, productCategories, products, stockAdjustmentItems, stockAdjustments,
  stockLevels, stockMovements, stockTransferItems, stockTransfers, users,
} from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import {
  BRANCH_STOCK_ROLES, HQ_STOCK_ROLES, adjustStock, approveTransfer, assertCanOperate, canViewTransfer, cancelTransfer,
  createTransfer, receiveGoods, receiveTransfer, shipTransfer, visibleBranchId,
} from '../lib/stock.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireRole(...HQ_STOCK_ROLES, ...BRANCH_STOCK_ROLES));

const lines = z.array(z.object({ productId: z.uuid(), qty: z.number().int().min(0, 'Jumlah tidak boleh negatif') })).min(1, 'Minimal satu item');
const positiveLines = z.array(z.object({ productId: z.uuid(), qty: z.number().int().positive('Jumlah harus lebih dari 0') })).min(1, 'Minimal satu item');

/** Lokasi yang diminta, dibatasi oleh hak akses user. */
function resolveBranch(user: Express.Request['user'], requested?: string) {
  const forced = visibleBranchId(user!);
  if (forced) return forced;
  return requested;
}

// ---------------------------------------------------------------------------
// Posisi stok
// ---------------------------------------------------------------------------
const stockQuery = z.object({
  branchId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  lowOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

inventoryRouter.get('/stock', async (req, res) => {
  const q = parseBody(stockQuery, req.query);
  const branchId = resolveBranch(req.user, q.branchId);
  if (!branchId) throw new HttpError(400, 'Pilih lokasi');
  const where: SQL[] = [sql`${products.status} <> 'draft'`];
  if (q.search) { const s = `%${q.search}%`; where.push(or(ilike(products.name, s), ilike(products.sku, s), ilike(products.brand, s))!); }
  if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
  const onHand = sql<number>`coalesce(${stockLevels.onHand}, 0)`;
  const reserved = sql<number>`coalesce(${stockLevels.reserved}, 0)`;
  const minStock = sql<number>`coalesce(${stockLevels.minStock}, 0)`;
  const isLow = sql<boolean>`(coalesce(${stockLevels.onHand},0) - coalesce(${stockLevels.reserved},0)) <= coalesce(${stockLevels.minStock},0) and coalesce(${stockLevels.minStock},0) > 0`;
  if (q.lowOnly === 'true') where.push(isLow);
  const cond = and(...where);
  const base = () => db.select({
    productId: products.id, sku: products.sku, name: products.name, brand: products.brand, status: products.status,
    categoryName: productCategories.name, onHand, reserved, available: sql<number>`${onHand} - ${reserved}`, minStock, isLow,
  }).from(products)
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.branchId, branchId)));
  const [rows, [{ total }]] = await Promise.all([
    base().where(cond).orderBy(desc(isLow), asc(products.name)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(products)
      .leftJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.branchId, branchId))).where(cond),
  ]);
  res.json({ branchId, stock: rows, total, page: q.page, pageSize: q.pageSize });
});

/** Ringkasan stok per lokasi (dashboard Gudang Pusat / cabang). */
inventoryRouter.get('/summary', async (req, res) => {
  const forced = visibleBranchId(req.user!);
  const scope = forced ? eq(branches.id, forced) : undefined;
  const rows = await db.select({
    branchId: branches.id, branchCode: branches.code, branchName: branches.name, branchType: branches.type,
    skuInStock: sql<number>`count(${stockLevels.productId}) filter (where ${stockLevels.onHand} > 0)::int`,
    units: sql<number>`coalesce(sum(${stockLevels.onHand}), 0)::int`,
    reserved: sql<number>`coalesce(sum(${stockLevels.reserved}), 0)::int`,
    lowCount: sql<number>`count(*) filter (where ${stockLevels.minStock} > 0 and ${stockLevels.onHand} - ${stockLevels.reserved} <= ${stockLevels.minStock})::int`,
  }).from(branches).leftJoin(stockLevels, eq(stockLevels.branchId, branches.id))
    .where(scope ? and(eq(branches.isActive, true), scope) : eq(branches.isActive, true))
    .groupBy(branches.id).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code));
  const tScope = forced ? or(eq(stockTransfers.toBranchId, forced), eq(stockTransfers.fromBranchId, forced)) : undefined;
  const transfers = await db.select({ status: stockTransfers.status, n: count() }).from(stockTransfers)
    .where(tScope ? and(tScope, inArray(stockTransfers.status, ['requested', 'approved', 'shipped'])) : inArray(stockTransfers.status, ['requested', 'approved', 'shipped']))
    .groupBy(stockTransfers.status);
  res.json({ locations: rows, transfers });
});

/** Posisi satu produk di semua lokasi yang boleh dilihat. */
inventoryRouter.get('/stock/:productId/locations', async (req, res) => {
  const productId = z.uuid().parse(req.params.productId);
  const forced = visibleBranchId(req.user!);
  const rows = await db.select({
    branchId: branches.id, branchCode: branches.code, branchName: branches.name, branchType: branches.type,
    onHand: sql<number>`coalesce(${stockLevels.onHand},0)`, reserved: sql<number>`coalesce(${stockLevels.reserved},0)`,
    minStock: sql<number>`coalesce(${stockLevels.minStock},0)`,
  }).from(branches).leftJoin(stockLevels, and(eq(stockLevels.branchId, branches.id), eq(stockLevels.productId, productId)))
    .where(forced ? eq(branches.id, forced) : eq(branches.isActive, true)).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code));
  res.json({ locations: rows });
});

inventoryRouter.put('/min-stock', async (req, res) => {
  const body = parseBody(z.object({ productId: z.uuid(), branchId: z.uuid(), minStock: z.number().int().min(0).max(100000) }), req.body);
  assertCanOperate(req.user!, body.branchId);
  await db.insert(stockLevels).values(body).onConflictDoUpdate({
    target: [stockLevels.productId, stockLevels.branchId], set: { minStock: body.minStock, updatedAt: new Date() },
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Kartu stok
// ---------------------------------------------------------------------------
const actor = aliasedTable(users, 'actor');
inventoryRouter.get('/movements', async (req, res) => {
  const q = parseBody(z.object({ productId: z.uuid(), branchId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  const branchId = resolveBranch(req.user, q.branchId);
  const where = [eq(stockMovements.productId, q.productId)];
  if (branchId) where.push(eq(stockMovements.branchId, branchId));
  const rows = await db.select({
    id: stockMovements.id, type: stockMovements.type, qty: stockMovements.qty, reservedDelta: stockMovements.reservedDelta,
    onHandAfter: stockMovements.onHandAfter, reservedAfter: stockMovements.reservedAfter, refType: stockMovements.refType,
    refNo: stockMovements.refNo, note: stockMovements.note, createdAt: stockMovements.createdAt,
    branchCode: branches.code, branchName: branches.name, actorName: actor.fullName,
  }).from(stockMovements).innerJoin(branches, eq(branches.id, stockMovements.branchId))
    .leftJoin(actor, eq(actor.id, stockMovements.actorId))
    .where(and(...where)).orderBy(desc(stockMovements.id)).limit(q.limit);
  res.json({ movements: rows });
});

// ---------------------------------------------------------------------------
// Penerimaan barang supplier (Gudang Pusat)
// ---------------------------------------------------------------------------
inventoryRouter.get('/receipts', async (req, res) => {
  const forced = visibleBranchId(req.user!);
  const rows = await db.select({
    id: goodsReceipts.id, grNo: goodsReceipts.grNo, supplierName: goodsReceipts.supplierName, supplierId: goodsReceipts.supplierId, supplierRef: goodsReceipts.supplierRef,
    invoiceNo: sql<string | null>`(select si.invoice_no from supplier_invoices si where si.receipt_id = "goods_receipts"."id" and si.status <> 'cancelled' limit 1)`,
    value: sql<number | null>`(select sum(i.qty * i.unit_cost)::float from goods_receipt_items i where i.receipt_id = "goods_receipts"."id")`,
    note: goodsReceipts.note, createdAt: goodsReceipts.createdAt, createdByName: users.fullName, branchName: branches.name,
    itemCount: sql<number>`(select count(*)::int from "goods_receipt_items" i where i."receipt_id" = "goods_receipts"."id")`,
    units: sql<number>`(select coalesce(sum(i."qty"),0)::int from "goods_receipt_items" i where i."receipt_id" = "goods_receipts"."id")`,
  }).from(goodsReceipts).innerJoin(users, eq(users.id, goodsReceipts.createdBy)).innerJoin(branches, eq(branches.id, goodsReceipts.branchId))
    .where(forced ? eq(goodsReceipts.branchId, forced) : undefined).orderBy(desc(goodsReceipts.createdAt)).limit(50);
  res.json({ receipts: rows });
});

inventoryRouter.get('/receipts/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1);
  const forced = visibleBranchId(req.user!);
  if (!gr || (forced && gr.branchId !== forced)) throw new HttpError(404, 'Penerimaan tidak ditemukan');
  const items = await db.select({ productId: products.id, sku: products.sku, name: products.name, qty: goodsReceiptItems.qty, unitCost: goodsReceiptItems.unitCost })
    .from(goodsReceiptItems).innerJoin(products, eq(products.id, goodsReceiptItems.productId)).where(eq(goodsReceiptItems.receiptId, id));
  res.json({ receipt: gr, items });
});

inventoryRouter.post('/receipts', async (req, res) => {
  const body = parseBody(z.object({
    supplierId: z.uuid().nullish(),
    supplierName: z.string().trim().max(120).default(''),
    supplierRef: z.string().trim().max(64).nullish(),
    note: z.string().trim().max(1000).nullish(),
    items: z.array(z.object({ productId: z.uuid(), qty: z.number().int().positive('Jumlah harus lebih dari 0'), unitCost: z.number().min(0).nullish() })).min(1, 'Minimal satu item'),
  }), req.body);
  res.status(201).json({ receipt: await receiveGoods(req.user!, body) });
});

// ---------------------------------------------------------------------------
// Transfer stok
// ---------------------------------------------------------------------------
const fromB = aliasedTable(branches, 'from_b');
const toB = aliasedTable(branches, 'to_b');
const requester = aliasedTable(users, 'requester');

inventoryRouter.get('/transfers', async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional(), active: z.enum(['true', 'false']).optional() }), req.query);
  const forced = visibleBranchId(req.user!);
  const where: SQL[] = [];
  if (forced) where.push(or(eq(stockTransfers.toBranchId, forced), eq(stockTransfers.fromBranchId, forced))!);
  if (q.active === 'true') where.push(inArray(stockTransfers.status, ['requested', 'approved', 'shipped']));
  if (q.status) where.push(sql`${stockTransfers.status} = ${q.status}`);
  const rows = await db.select({
    id: stockTransfers.id, transferNo: stockTransfers.transferNo, status: stockTransfers.status,
    fromBranchName: fromB.name, toBranchId: stockTransfers.toBranchId, toBranchName: toB.name, toBranchCode: toB.code,
    requestNote: stockTransfers.requestNote, requestedByName: requester.fullName, hasDiscrepancy: stockTransfers.hasDiscrepancy,
    shipmentRef: stockTransfers.shipmentRef, createdAt: stockTransfers.createdAt, updatedAt: stockTransfers.updatedAt,
    itemCount: sql<number>`(select count(*)::int from "stock_transfer_items" i where i."transfer_id" = "stock_transfers"."id")`,
    units: sql<number>`(select coalesce(sum(i."qty_requested"),0)::int from "stock_transfer_items" i where i."transfer_id" = "stock_transfers"."id")`,
  }).from(stockTransfers)
    .innerJoin(fromB, eq(fromB.id, stockTransfers.fromBranchId)).innerJoin(toB, eq(toB.id, stockTransfers.toBranchId))
    .innerJoin(requester, eq(requester.id, stockTransfers.requestedBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case ${stockTransfers.status} when 'requested' then 0 when 'approved' then 1 when 'shipped' then 2 else 3 end`, desc(stockTransfers.updatedAt))
    .limit(100);
  res.json({ transfers: rows });
});

inventoryRouter.get('/transfers/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1);
  if (!t || !canViewTransfer(req.user!, t)) throw new HttpError(404, 'Transfer tidak ditemukan');
  const [items, [names]] = await Promise.all([
    db.select({
      productId: products.id, sku: products.sku, name: products.name, qtyRequested: stockTransferItems.qtyRequested,
      qtyShipped: stockTransferItems.qtyShipped, qtyReceived: stockTransferItems.qtyReceived,
      fromAvailable: sql<number>`coalesce((select s."on_hand" - s."reserved" from "stock_levels" s where s."product_id" = "products"."id" and s."branch_id" = ${t.fromBranchId}), 0)`,
      toAvailable: sql<number>`coalesce((select s."on_hand" - s."reserved" from "stock_levels" s where s."product_id" = "products"."id" and s."branch_id" = ${t.toBranchId}), 0)`,
    }).from(stockTransferItems).innerJoin(products, eq(products.id, stockTransferItems.productId)).where(eq(stockTransferItems.transferId, id)),
    db.select({
      fromName: sql<string>`(select name from branches where id = ${t.fromBranchId})`,
      toName: sql<string>`(select name from branches where id = ${t.toBranchId})`,
      requestedBy: sql<string>`(select full_name from users where id = ${t.requestedBy})`,
      approvedBy: sql<string | null>`(select full_name from users where id = ${t.approvedBy})`,
      shippedBy: sql<string | null>`(select full_name from users where id = ${t.shippedBy})`,
      receivedBy: sql<string | null>`(select full_name from users where id = ${t.receivedBy})`,
    }).from(sql`(select 1) x`),
  ]);
  res.json({ transfer: t, items, names });
});

inventoryRouter.post('/transfers', async (req, res) => {
  const body = parseBody(z.object({ toBranchId: z.uuid().optional(), note: z.string().trim().max(1000).nullish(), items: positiveLines }), req.body);
  res.status(201).json({ transfer: await createTransfer(req.user!, body) });
});

const tid = (raw: unknown) => z.uuid().parse(raw);
inventoryRouter.post('/transfers/:id/approve', async (req, res) => {
  res.json({ transfer: await approveTransfer(req.user!, tid(req.params.id), true) });
});
inventoryRouter.post('/transfers/:id/reject', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Isi alasan penolakan') }), req.body);
  res.json({ transfer: await approveTransfer(req.user!, tid(req.params.id), false, reason) });
});
inventoryRouter.post('/transfers/:id/ship', async (req, res) => {
  const body = parseBody(z.object({ shipmentRef: z.string().trim().max(64).nullish(), items: lines }), req.body);
  res.json({ transfer: await shipTransfer(req.user!, tid(req.params.id), body) });
});
inventoryRouter.post('/transfers/:id/receive', async (req, res) => {
  const body = parseBody(z.object({ note: z.string().trim().max(1000).nullish(), items: lines }), req.body);
  res.json({ transfer: await receiveTransfer(req.user!, tid(req.params.id), body) });
});
inventoryRouter.post('/transfers/:id/cancel', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Isi alasan pembatalan') }), req.body);
  res.json({ transfer: await cancelTransfer(req.user!, tid(req.params.id), reason) });
});

// ---------------------------------------------------------------------------
// Penyesuaian / stock opname
// ---------------------------------------------------------------------------
inventoryRouter.get('/adjustments', async (req, res) => {
  const forced = visibleBranchId(req.user!);
  const rows = await db.select({
    id: stockAdjustments.id, adjNo: stockAdjustments.adjNo, reason: stockAdjustments.reason, note: stockAdjustments.note,
    createdAt: stockAdjustments.createdAt, createdByName: users.fullName, branchName: branches.name,
    netDiff: sql<number>`(select coalesce(sum(i."counted_qty" - i."system_qty"),0)::int from "stock_adjustment_items" i where i."adjustment_id" = "stock_adjustments"."id")`,
    itemCount: sql<number>`(select count(*)::int from "stock_adjustment_items" i where i."adjustment_id" = "stock_adjustments"."id")`,
  }).from(stockAdjustments).innerJoin(users, eq(users.id, stockAdjustments.createdBy)).innerJoin(branches, eq(branches.id, stockAdjustments.branchId))
    .where(forced ? eq(stockAdjustments.branchId, forced) : undefined).orderBy(desc(stockAdjustments.createdAt)).limit(50);
  res.json({ adjustments: rows });
});

inventoryRouter.get('/adjustments/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [a] = await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).limit(1);
  const forced = visibleBranchId(req.user!);
  if (!a || (forced && a.branchId !== forced)) throw new HttpError(404, 'Penyesuaian tidak ditemukan');
  const items = await db.select({ sku: products.sku, name: products.name, systemQty: stockAdjustmentItems.systemQty, countedQty: stockAdjustmentItems.countedQty })
    .from(stockAdjustmentItems).innerJoin(products, eq(products.id, stockAdjustmentItems.productId)).where(eq(stockAdjustmentItems.adjustmentId, id));
  res.json({ adjustment: a, items });
});

inventoryRouter.post('/adjustments', async (req, res) => {
  const body = parseBody(z.object({
    branchId: z.uuid().optional(),
    reason: z.enum(['opname', 'damaged', 'lost', 'found', 'other']),
    note: z.string().trim().max(1000).nullish(),
    items: z.array(z.object({ productId: z.uuid(), countedQty: z.number().int().min(0) })).min(1, 'Minimal satu item'),
  }), req.body);
  const branchId = body.branchId ?? req.user!.branch?.id;
  if (!branchId) throw new HttpError(400, 'Pilih lokasi');
  res.status(201).json({ adjustment: await adjustStock(req.user!, { ...body, branchId }) });
});
