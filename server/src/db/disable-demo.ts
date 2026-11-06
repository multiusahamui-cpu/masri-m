/**
 * Nonaktifkan semua akun staf demo (email @masri-m.local, password demo) sebelum go-live.
 * Akun Super Admin dari SUPERADMIN_EMAIL tidak disentuh. Jalankan:
 *   pnpm --filter masrim-server db:disable-demo           (lihat daftar dulu)
 *   pnpm --filter masrim-server db:disable-demo -- --yes  (eksekusi)
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { auditLogs, users } from './schema.js';
import { verifyPassword } from '../lib/security.js';
import { env } from '../env.js';

const DEMO_PASSWORD = 'DemoMasri2026';
const yes = process.argv.includes('--yes');

const rows = await db.select({ id: users.id, email: users.email, fullName: users.fullName, roleCode: users.roleCode, passwordHash: users.passwordHash })
  .from(users).where(and(eq(users.status, 'active'), ne(users.email, env.SUPERADMIN_EMAIL)));
const demo: typeof rows = [];
for (const u of rows) {
  if (u.email.endsWith('@masri-m.local') || (u.passwordHash && await verifyPassword(DEMO_PASSWORD, u.passwordHash))) demo.push(u);
}
if (!demo.length) {
  console.log('Tidak ada akun demo yang aktif.');
} else {
  console.log(`${demo.length} akun demo aktif:`);
  for (const u of demo) console.log(`  - ${u.email.padEnd(40)} ${u.roleCode.padEnd(18)} ${u.fullName}`);
  if (!yes) console.log('\nTambahkan --yes untuk menonaktifkan semuanya.');
  else {
    for (const u of demo) {
      await db.update(users).set({ status: 'inactive', updatedAt: sql`now()` }).where(eq(users.id, u.id));
      await db.insert(auditLogs).values({ actorEmail: 'system:disable-demo', action: 'user.deactivate', entityType: 'user', entityId: u.id, after: { reason: 'akun demo dinonaktifkan sebelum go-live', email: u.email } });
    }
    console.log(`\n${demo.length} akun demo dinonaktifkan.`);
  }
}
await pool.end();
