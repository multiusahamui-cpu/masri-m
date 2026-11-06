import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { businessConfigs } from '../db/schema.js';
import { defaultFor } from '../config/business-defaults.js';

/** Baca parameter bisnis; jatuh ke nilai default di kode bila belum ada di DB. */
export async function getConfig<T = unknown>(key: string, countryCode = 'ID'): Promise<T> {
  const [row] = await db.select({ value: businessConfigs.value }).from(businessConfigs)
    .where(and(eq(businessConfigs.key, key), eq(businessConfigs.countryCode, countryCode))).limit(1);
  return (row?.value ?? defaultFor(key, countryCode)) as T;
}
