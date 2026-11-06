import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, goodsReceipts, supplierInvoices, supplierPayments, suppliers, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { apAging, cancelInvoice, createInvoice, payInvoice, receiptValue, saveSupplier } from '../lib/payables.js';

/** Hutang pemasok: master pemasok, faktur, pembayaran, umur hutang (Bookkeeping). */
export const payablesRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const country = (v: unknown) => z.enum(['ID', 'MY', 'BN']).catch('ID').parse(String(v ?? 'ID').toUpperCase());

const supplierSchema = z.object({
  code: z.string().trim().min(2).max(24), name: z.string().trim().min(2).max(160), countryCode: z.enum(['ID', 'MY', 'BN']),
  taxId: z.string().trim().max(32).nullish(), phone: z.string().trim().max(32).nullish(), email: z.email().nullish().or(z.literal('').transform(() => null)),
  address: z.string().trim().max(400).default(''), bankName: z.string().trim().max(80).nullish(), accountNo: z.string().trim().max(40).nullish(),
  accountName: z.string().trim().max(120).nullish(), paymentTermsDays: z.number().int().min(0).max(365).default(30), isActive: z.boolean().default(true),
});

// Gudang & Admin Cabang luar negeri memilih pemasok saat penerimaan barang
payablesRouter.get('/suppliers', requireRole('finance', 'warehouse', 'branch-admin', 'super-admin', 'biz-mgr'), async (req, res) => {
  const q = parseBody(z.object({ search: z.string().trim().max(60).optional(), country: z.string().optional(), all: z.string().optional() }), req.query);
  const u = req.user!;
  const cc = ['warehouse', 'branch-admin'].includes(u.roleCode) ? u.branch!.countryCode : country(q.country);
  const where: SQL[] = [eq(suppliers.countryCode, cc)];
  if (!q.all) where.push(eq(suppliers.isActive, true));
  if (q.search) where.push(or(ilike(suppliers.name, `%${q.search}%`), ilike(suppliers.code, `%${q.search}%`))!);
  const rows = await db.select({ s: suppliers,
    outstanding: sql<number>`coalesce((select sum(i.total - i.paid_amount) from supplier_invoices i where i.supplier_id = ${suppliers.id} and i.status in ('open','partial')), 0)::float`,
    uninvoiced: sql<number>`(select count(*)::int from goods_receipts g where g.supplier_id = ${suppliers.id} and not exists (select 1 from supplier_invoices i where i.receipt_id = g.id and i.status <> 'cancelled'))`,
  }).from(suppliers).where(and(...where)).orderBy(asc(suppliers.name));
  res.json({ suppliers: rows.map((r) => ({ ...r.s, outstanding: r.outstanding, uninvoiced: r.uninvoiced })) });
});

payablesRouter.post('/suppliers', requireRole('finance', 'warehouse'), async (req, res) => {
  const s = await saveSupplier(req.user!, null, parseBody(supplierSchema, req.body));
  await writeAudit(req, { action: 'supplier.create', entityType: 'supplier', entityId: s.id, after: s });
  res.status(201).json({ supplier: s });
});

payablesRouter.put('/suppliers/:id', requireRole('finance'), async (req, res) => {
  const s = await saveSupplier(req.user!, z.uuid().parse(req.params.id), parseBody(supplierSchema, req.body));
  await writeAudit(req, { action: 'supplier.update', entityType: 'supplier', entityId: s.id, after: s });
  res.json({ supplier: s });
});

const AP = requireRole('finance', 'biz-mgr');

/** Penerimaan barang yang belum difakturkan (untuk mencatat faktur). */
payablesRouter.get('/payables/uninvoiced', AP, async (req, res) => {
  const cc = country(req.query.country);
  const rows = await db.select({ id: goodsReceipts.id, grNo: goodsReceipts.grNo, supplierId: goodsReceipts.supplierId, supplierName: goodsReceipts.supplierName,
    supplierRef: goodsReceipts.supplierRef, createdAt: goodsReceipts.createdAt, branchName: branches.name,
    value: sql<number | null>`(select sum(i.qty * i.unit_cost)::float from goods_receipt_items i where i.receipt_id = ${goodsReceipts.id})`,
    missingCost: sql<boolean>`exists (select 1 from goods_receipt_items i where i.receipt_id = ${goodsReceipts.id} and i.unit_cost is null)` })
    .from(goodsReceipts).innerJoin(branches, eq(branches.id, goodsReceipts.branchId))
    .where(and(eq(branches.countryCode, cc), sql`not exists (select 1 from supplier_invoices i where i.receipt_id = ${goodsReceipts.id} and i.status <> 'cancelled')`))
    .orderBy(desc(goodsReceipts.createdAt)).limit(100);
  res.json({ receipts: rows });
});

payablesRouter.get('/payables/receipt-value/:id', AP, async (req, res) => {
  const r = await receiptValue(z.uuid().parse(req.params.id));
  res.json({ value: r.value, grNo: r.receipt.grNo, supplierId: r.receipt.supplierId, supplierRef: r.receipt.supplierRef });
});

payablesRouter.get('/payables/invoices', AP, async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional(), supplierId: z.uuid().optional(), search: z.string().trim().max(60).optional(), country: z.string().optional() }), req.query);
  const where: SQL[] = [eq(branches.countryCode, country(q.country))];
  if (q.status === 'unpaid') where.push(inArray(supplierInvoices.status, ['open', 'partial']));
  else if (q.status) where.push(eq(supplierInvoices.status, q.status));
  if (q.supplierId) where.push(eq(supplierInvoices.supplierId, q.supplierId));
  if (q.search) { const s = `%${q.search}%`; where.push(or(ilike(supplierInvoices.invoiceNo, s), ilike(supplierInvoices.supplierInvoiceNo, s), ilike(suppliers.name, s))!); }
  const rows = await db.select({ i: supplierInvoices, supplier: suppliers.name, supplierCode: suppliers.code, branchName: branches.name, grNo: goodsReceipts.grNo,
    bankName: suppliers.bankName, accountNo: suppliers.accountNo, accountName: suppliers.accountName })
    .from(supplierInvoices).innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId)).innerJoin(branches, eq(branches.id, supplierInvoices.branchId))
    .leftJoin(goodsReceipts, eq(goodsReceipts.id, supplierInvoices.receiptId)).where(and(...where)).orderBy(asc(supplierInvoices.dueDate)).limit(300);
  res.json({ invoices: rows.map((r) => ({ ...r.i, supplier: r.supplier, supplierCode: r.supplierCode, branchName: r.branchName, grNo: r.grNo, bank: { bankName: r.bankName, accountNo: r.accountNo, accountName: r.accountName }, remaining: Math.round((r.i.total - r.i.paidAmount) * 100) / 100 })) });
});

payablesRouter.get('/payables/invoices/:id', AP, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [inv] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
  if (!inv) throw new HttpError(404, 'Faktur tidak ditemukan');
  const pays = await db.select({ p: supplierPayments, by: users.fullName }).from(supplierPayments).innerJoin(users, eq(users.id, supplierPayments.paidBy))
    .where(eq(supplierPayments.invoiceId, id)).orderBy(asc(supplierPayments.paidAt));
  res.json({ invoice: inv, payments: pays.map((r) => ({ ...r.p, paidByName: r.by })) });
});

payablesRouter.post('/payables/invoices', requireRole('finance'), async (req, res) => {
  const b = parseBody(z.object({ supplierId: z.uuid(), receiptId: z.uuid('Pilih penerimaan barang'), supplierInvoiceNo: z.string().trim().min(2, 'Isi nomor faktur pemasok').max(64),
    invoiceDate: dateStr, dueDate: dateStr.nullish(), subtotal: z.number().positive().nullish(), tax: z.number().min(0).default(0), note: z.string().trim().max(500).nullish() }), req.body);
  const inv = await createInvoice(req.user!, b);
  await writeAudit(req, { action: 'ap.invoice', entityType: 'supplier_invoice', entityId: inv.id, after: inv });
  res.status(201).json({ invoice: inv });
});

payablesRouter.post('/payables/invoices/:id/cancel', requireRole('finance'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Isi alasan') }), req.body);
  res.json({ invoice: await cancelInvoice(req.user!, z.uuid().parse(req.params.id), reason) });
});

payablesRouter.post('/payables/invoices/:id/pay', requireRole('finance'), async (req, res) => {
  const b = parseBody(z.object({ amount: z.number().positive(), method: z.enum(['transfer', 'cash']), bankRef: z.string().trim().max(64).nullish(), paidAt: dateStr.nullish(), note: z.string().trim().max(300).nullish() }), req.body);
  const p = await payInvoice(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: 'ap.payment', entityType: 'supplier_payment', entityId: p.id, after: p });
  res.status(201).json({ payment: p });
});

payablesRouter.get('/payables/aging', AP, async (req, res) => {
  res.json(await apAging(country(req.query.country)));
});

// Penerimaan barang tanpa master pemasok (data lama) — untuk ditautkan
payablesRouter.get('/payables/unlinked-receipts', AP, async (_req, res) => {
  const rows = await db.select({ id: goodsReceipts.id, grNo: goodsReceipts.grNo, supplierName: goodsReceipts.supplierName }).from(goodsReceipts).where(isNull(goodsReceipts.supplierId)).limit(200);
  res.json({ receipts: rows });
});
