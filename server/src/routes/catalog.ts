import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { countries, productCategories, productPrices, products } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { getConfig } from '../lib/config.js';
import { simulate } from '../lib/murabahah.js';

/** Katalog publik (website & aplikasi nasabah). Hanya produk aktif yang berharga di negara tersebut. */
export const catalogRouter = Router();

async function countryCtx(code: string) {
  const [c] = await db.select().from(countries).where(eq(countries.code, code)).limit(1);
  if (!c || !c.isActive) throw new HttpError(404, 'Negara belum dilayani');
  const [margins, minDp] = await Promise.all([
    getConfig<Record<string, number>>('credit.margin_by_tenor', code),
    getConfig<number>('credit.min_down_payment_pct', code),
  ]);
  return { country: c, margins, minDp: Number(minDp) };
}

const featuredRank = (cc: string) => sql<number | null>`(select f."rank" from "featured_products" f where f."product_id" = "products"."id" and f."country_code" = ${cc} and (f."starts_at" is null or f."starts_at" <= now()) and (f."ends_at" is null or f."ends_at" >= now()) limit 1)`;
const featuredLabel = (cc: string) => sql<string | null>`(select f."label" from "featured_products" f where f."product_id" = "products"."id" and f."country_code" = ${cc} and (f."starts_at" is null or f."starts_at" <= now()) and (f."ends_at" is null or f."ends_at" >= now()) limit 1)`;

const available = sql<number>`coalesce((select sum(s."on_hand" - s."reserved")::int from "stock_levels" s where s."product_id" = "products"."id"), 0)`;

catalogRouter.get('/catalog/categories', async (_req, res) => {
  const rows = await db.select({ id: productCategories.id, code: productCategories.code, name: productCategories.name, group: productCategories.group })
    .from(productCategories).where(eq(productCategories.isActive, true)).orderBy(asc(productCategories.group), asc(productCategories.sortOrder));
  res.json({ categories: rows });
});

catalogRouter.get('/catalog/products', async (req, res) => {
  const q = parseBody(z.object({
    country: z.string().length(2).toUpperCase().default('ID'),
    category: z.string().optional(), // id atau code
    group: z.enum(['electronics', 'furniture']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(24),
    featured: z.enum(['1', 'true']).optional(),
  }), req.query);
  const ctx = await countryCtx(q.country);
  const where: SQL[] = [eq(products.status, 'active'), eq(productCategories.isActive, true)];
  if (q.category) where.push(z.uuid().safeParse(q.category).success ? eq(productCategories.id, q.category) : eq(productCategories.code, q.category.toUpperCase()));
  if (q.group) where.push(eq(productCategories.group, q.group));
  if (q.search) { const s = `%${q.search}%`; where.push(or(ilike(products.name, s), ilike(products.brand, s))!); }
  if (q.featured) where.push(sql`${featuredRank(q.country)} is not null`);
  const cond = and(...where);
  const join = (qb: any) => qb.innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .innerJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, q.country)));
  const [rows, [{ total }]] = await Promise.all([
    join(db.select({
      id: products.id, sku: products.sku, name: products.name, brand: products.brand, specs: products.specs, images: products.images,
      warrantyMonths: products.warrantyMonths, categoryName: productCategories.name, categoryGroup: productCategories.group,
      cashPrice: productPrices.cashPrice, available, featured: featuredLabel(q.country),
    }).from(products)).where(cond).orderBy(desc(sql`${available} > 0`), sql`${featuredRank(q.country)} asc nulls last`, asc(products.name)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    join(db.select({ total: count() }).from(products)).where(cond),
  ]) as [Array<{ id: string; cashPrice: number; available: number } & Record<string, unknown>>, { total: number }[]];

  res.json({
    country: { code: ctx.country.code, currency: ctx.country.currency, locale: ctx.country.locale },
    products: rows.map(({ available: a, ...p }) => {
      const sim = simulate(p.cashPrice, ctx.margins, ctx.minDp, ctx.country.currency);
      const longest = sim[sim.length - 1];
      return { ...p, inStock: a > 0, installmentFrom: longest ? { tenor: longest.tenor, monthly: longest.monthly, downPayment: longest.downPayment } : null };
    }),
    total, page: q.page, pageSize: q.pageSize,
  });
});

catalogRouter.get('/catalog/products/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const country = z.string().length(2).toUpperCase().default('ID').parse(req.query.country);
  const dpPct = z.coerce.number().min(0).max(90).optional().parse(req.query.dpPct);
  const ctx = await countryCtx(country);
  const [p] = await db.select({
    id: products.id, sku: products.sku, name: products.name, brand: products.brand, description: products.description,
    specs: products.specs, images: products.images, warrantyMonths: products.warrantyMonths, isBulky: products.isBulky,
    requiresInstallation: products.requiresInstallation, weightKg: products.weightKg,
    lengthCm: products.lengthCm, widthCm: products.widthCm, heightCm: products.heightCm,
    categoryName: productCategories.name, categoryGroup: productCategories.group, cashPrice: productPrices.cashPrice, available,
  }).from(products).innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .innerJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, country)))
    .where(and(eq(products.id, id), eq(products.status, 'active'))).limit(1);
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  const { available: a, ...rest } = p;
  res.json({
    country: { code: ctx.country.code, currency: ctx.country.currency, locale: ctx.country.locale },
    product: { ...rest, inStock: a > 0 },
    minDownPaymentPct: ctx.minDp,
    installments: simulate(p.cashPrice, ctx.margins, ctx.minDp, ctx.country.currency, dpPct ?? ctx.minDp),
  });
});
