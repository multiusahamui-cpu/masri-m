import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import 'dotenv/config';

/** Basis data uji terpisah (dibuat ulang setiap kali tes dijalankan). */
export function testDbUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const u = new URL(process.env.DATABASE_URL ?? 'postgres://masrim:masrim_dev@localhost:5433/masrim');
  u.pathname = '/masrim_test';
  return u.toString();
}

const FAKE = 'http://127.0.0.1:18788';

/** Urutan tetap: alur bisnis dulu, akuntansi terakhir (memeriksa jurnal dari semua transaksi uji). */
class OrderedSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    const rank = (f: TestSpecification) => (f.moduleId.endsWith('accounting.test.ts') ? 1 : 0);
    return [...files].sort((a, b) => rank(a) - rank(b) || a.moduleId.localeCompare(b.moduleId));
  }
}
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false,
    sequence: { sequencer: OrderedSequencer },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test', DATABASE_URL: testDbUrl(), RATE_LIMIT: 'off', ENABLE_DEV_SIMULATION: 'true', REDIS_URL: '', ACCESS_LOG: 'off',
      JWT_SECRET: 'tes-otomatis-secret-yang-cukup-panjang-123456', STORAGE_DIR: '/tmp/masrim-test-uploads',
      PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: 'SB-Mid-server-TEST', MIDTRANS_BASE_URL: FAKE,
      SHIPPING_PROVIDER: 'biteship', BITESHIP_API_KEY: 'biteship_test.KEY', BITESHIP_BASE_URL: FAKE, BITESHIP_WEBHOOK_TOKEN: 'tok123',
      PAYMENT_PROVIDER_MY: 'billplz', BILLPLZ_API_KEY: 'BPKEY', BILLPLZ_COLLECTION_ID: 'col1', BILLPLZ_X_SIGNATURE: 'sigkey', BILLPLZ_BASE_URL: FAKE,
      SHIPPING_PROVIDER_MY: 'easyparcel', EASYPARCEL_API_KEY: 'EPKEY', EASYPARCEL_BASE_URL: FAKE,
      WHATSAPP_PROVIDER: 'fonnte', FONNTE_TOKEN: 'FONNTE-TOKEN', FONNTE_BASE_URL: FAKE, SMTP_URL: '', ANTHROPIC_API_KEY: '',
    },
  },
});
