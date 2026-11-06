import { Router } from 'express';
import { COUNTRY_DEFAULTS } from '../config/business-defaults.js';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { businessConfigs, countries } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { writeAudit } from '../lib/audit.js';
import { CONFIG_BY_KEY, validateConfigValue } from '../config/business-defaults.js';

export const adminConfigRouter = Router();
const countrySchema = z.string().length(2).toUpperCase();

adminConfigRouter.get('/config', async (req, res) => {
  const country = countrySchema.parse(req.query.country ?? 'ID');
  const rows = await db.select().from(businessConfigs)
    .where(eq(businessConfigs.countryCode, country))
    .orderBy(asc(businessConfigs.sortOrder), asc(businessConfigs.key));
  res.json({ country, configs: rows });
});

const updateSchema = z.object({ countryCode: countrySchema, value: z.unknown() });

adminConfigRouter.put('/config/:key', async (req, res) => {
  const key = z.string().max(100).parse(req.params.key);
  const { countryCode, value } = parseBody(updateSchema, req.body);
  const def = CONFIG_BY_KEY.get(key);
  if (!def) throw new HttpError(404, 'Parameter tidak dikenal');

  const problem = validateConfigValue(def, value);
  if (problem) throw new HttpError(400, `${def.label}: ${problem}`);

  const [before] = await db.select().from(businessConfigs)
    .where(and(eq(businessConfigs.key, key), eq(businessConfigs.countryCode, countryCode))).limit(1);
  if (!before) throw new HttpError(404, `Parameter belum tersedia untuk negara ${countryCode}`);

  const [after] = await db.update(businessConfigs)
    .set({ value, updatedBy: req.user!.id, updatedAt: new Date() })
    .where(and(eq(businessConfigs.key, key), eq(businessConfigs.countryCode, countryCode)))
    .returning();

  await writeAudit(req, {
    action: 'config.update', entityType: 'config', entityId: `${countryCode}:${key}`,
    before: { value: before.value }, after: { value: after.value },
  });
  res.json({ config: after });
});

/** Salin seluruh parameter dari satu negara ke negara lain (untuk persiapan ekspansi). */
const copySchema = z.object({ from: countrySchema, to: countrySchema, overwrite: z.boolean().default(false) })
  .refine((v) => v.from !== v.to, 'Negara asal dan tujuan harus berbeda');

adminConfigRouter.post('/config/copy', async (req, res) => {
  const { from, to, overwrite } = parseBody(copySchema, req.body);
  const [target] = await db.select().from(countries).where(eq(countries.code, to)).limit(1);
  const [origin] = await db.select().from(countries).where(eq(countries.code, from)).limit(1);
  if (!target || !origin) throw new HttpError(400, 'Kode negara tidak dikenal');

  const source = await db.select().from(businessConfigs).where(eq(businessConfigs.countryCode, from));
  if (!source.length) throw new HttpError(400, `Negara ${from} belum punya parameter`);

  // Nominal uang tidak bisa disalin apa adanya bila mata uang berbeda -> di-nol-kan agar wajib diisi ulang.
  const resetMoney = origin.currency !== target.currency;
  // Parameter khas negara tujuan (pajak, kurir, nominal dalam mata uang lokal) memakai nilai awal negara itu
  const local = COUNTRY_DEFAULTS[to] ?? {};
  const values = source.map(({ updatedAt: _u, updatedBy: _b, ...c }) => ({
    ...c, value: c.key in local ? local[c.key] : resetMoney && c.valueType === 'money' ? 0 : c.value,
    countryCode: to, updatedBy: req.user!.id, updatedAt: new Date(),
  }));
  const q = db.insert(businessConfigs).values(values);
  const inserted = overwrite
    ? await q.onConflictDoUpdate({
        target: [businessConfigs.key, businessConfigs.countryCode],
        set: { value: sql`excluded.value`, updatedBy: req.user!.id, updatedAt: new Date() },
      }).returning({ key: businessConfigs.key })
    : await q.onConflictDoNothing().returning({ key: businessConfigs.key });

  await writeAudit(req, { action: 'config.copy', entityType: 'config', entityId: `${from}->${to}`, after: { count: inserted.length, overwrite, moneyReset: resetMoney } });
  res.json({ copied: inserted.length, moneyReset: resetMoney, currency: target.currency });
});

adminConfigRouter.patch('/countries/:code', async (req, res) => {
  const code = countrySchema.parse(req.params.code);
  const { isActive } = parseBody(z.object({ isActive: z.boolean() }), req.body);
  if (isActive) {
    const rows = await db.select({ key: businessConfigs.key }).from(businessConfigs).where(eq(businessConfigs.countryCode, code));
    if (!rows.length) throw new HttpError(409, 'Salin & sesuaikan parameter bisnis negara ini sebelum mengaktifkannya');
  }
  const [after] = await db.update(countries).set({ isActive }).where(eq(countries.code, code)).returning();
  if (!after) throw new HttpError(404, 'Negara tidak ditemukan');
  await writeAudit(req, { action: 'country.update', entityType: 'country', entityId: code, after: { isActive } });
  res.json({ country: after });
});
