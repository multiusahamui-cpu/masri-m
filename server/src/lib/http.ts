import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { errInfo, logger } from './logger.js';
import { record5xx } from './monitor.js';

import crypto from 'node:crypto';

/** Bandingkan rahasia (token, tanda tangan) dalam waktu konstan. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b) return false;
  const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/** URL yang aman ditaruh di href / src (menolak javascript:, data:, file:, dsb.). */
export const webUrl = (opts: { httpsOnly?: boolean } = {}) => z.url({ protocol: opts.httpsOnly ? /^https$/ : /^https?$/, message: opts.httpsOnly ? 'Harus URL https://' : 'Harus URL http(s)://' });

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, 'Data tidak valid', r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const rid = res.getHeader('x-request-id');
  if (err instanceof HttpError) {
    if (err.status >= 500) { record5xx(); logger.error('http', err.message, { rid, method: req.method, path: req.originalUrl.split('?')[0], status: err.status }); }
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // Body JSON rusak / terlalu besar dari express.json()
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') {
    res.status(e.status ?? 400).json({ error: e.type === 'entity.too.large' ? 'Data terlalu besar' : 'Format data tidak valid' });
    return;
  }
  // Validasi zod di luar parseBody (mis. z.uuid().parse(req.params.id)) -> 400, bukan 500
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Data tidak valid', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    return;
  }
  // Pelanggaran keunikan / constraint basis data akibat permintaan ganda -> 409, data tetap konsisten
  const code = String((err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code ?? '');
  if (code === '23505' || code === '23514' || code === '40001' || code === '40P01') {
    logger.warn('http', 'konflik basis data', { rid, method: req.method, path: req.originalUrl.split('?')[0], code });
    res.status(409).json({ error: code === '23514' ? 'Data melanggar aturan (nilai tidak valid)' : 'Data baru saja diubah oleh proses lain. Muat ulang lalu coba lagi.', requestId: rid });
    return;
  }
  record5xx();
  logger.error('http', 'error tak tertangani', { rid, method: req.method, path: req.originalUrl.split('?')[0], ...errInfo(err) });
  res.status(500).json({ error: 'Terjadi kesalahan pada server', requestId: rid });
}

export const clientIp = (req: Request) => (req.ip ?? '').slice(0, 64);
