import { describe, expect, it } from 'vitest';
import { checkProduction } from '../src/lib/prod-check.js';

const good: NodeJS.ProcessEnv = {
  JWT_SECRET: 'q8V2xP0mLz7Rk3Nw9Yt5Hc1Bf6Dj4Gs2Ua8Ie0Ko3Xv7Zl9Qp5Wr1Ty6Mn4Bh2Cd',
  SUPERADMIN_PASSWORD: 'Kuat-Sekali-2026x', DATABASE_URL: 'postgres://masrim:Rahasia9xZ@postgres:5432/masrim',
  PUBLIC_WEB_URL: 'https://masri-m.com', PAYMENT_PROVIDER: 'midtrans', MIDTRANS_IS_PRODUCTION: 'true',
  PAYMENT_PROVIDER_MY: 'none', SHIPPING_PROVIDER: 'biteship', BITESHIP_WEBHOOK_TOKEN: 'x'.repeat(32), SHIPPING_PROVIDER_MY: 'none',
  WHATSAPP_PROVIDER: 'fonnte', FONNTE_TOKEN: 'tok', SMTP_URL: 'smtp://x', STORAGE_DRIVER: 's3', ANTHROPIC_API_KEY: 'k', ALERT_WHATSAPP: '62811',
};

describe('pemeriksaan konfigurasi production', () => {
  it('konfigurasi lengkap lolos tanpa error', () => {
    expect(checkProduction(good)).toEqual({ errors: [], warnings: [] });
  });
  it('menolak gateway tiruan, secret contoh, dan tanpa HTTPS', () => {
    const r = checkProduction({ ...good, JWT_SECRET: 'ci-secret-yang-cukup-panjang-untuk-pengujian-otomatis-xx', PUBLIC_WEB_URL: 'http://masri-m.com', PAYMENT_PROVIDER: undefined, WHATSAPP_PROVIDER: 'log', ENABLE_DEV_SIMULATION: 'true' });
    expect(r.errors.join('\n')).toMatch(/JWT_SECRET/);
    expect(r.errors.join('\n')).toMatch(/https/);
    expect(r.errors.join('\n')).toMatch(/PAYMENT_PROVIDER masih mock/);
    expect(r.errors.join('\n')).toMatch(/WhatsApp/);
    expect(r.errors.join('\n')).toMatch(/ENABLE_DEV_SIMULATION/);
  });
  it('mode sandbox hanya peringatan; ALLOW_INSECURE_PRODUCTION menurunkan error jadi peringatan', () => {
    expect(checkProduction({ ...good, MIDTRANS_IS_PRODUCTION: 'false' }).warnings[0]).toMatch(/SANDBOX/);
    const r = checkProduction({ ...good, PAYMENT_PROVIDER: 'mock', ALLOW_INSECURE_PRODUCTION: 'true' });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('[diizinkan]'))).toBe(true);
  });
});

describe('alert operasional', () => {
  it('alert masuk outbox sekali per jendela; watchdog mendeteksi cadangan yang tidak berjalan', async () => {
    const { sql } = await import('drizzle-orm');
    const { db } = await import('../src/db/client.js');
    const { sendAlert } = await import('../src/lib/alert.js');
    const { watchdog } = await import('../src/lib/monitor.js');
    process.env.ALERT_WHATSAPP = '62811000111';
    process.env.ALERT_EMAIL = 'ops@contoh.id';
    const key = `tes-${Date.now()}`;
    expect(await sendAlert(key, 'Uji alert', 'isi')).toBe(true);
    expect(await sendAlert(key, 'Uji alert', 'isi')).toBe(false); // diredam
    const { rows } = await db.execute<{ channel: string; recipient: string }>(sql`select channel, recipient from notification_outbox where template = 'ops_alert' and ref_id = ${key} order by channel`);
    expect(rows).toEqual([{ channel: 'email', recipient: 'ops@contoh.id' }, { channel: 'whatsapp', recipient: '+62811000111' }]);

    process.env.BACKUP_STATUS_FILE = '/tmp/tidak-ada/last-success';
    await watchdog();
    const { rows: b } = await db.execute<{ n: number }>(sql`select count(*)::int as n from notification_outbox where template = 'ops_alert' and ref_id = 'backup-stale'`);
    expect(b[0].n).toBeGreaterThan(0);
    delete process.env.BACKUP_STATUS_FILE; delete process.env.ALERT_WHATSAPP; delete process.env.ALERT_EMAIL;
  });
});
