import type { NextFunction, Request, Response } from 'express';
import { Redis } from 'ioredis';
import { HttpError, clientIp } from './http.js';

/**
 * Pembatasan laju request per IP (fixed window). Memakai Redis (REDIS_URL) agar berlaku lintas instance;
 * bila Redis tidak tersedia, otomatis memakai memori proses.
 */
let redis: Redis | null = null;
let redisDown = false;
if (process.env.REDIS_URL && process.env.RATE_LIMIT !== 'off') {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  redis.on('error', () => { if (!redisDown) console.warn('[rate-limit] Redis tidak tersedia, memakai memori'); redisDown = true; });
  redis.on('ready', () => { redisDown = false; });
}
const mem = new Map<string, { n: number; reset: number }>();

async function hit(key: string, windowSec: number) {
  if (redis && !redisDown) {
    try {
      const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSec + 1);
      return n;
    } catch { redisDown = true; }
  }
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset < now) { mem.set(key, { n: 1, reset: now + windowSec * 1000 }); if (mem.size > 20000) for (const [k, v] of mem) if (v.reset < now) mem.delete(k); return 1; }
  return ++e.n;
}

/** Hitung percobaan untuk kunci bebas (mis. per email / per nomor HP). Mengembalikan true bila melebihi batas. */
export async function overLimit(key: string, max: number, windowSec: number) {
  if (process.env.RATE_LIMIT === 'off') return false;
  return (await hit(key, windowSec)) > max;
}

export const rateLimit = (name: string, max: number, windowSec: number, message = 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.', opts: { writesOnly?: boolean } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.RATE_LIMIT === 'off' || (opts.writesOnly && req.method === 'GET')) return next();
    const n = await hit(`${name}:${clientIp(req) || 'unknown'}`, windowSec);
    if (n > max) { res.set('Retry-After', String(windowSec)); return next(new HttpError(429, message)); }
    next();
  };

/**
 * Perlindungan CSRF untuk sesi cookie: request yang mengubah data wajib berasal dari origin sendiri.
 * (Cookie sesi sudah SameSite=Lax; ini lapisan kedua.) Webhook dikecualikan.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/webhooks/')) return next();
  let origin = req.get('origin') ?? null;
  if (!origin && req.get('referer')) { try { origin = new URL(req.get('referer')!).origin; } catch { return next(new HttpError(403, 'Origin tidak diizinkan')); } }
  if (!origin) return next(); // klien non-browser (server-to-server, curl) tidak membawa cookie lintas situs
  const allowed = (process.env.ALLOWED_ORIGINS || process.env.PUBLIC_WEB_URL || 'http://localhost:3000').split(',').map((s) => s.trim().replace(/\/$/, ''));
  const self = `${req.protocol}://${req.get('host')}`;
  if (allowed.includes(origin) || origin === self) return next();
  next(new HttpError(403, 'Origin tidak diizinkan'));
}
