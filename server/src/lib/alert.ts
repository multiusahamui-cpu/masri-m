import { db } from '../db/client.js';
import { notificationOutbox } from '../db/schema.js';
import { logger } from './logger.js';

/**
 * Alert operasional ke tim teknis (ALERT_WHATSAPP, ALERT_EMAIL — boleh beberapa, pisahkan koma).
 * Dikirim lewat outbox notifikasi yang sama dengan nasabah. Kejadian yang sama hanya dikirim
 * sekali per jendela waktu (default 60 menit) agar tidak membanjiri.
 */
const lastLocal = new Map<string, number>();

export async function sendAlert(key: string, subject: string, body: string, windowMin = 60) {
  logger.error('alert', subject, { key, body });
  const now = Date.now();
  if ((lastLocal.get(key) ?? 0) > now - windowMin * 60_000) return false;
  lastLocal.set(key, now);
  const phones = (process.env.ALERT_WHATSAPP ?? '').split(',').map((s) => s.trim().replace(/[^\d]/g, '')).filter(Boolean);
  const emails = (process.env.ALERT_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!phones.length && !emails.length) return false;
  const bucket = Math.floor(now / (windowMin * 60_000));
  const env = process.env.APP_ENV_NAME || process.env.NODE_ENV || 'dev';
  const text = `[Masri-M ${env}] ${subject}\n\n${body}\n\nWaktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
  const rows = [
    ...phones.map((p) => ({ channel: 'whatsapp', recipient: `+${p}`, template: 'ops_alert', subject, body: text, refType: 'alert', refId: key.slice(0, 64), dedupeKey: `alert:${key}:${bucket}:wa:${p}`.slice(0, 160) })),
    ...emails.map((m) => ({ channel: 'email', recipient: m, template: 'ops_alert', subject: `[ALERT] ${subject}`, body: text, refType: 'alert', refId: key.slice(0, 64), dedupeKey: `alert:${key}:${bucket}:em:${m}`.slice(0, 160) })),
  ];
  try {
    await db.insert(notificationOutbox).values(rows).onConflictDoNothing();
    return true;
  } catch (e) {
    logger.error('alert', 'gagal mengantrekan alert', e);
    return false;
  }
}

/** Bungkus tugas berkala: error dicatat dan memicu alert bila gagal berturut-turut. */
const fails = new Map<string, number>();
export function guardedJob(name: string, fn: () => Promise<unknown>, alertAfter = 3) {
  return async () => {
    try {
      await fn();
      fails.set(name, 0);
    } catch (e) {
      const n = (fails.get(name) ?? 0) + 1;
      fails.set(name, n);
      logger.error(name, 'tugas berkala gagal', e);
      if (n === alertAfter) await sendAlert(`job:${name}`, `Tugas "${name}" gagal ${n}x berturut-turut`, e instanceof Error ? e.message : String(e));
    }
  };
}
