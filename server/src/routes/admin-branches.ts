import { Router } from 'express';
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, countries, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { writeAudit } from '../lib/audit.js';

export const adminBranchesRouter = Router();

const phoneSchema = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Format nomor telepon tidak valid').nullish();
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,16}$/, 'Kode 2-16 huruf/angka tanpa spasi, mis. JKT01');

const selectWithCounts = {
  id: branches.id, code: branches.code, name: branches.name, type: branches.type, countryCode: branches.countryCode,
  city: branches.city, address: branches.address, postalCode: branches.postalCode, phone: branches.phone, hasBufferStock: branches.hasBufferStock,
  isActive: branches.isActive, createdAt: branches.createdAt, updatedAt: branches.updatedAt,
  userCount: sql<number>`(select count(*)::int from "users" u where u."branch_id" = "branches"."id" and u."status" = 'active')`,
};

adminBranchesRouter.get('/branches', async (_req, res) => {
  const rows = await db.select(selectWithCounts).from(branches).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code));
  res.json({ branches: rows });
});

const createSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  countryCode: z.string().length(2).toUpperCase().default('ID'),
  city: z.string().trim().min(2, 'Kota wajib diisi').max(80),
  address: z.string().trim().max(300).default(''),
  postalCode: z.string().trim().regex(/^\d{5}$/, 'Kode pos 5 digit').nullish().or(z.literal('').transform(() => null)),
  phone: phoneSchema,
  hasBufferStock: z.boolean().default(true),
});

adminBranchesRouter.post('/branches', async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const [c] = await db.select().from(countries).where(eq(countries.code, body.countryCode)).limit(1);
  if (!c) throw new HttpError(400, 'Kode negara tidak dikenal');
  const [dup] = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, body.code)).limit(1);
  if (dup) throw new HttpError(409, 'Kode cabang sudah dipakai');

  // Kantor Pusat dibuat oleh seed; dari layar ini selalu cabang.
  const [created] = await db.insert(branches).values({ ...body, phone: body.phone ?? null, type: 'branch' }).returning();
  await writeAudit(req, { action: 'branch.create', entityType: 'branch', entityId: created.id, after: created });
  res.status(201).json({ branch: created });
});

const updateSchema = createSchema.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan');

adminBranchesRouter.patch('/branches/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = parseBody(updateSchema, req.body);
  const [before] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  if (!before) throw new HttpError(404, 'Kantor tidak ditemukan');

  if (before.type === 'head_office' && body.isActive === false) throw new HttpError(400, 'Kantor Pusat tidak dapat dinonaktifkan');
  if (body.isActive === false) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(sql`${users.branchId} = ${id} and ${users.status} = 'active'`);
    if (n > 0) throw new HttpError(409, `Masih ada ${n} user aktif di cabang ini. Pindahkan atau nonaktifkan dulu.`);
  }

  const [after] = await db.update(branches)
    .set({ ...body, phone: body.phone === undefined ? undefined : body.phone ?? null, updatedAt: new Date() })
    .where(eq(branches.id, id)).returning();
  await writeAudit(req, { action: 'branch.update', entityType: 'branch', entityId: id, before, after });
  res.json({ branch: after });
});
