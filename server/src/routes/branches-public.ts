import { Router } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, countries } from '../db/schema.js';

/** Daftar kantor aktif untuk dropdown (eskalasi, nasabah, dsb.). Butuh login. */
export const branchesRouter = Router();

branchesRouter.get('/branches', async (_req, res) => {
  const rows = await db.select({
    id: branches.id, code: branches.code, name: branches.name, type: branches.type, city: branches.city, countryCode: branches.countryCode,
  }).from(branches).where(eq(branches.isActive, true)).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code));
  res.json({ branches: rows });
});

/** Daftar negara (untuk harga per negara, alamat, dsb.). */
branchesRouter.get('/countries', async (_req, res) => {
  res.json({ countries: await db.select().from(countries).orderBy(sql`${countries.isActive} desc`, asc(countries.code)) });
});
