import { execSync } from 'node:child_process';
import pg from 'pg';
import { testDbUrl } from '../vitest.config.js';

/** Buat ulang DB uji: migrasi + seed + data demo (provider mock agar seed tidak memanggil layanan luar). */
export default async function setup() {
  const url = new URL(testDbUrl());
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes('test')) throw new Error(`Nama DB uji harus mengandung "test": ${name}`);
  const admin = new URL(url); admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`drop database if exists ${name} with (force)`);
  await c.query(`create database ${name}`);
  await c.end();
  const env = { ...process.env, DATABASE_URL: url.toString(), PAYMENT_PROVIDER: 'mock', SHIPPING_PROVIDER: 'mock', JWT_SECRET: 'tes-otomatis-secret-yang-cukup-panjang-123456' };
  for (const s of ['db/migrate.ts', 'db/seed.ts', 'db/seed-demo.ts', 'db/seed-asia.ts']) execSync(`npx tsx src/${s}`, { env, stdio: 'pipe' });
}
