import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, countries, productCategories, productPrices, products, stockLevels } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

/** Master produk & kategori. Dikelola System Admin; dibaca staf terkait stok/penjualan. */
export const productsRouter = Router();

const MANAGE = requireRole('admin', 'super-admin');
const READ = requireRole('admin', 'super-admin', 'warehouse', 'biz-mgr', 'branch-manager', 'branch-admin', 'support');

// ---------------- Kategori ----------------
productsRouter.get('/product-categories', READ, async (_req, res) => {
  const rows = await db.select({
    id: productCategories.id, code: productCategories.code, name: productCategories.name, group: productCategories.group,
    sortOrder: productCategories.sortOrder, isActive: productCategories.isActive,
    productCount: sql<number>`(select count(*)::int from "products" p where p."category_id" = "product_categories"."id")`,
  }).from(productCategories).orderBy(asc(productCategories.group), asc(productCategories.sortOrder), asc(productCategories.name));
  res.json({ categories: rows });
});

const categorySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/, 'Kode 2-32 huruf/angka'),
  name: z.string().trim().min(2).max(80),
  group: z.enum(['electronics', 'furniture'], 'Pilih Elektronik atau Furniture'),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

productsRouter.post('/product-categories', MANAGE, async (req, res) => {
  const body = parseBody(categorySchema, req.body);
  const [dup] = await db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.code, body.code)).limit(1);
  if (dup) throw new HttpError(409, 'Kode kategori sudah dipakai');
  const [c] = await db.insert(productCategories).values(body).returning();
  await writeAudit(req, { action: 'category.create', entityType: 'category', entityId: c.id, after: c });
  res.status(201).json({ category: c });
});

productsRouter.patch('/product-categories/:id', MANAGE, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = parseBody(categorySchema.omit({ code: true }).partial(), req.body);
  const [c] = await db.update(productCategories).set(body).where(eq(productCategories.id, id)).returning();
  if (!c) throw new HttpError(404, 'Kategori tidak ditemukan');
  await writeAudit(req, { action: 'category.update', entityType: 'category', entityId: id, after: body });
  res.json({ category: c });
});

// ---------------- Produk ----------------
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(['draft', 'active', 'inactive']).optional(),
  country: z.string().length(2).toUpperCase().default('ID'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

productsRouter.get('/products', READ, async (req, res) => {
  const q = parseBody(listQuery, req.query);
  const where: SQL[] = [];
  if (q.search) { const s = `%${q.search}%`; where.push(or(ilike(products.name, s), ilike(products.sku, s), ilike(products.brand, s))!); }
  if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
  if (q.status) where.push(eq(products.status, q.status));
  const cond = where.length ? and(...where) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: products.id, sku: products.sku, name: products.name, brand: products.brand, status: products.status,
      categoryId: products.categoryId, categoryName: productCategories.name, categoryGroup: productCategories.group,
      images: products.images, warrantyMonths: products.warrantyMonths, isBulky: products.isBulky,
      cashPrice: productPrices.cashPrice, updatedAt: products.updatedAt,
      totalOnHand: sql<number>`coalesce((select sum(s."on_hand")::int from "stock_levels" s where s."product_id" = "products"."id"), 0)`,
      totalAvailable: sql<number>`coalesce((select sum(s."on_hand" - s."reserved")::int from "stock_levels" s where s."product_id" = "products"."id"), 0)`,
    }).from(products)
      .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
      .leftJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, q.country)))
      .where(cond).orderBy(desc(products.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(products).where(cond),
  ]);
  res.json({ products: rows, total, page: q.page, pageSize: q.pageSize });
});

productsRouter.get('/products/:id', READ, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [p] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  const [prices, stock] = await Promise.all([
    db.select().from(productPrices).where(eq(productPrices.productId, id)),
    db.select({
      branchId: branches.id, branchCode: branches.code, branchName: branches.name, branchType: branches.type,
      onHand: stockLevels.onHand, reserved: stockLevels.reserved, minStock: stockLevels.minStock,
    }).from(stockLevels).innerJoin(branches, eq(branches.id, stockLevels.branchId))
      .where(eq(stockLevels.productId, id)).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code)),
  ]);
  res.json({ product: p, prices, stock });
});

const productSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, 'SKU 3-40 huruf/angka/tanda hubung'),
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(200),
  brand: z.string().trim().max(60).default(''),
  categoryId: z.uuid('Pilih kategori'),
  description: z.string().trim().max(5000).default(''),
  specs: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  images: z.array(z.url('URL gambar tidak valid')).max(10).default([]),
  weightKg: z.number().min(0).max(5000).default(0),
  lengthCm: z.number().int().min(0).max(1000).default(0),
  widthCm: z.number().int().min(0).max(1000).default(0),
  heightCm: z.number().int().min(0).max(1000).default(0),
  isBulky: z.boolean().default(false),
  requiresInstallation: z.boolean().default(false),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  status: z.enum(['draft', 'active', 'inactive']).default('draft'),
});

async function assertCanActivate(productId: string) {
  const [price] = await db.select().from(productPrices).where(and(eq(productPrices.productId, productId), eq(productPrices.countryCode, 'ID'))).limit(1);
  if (!price) throw new HttpError(400, 'Isi harga tunai Indonesia sebelum produk diaktifkan');
}

productsRouter.post('/products', MANAGE, async (req, res) => {
  const body = parseBody(productSchema.extend({ cashPriceID: z.number().positive('Harga harus lebih dari 0').optional() }), req.body);
  const [dup] = await db.select({ id: products.id }).from(products).where(eq(products.sku, body.sku)).limit(1);
  if (dup) throw new HttpError(409, 'SKU sudah dipakai');
  const { cashPriceID, ...data } = body;
  if (data.status === 'active' && !cashPriceID) throw new HttpError(400, 'Isi harga tunai sebelum produk diaktifkan');
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.insert(products).values({ ...data, createdBy: req.user!.id }).returning();
    if (cashPriceID) await tx.insert(productPrices).values({ productId: row.id, countryCode: 'ID', cashPrice: cashPriceID });
    return row;
  });
  await writeAudit(req, { action: 'product.create', entityType: 'product', entityId: p.id, after: { ...p, cashPriceID } });
  res.status(201).json({ product: p });
});

productsRouter.patch('/products/:id', MANAGE, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = parseBody(productSchema.omit({ sku: true }).partial().refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan'), req.body);
  const [before] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!before) throw new HttpError(404, 'Produk tidak ditemukan');
  if (body.status === 'active' && before.status !== 'active') await assertCanActivate(id);
  const [after] = await db.update(products).set({ ...body, updatedAt: new Date() }).where(eq(products.id, id)).returning();
  await writeAudit(req, { action: 'product.update', entityType: 'product', entityId: id, before, after });
  res.json({ product: after });
});

productsRouter.put('/products/:id/prices/:country', MANAGE, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const country = z.string().length(2).toUpperCase().parse(req.params.country);
  const { cashPrice } = parseBody(z.object({ cashPrice: z.number().positive('Harga harus lebih dari 0') }), req.body);
  const [c] = await db.select().from(countries).where(eq(countries.code, country)).limit(1);
  if (!c) throw new HttpError(400, 'Negara tidak dikenal');
  const [before] = await db.select().from(productPrices).where(and(eq(productPrices.productId, id), eq(productPrices.countryCode, country))).limit(1);
  const [after] = await db.insert(productPrices).values({ productId: id, countryCode: country, cashPrice })
    .onConflictDoUpdate({ target: [productPrices.productId, productPrices.countryCode], set: { cashPrice, updatedAt: new Date() } }).returning();
  await writeAudit(req, { action: 'product.price', entityType: 'product', entityId: id, before: before ?? null, after });
  res.json({ price: after });
});
