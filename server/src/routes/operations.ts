import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, creditApplications, customers, iqalahRequests, products, quarantineItems, suppliers } from '../db/schema.js';
import { parseBody } from '../lib/http.js';
import { requireRole, type AuthUser } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { decideQuarantine, moveToQuarantine, settleClaim } from '../lib/quarantine.js';
import { decideIqalah, paidTowardsGoods, receiveIqalah, requestIqalah, loadAppInBranchScope } from '../lib/credit.js';

/** Karantina barang rusak & klaim pemasok; iqalah (pembatalan akad setelah serah terima). */
export const operationsRouter = Router();

const own = (u: AuthUser) => (u.branch?.type === 'branch' || u.roleCode === 'warehouse' ? u.branch!.id : null);
const scope = (u: AuthUser, col: typeof quarantineItems.branchId | typeof iqalahRequests.branchId): SQL | undefined => {
  if (['biz-mgr', 'finance', 'super-admin', 'support'].includes(u.roleCode)) return undefined;
  const b = own(u);
  return b ? eq(col, b) : undefined;
};

// ---------------------------------------------------------------------------
// Karantina
// ---------------------------------------------------------------------------
const Q_READ = requireRole('warehouse', 'branch-admin', 'branch-manager', 'biz-mgr', 'finance');

operationsRouter.get('/quarantine', Q_READ, async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const sc = scope(req.user!, quarantineItems.branchId); if (sc) where.push(sc);
  if (q.status === 'open') where.push(inArray(quarantineItems.status, ['quarantined', 'claimed']));
  else if (q.status) where.push(eq(quarantineItems.status, q.status));
  const rows = await db.select({ q: quarantineItems, product: products.name, sku: products.sku, branchName: branches.name, supplier: suppliers.name })
    .from(quarantineItems).innerJoin(products, eq(products.id, quarantineItems.productId)).innerJoin(branches, eq(branches.id, quarantineItems.branchId))
    .leftJoin(suppliers, eq(suppliers.id, quarantineItems.supplierId)).where(where.length ? and(...where) : undefined).orderBy(desc(quarantineItems.createdAt)).limit(200);
  res.json({ items: rows.map((r) => ({ ...r.q, product: r.product, sku: r.sku, branchName: r.branchName, supplier: r.supplier, value: Math.round(r.q.unitCost * r.q.qty * 100) / 100 })) });
});

operationsRouter.post('/quarantine', requireRole('warehouse', 'branch-admin'), async (req, res) => {
  const b = parseBody(z.object({ productId: z.uuid(), qty: z.number().int().positive(), note: z.string().trim().min(5, 'Jelaskan kerusakan'), source: z.enum(['opname', 'receipt']).default('opname') }), req.body);
  res.status(201).json({ item: await moveToQuarantine(req.user!, b) });
});

operationsRouter.post('/quarantine/:id/decide', requireRole('warehouse', 'branch-manager', 'biz-mgr'), async (req, res) => {
  const b = parseBody(z.object({ action: z.enum(['restock', 'write_off', 'claim']), note: z.string().trim().min(3, 'Isi catatan keputusan'), supplierId: z.uuid().nullish(), claimAmount: z.number().positive().nullish() }), req.body);
  const item = await decideQuarantine(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: `quarantine.${b.action}`, entityType: 'quarantine', entityId: item.id, after: item });
  res.json({ item });
});

operationsRouter.post('/quarantine/:id/settle', requireRole('finance'), async (req, res) => {
  const b = parseBody(z.object({ method: z.enum(['transfer', 'credit_note']), amount: z.number().min(0), invoiceId: z.uuid().nullish(), ref: z.string().trim().max(64).nullish(), note: z.string().max(300).nullish() }), req.body);
  res.json({ item: await settleClaim(req.user!, z.uuid().parse(req.params.id), b) });
});

// ---------------------------------------------------------------------------
// Iqalah
// ---------------------------------------------------------------------------
operationsRouter.get('/iqalah', requireRole('branch-manager', 'branch-admin', 'biz-mgr', 'finance', 'support', 'cashier'), async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const sc = scope(req.user!, iqalahRequests.branchId); if (sc) where.push(sc);
  if (q.status === 'open') where.push(inArray(iqalahRequests.status, ['requested', 'approved']));
  else if (q.status) where.push(eq(iqalahRequests.status, q.status));
  const rows = await db.select({ q: iqalahRequests, contractNo: creditApplications.contractNo, appNo: creditApplications.appNo, currency: creditApplications.currency,
    customerName: customers.fullName, phone: customers.phone, product: products.name, branchName: branches.name })
    .from(iqalahRequests).innerJoin(creditApplications, eq(creditApplications.id, iqalahRequests.applicationId)).innerJoin(customers, eq(customers.id, creditApplications.customerId))
    .innerJoin(products, eq(products.id, creditApplications.productId)).innerJoin(branches, eq(branches.id, iqalahRequests.branchId))
    .where(where.length ? and(...where) : undefined).orderBy(desc(iqalahRequests.createdAt)).limit(200);
  res.json({ requests: rows.map((r) => ({ ...r.q, contractNo: r.contractNo, appNo: r.appNo, currency: r.currency, customerName: r.customerName, phone: r.phone, product: r.product, branchName: r.branchName })) });
});

/** Simulasi iqalah untuk pembiayaan aktif (dana yang sudah dibayar nasabah). */
operationsRouter.get('/credit/applications/:id/iqalah-preview', requireRole('branch-manager', 'branch-admin', 'biz-mgr'), async (req, res) => {
  const a = await loadAppInBranchScope(req.user!, z.uuid().parse(req.params.id));
  res.json({ paidByCustomer: await paidTowardsGoods(a), currency: a.currency, status: a.status });
});

operationsRouter.post('/credit/applications/:id/iqalah', requireRole('branch-manager', 'branch-admin'), async (req, res) => {
  const b = parseBody(z.object({ reason: z.string().trim().min(10, 'Jelaskan alasan pembatalan (min. 10 karakter)'), proposedDepreciation: z.number().min(0).nullish() }), req.body);
  const r = await requestIqalah(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: 'iqalah.request', entityType: 'iqalah', entityId: r.id, after: r });
  res.status(201).json({ request: r });
});

operationsRouter.post('/iqalah/:id/decide', requireRole('biz-mgr'), async (req, res) => {
  const b = parseBody(z.object({ decision: z.enum(['approve', 'reject']), depreciation: z.number().min(0).nullish(), note: z.string().trim().min(3, 'Isi catatan keputusan') }), req.body);
  const r = await decideIqalah(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: `iqalah.${b.decision}`, entityType: 'iqalah', entityId: r.id, after: r });
  res.json({ request: r });
});

operationsRouter.post('/iqalah/:id/receive', requireRole('branch-admin'), async (req, res) => {
  const b = parseBody(z.object({ condition: z.enum(['good', 'damaged']), note: z.string().max(500).nullish(), refundMethod: z.enum(['cash', 'transfer']).default('transfer'),
    bankName: z.string().trim().max(80).nullish(), accountNo: z.string().trim().max(40).nullish(), accountName: z.string().trim().max(120).nullish() }), req.body);
  res.json({ request: await receiveIqalah(req.user!, z.uuid().parse(req.params.id), b) });
});
