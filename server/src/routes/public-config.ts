import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { businessConfigs, countries } from '../db/schema.js';
import { HttpError } from '../lib/http.js';

export const publicConfigRouter = Router();

/** Parameter yang boleh dibaca website publik (keranjang, simulasi cicilan). */
publicConfigRouter.get('/config/public', async (req, res) => {
  const country = z.string().length(2).toUpperCase().catch('ID').parse(req.query.country ?? 'ID');
  const [c] = await db.select().from(countries).where(eq(countries.code, country)).limit(1);
  if (!c || !c.isActive) throw new HttpError(404, 'Negara belum dilayani');

  const rows = await db.select({ key: businessConfigs.key, value: businessConfigs.value }).from(businessConfigs)
    .where(and(eq(businessConfigs.countryCode, country), eq(businessConfigs.isPublic, true)));
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ country: c, config: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});
