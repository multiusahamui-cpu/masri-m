import type { Request } from 'express';
import { db } from '../db/client.js';
import { consents } from '../db/schema.js';
import { LEGAL_VERSION } from '../config/legal.js';
import { clientIp } from './http.js';
import { logger } from './logger.js';

export type ConsentDoc = 'terms' | 'privacy' | 'credit_check';

/** Catat bukti persetujuan nasabah. Gagal mencatat tidak membatalkan transaksi, tetapi dicatat sebagai error. */
export async function recordConsent(req: Request, s: { subjectType: 'customer' | 'credit_application' | 'order'; subjectId: string; phone?: string | null; documents: ConsentDoc[]; country?: string | null }) {
  const lang = typeof req.body?.lang === 'string' ? req.body.lang.slice(0, 5) : null;
  try {
    await db.insert(consents).values(s.documents.map((document) => ({
      subjectType: s.subjectType, subjectId: s.subjectId, phone: s.phone ?? null, document, version: LEGAL_VERSION, lang,
      countryCode: s.country ?? null, ip: clientIp(req), userAgent: (req.get('user-agent') ?? '').slice(0, 400),
    })));
  } catch (e) {
    logger.error('consent', 'gagal mencatat persetujuan', e);
  }
}
