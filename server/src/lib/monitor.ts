import fs from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sendAlert } from './alert.js';

/** Hitungan error 5xx sejak proses berjalan (ditampilkan di /api/health/details). */
export const counters = { started: new Date(), http5xx: 0, last5xxAt: null as Date | null };
const recent5xx: number[] = [];

export function record5xx() {
  const now = Date.now();
  counters.http5xx++;
  counters.last5xxAt = new Date(now);
  recent5xx.push(now);
  while (recent5xx.length && recent5xx[0] < now - 10 * 60_000) recent5xx.shift();
  const limit = Number(process.env.ALERT_5XX_PER_10MIN ?? 20);
  if (recent5xx.length >= limit) void sendAlert('http-5xx', `Lonjakan error server: ${recent5xx.length} error 5xx dalam 10 menit`, 'Periksa log API: docker compose -f docker-compose.prod.yml logs --since 15m api');
}

/** Umur cadangan terakhir yang berhasil (jam), dari file penanda yang ditulis container backup. */
export async function backupAgeHours(): Promise<number | null> {
  const file = process.env.BACKUP_STATUS_FILE;
  if (!file) return null;
  try {
    const st = await fs.stat(file);
    return (Date.now() - st.mtimeMs) / 3600_000;
  } catch {
    return Infinity;
  }
}

export async function healthDetails() {
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  const dbMs = Date.now() - t0;
  const { rows: [o] } = await db.execute<{ pending: number; failed_1h: number; oldest_pending_min: number | null }>(sql`
    select count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'failed' and created_at > now() - interval '1 hour')::int as failed_1h,
           (extract(epoch from now() - min(created_at) filter (where status = 'pending')) / 60)::int as oldest_pending_min
    from notification_outbox where created_at > now() - interval '7 days'`);
  const { rows: [j] } = await db.execute<{ unposted: number }>(sql`
    select count(*)::int as unposted from payments p
    where p.status = 'paid' and p.paid_at < now() - interval '30 minutes'
      and not exists (select 1 from journal_entries je where je.source_type = 'payment' and je.source_id = p.id::text)`).catch(() => ({ rows: [{ unposted: -1 }] }));
  const backup = await backupAgeHours();
  return {
    ok: true, version: process.env.APP_VERSION ?? 'dev', uptimeMin: Math.round((Date.now() - counters.started.getTime()) / 60_000),
    db: { latencyMs: dbMs }, outbox: o, accounting: { unpostedPayments: j.unposted },
    backup: { ageHours: backup === null ? null : Number.isFinite(backup) ? Math.round(backup * 10) / 10 : 'tidak ditemukan' },
    http: { errors5xx: counters.http5xx, last5xxAt: counters.last5xxAt },
  };
}

/** Pemeriksaan berkala (tiap 15 menit): cadangan basis data & antrean notifikasi. */
export async function watchdog() {
  const age = await backupAgeHours();
  const maxAge = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 26);
  if (age !== null && age > maxAge) {
    await sendAlert('backup-stale', 'Cadangan database tidak berjalan',
      Number.isFinite(age) ? `Cadangan terakhir yang berhasil ${Math.round(age)} jam lalu (batas ${maxAge} jam).` : 'Belum ada cadangan yang berhasil sejak server dipasang.', 360);
  }
  const { rows: [o] } = await db.execute<{ failed_1h: number; stuck: number }>(sql`
    select count(*) filter (where status = 'failed' and created_at > now() - interval '1 hour')::int as failed_1h,
           count(*) filter (where status = 'pending' and created_at < now() - interval '30 minutes')::int as stuck
    from notification_outbox where created_at > now() - interval '1 day' and template <> 'ops_alert'`);
  if (o.failed_1h >= 10 || o.stuck >= 20) {
    await sendAlert('outbox', 'Notifikasi nasabah bermasalah', `Gagal 1 jam terakhir: ${o.failed_1h}; tertahan >30 menit: ${o.stuck}. Periksa saldo/koneksi Fonnte & SMTP di menu Notifikasi Nasabah.`, 120);
  }
}
