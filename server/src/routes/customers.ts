import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, customers } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const customersRouter = Router();

customersRouter.get('/customers', requireRole('support', 'biz-mgr', 'branch-manager', 'branch-admin'), async (req, res) => {
  const { search } = parseBody(z.object({ search: z.string().trim().max(100).optional() }), req.query);
  const where: SQL[] = [];
  if (['branch-manager', 'branch-admin'].includes(req.user!.roleCode)) where.push(eq(customers.branchId, req.user!.branch?.id ?? sql`null`));
  if (search) {
    const s = `%${search}%`;
    where.push(or(ilike(customers.fullName, s), ilike(customers.phone, s), ilike(customers.customerNo, s), ilike(customers.email, s))!);
  }
  const rows = await db.select({
    id: customers.id, customerNo: customers.customerNo, fullName: customers.fullName, phone: customers.phone,
    email: customers.email, city: customers.city, branchId: customers.branchId, branchName: branches.name,
  }).from(customers).leftJoin(branches, eq(branches.id, customers.branchId))
    .where(where.length ? and(...where) : undefined).orderBy(desc(customers.createdAt)).limit(20);
  res.json({ customers: rows });
});

const createSchema = z.object({
  fullName: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, 'Format nomor telepon tidak valid'),
  email: z.email('Format email tidak valid').nullish().or(z.literal('').transform(() => null)),
  city: z.string().trim().max(80).default(''),
  address: z.string().trim().max(300).default(''),
  branchId: z.uuid('Pilih cabang yang melayani nasabah'),
});

/** Helpdesk dapat mendaftarkan penelepon yang belum tercatat sebagai nasabah. */
customersRouter.post('/customers', requireRole('support'), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const [b] = await db.select().from(branches).where(eq(branches.id, body.branchId)).limit(1);
  if (!b) throw new HttpError(400, 'Cabang tidak ditemukan');
  const { rows: [{ seq }] } = await db.execute<{ seq: string }>(sql`select nextval('customer_no_seq')::text as seq`);
  const [c] = await db.insert(customers).values({ ...body, email: body.email ?? null, customerNo: `C${b.code}-${seq.padStart(6, '0')}` }).returning();
  await writeAudit(req, { action: 'customer.create', entityType: 'customer', entityId: c.id, after: c });
  res.status(201).json({ customer: c });
});
