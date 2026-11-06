import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  SESSION_HOURS: z.coerce.number().positive().default(8),
  SUPERADMIN_EMAIL: z.email().default('superadmin@masri-m.local'),
  SUPERADMIN_PASSWORD: z.string().min(10).default('GantiSegera#2026'),
  SUPERADMIN_NAME: z.string().default('Super Admin Masri-M'),
  // Asisten Virtual (Claude). Kosongkan API key untuk menonaktifkan; website tetap jalan.
  ANTHROPIC_API_KEY: z.string().trim().optional().transform((v) => v || undefined),
  ASSISTANT_MODEL: z.string().trim().min(1).default('claude-haiku-4-5'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
