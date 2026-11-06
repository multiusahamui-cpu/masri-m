import { eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { branches, businessConfigs, countries, roles, users } from './schema.js';
import { ROLE_SEED } from '../config/roles.js';
import { COUNTRY_SEED } from '../config/countries.js';
import { CONFIG_DEFINITIONS, defaultFor } from '../config/business-defaults.js';
import { hashPassword } from '../lib/security.js';
import { env } from '../env.js';

// Idempoten: aman dijalankan berulang kali. Nilai config yang sudah diubah Super Admin TIDAK ditimpa,
// hanya label/deskripsi/batas yang disegarkan dari kode.

for (const c of COUNTRY_SEED) {
  await db.insert(countries).values(c).onConflictDoUpdate({
    target: countries.code, set: { name: c.name, currency: c.currency, locale: c.locale, timezone: c.timezone },
  });
}

for (const r of ROLE_SEED) {
  await db.insert(roles).values({ ...r }).onConflictDoUpdate({
    target: roles.code, set: { name: r.name, description: r.description, isInternal: r.isInternal, scope: r.scope, sortOrder: r.sortOrder },
  });
}

// Kantor Pusat (wajib ada, hanya satu)
let [ho] = await db.select().from(branches).where(eq(branches.type, 'head_office')).limit(1);
if (!ho) {
  [ho] = await db.insert(branches).values({
    code: 'HO', name: 'Kantor Pusat', type: 'head_office', countryCode: 'ID', city: 'Jakarta', hasBufferStock: false,
  }).returning();
  console.log('Kantor Pusat (HO) dibuat.');
}
// User lama yang belum punya kantor -> Kantor Pusat
await db.update(users).set({ branchId: ho.id }).where(isNull(users.branchId));

for (const [i, d] of CONFIG_DEFINITIONS.entries()) {
  const meta = {
    sortOrder: i,
    category: d.category, label: d.label, description: d.description, valueType: d.valueType,
    minValue: d.min?.toString() ?? null, maxValue: d.max?.toString() ?? null, unit: d.unit ?? null, isPublic: d.isPublic ?? false,
  };
  await db.insert(businessConfigs).values({ key: d.key, countryCode: 'ID', value: d.defaultValue, ...meta })
    .onConflictDoUpdate({ target: [businessConfigs.key, businessConfigs.countryCode], set: meta });
}
// Negara lain yang parameternya sudah disalin: tambahkan parameter baru yang belum ada (nilai default negara itu)
const { rows: others } = await db.execute<{ country_code: string }>(sql`select distinct country_code from business_configs where country_code <> 'ID'`);
for (const { country_code: cc } of others) {
  for (const [i, d] of CONFIG_DEFINITIONS.entries()) {
    await db.insert(businessConfigs).values({
      key: d.key, countryCode: cc, value: defaultFor(d.key, cc), sortOrder: i, category: d.category, label: d.label, description: d.description,
      valueType: d.valueType, minValue: d.min?.toString() ?? null, maxValue: d.max?.toString() ?? null, unit: d.unit ?? null, isPublic: d.isPublic ?? false,
    }).onConflictDoNothing();
  }
}
// Segarkan metadata untuk negara lain yang sudah disalin
for (const d of CONFIG_DEFINITIONS) {
  await db.update(businessConfigs).set({ label: d.label, description: d.description, isPublic: d.isPublic ?? false, sortOrder: CONFIG_DEFINITIONS.indexOf(d) })
    .where(sql`${businessConfigs.key} = ${d.key} and ${businessConfigs.countryCode} <> 'ID'`);
}

const email = env.SUPERADMIN_EMAIL.toLowerCase();
const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
if (!existing) {
  await db.insert(users).values({
    email, fullName: env.SUPERADMIN_NAME, roleCode: 'super-admin', countryCode: 'ID', branchId: ho.id,
    passwordHash: await hashPassword(env.SUPERADMIN_PASSWORD), mustChangePassword: true,
  });
  console.log(`Super Admin dibuat: ${email} (wajib ganti password saat login pertama)`);
} else {
  console.log(`Super Admin ${email} sudah ada, dilewati.`);
}

console.log('Seed selesai.');
await pool.end();
