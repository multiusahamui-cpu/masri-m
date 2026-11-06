import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customerOtps, customers, notificationOutbox } from '../db/schema.js';
import { env, isProd } from '../env.js';
import { HttpError } from './http.js';
import { processOutbox } from './notify.js';
import { countryOfPhone, e164, phoneMatch as rPhoneMatch, validPhoneFor } from './region.js';

/**
 * Akun nasabah: login tanpa password dengan kode OTP WhatsApp.
 * Satu "akun" = semua data nasabah dengan nomor HP yang sama (order tunai & pengajuan kredit bisa tercatat
 * dengan format nomor berbeda, mis. +62812… dan 0812…).
 */
export const CUSTOMER_COOKIE = 'masri_customer';
const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;

export interface CustomerSession { id: string; phone: string }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { customer?: CustomerSession } }
}

/** Normalkan nomor HP ke E.164 tanpa "+" (mis. 6281234567890, 60123456789, 6737123456). */
export const normPhone = (raw: string, country = 'ID') => e164(raw, country);
export const validPhone = (p: string, country?: string) => (country ? validPhoneFor(p, country) : !!countryOfPhone(p));
const mask = (p: string) => `+${p.slice(0, Math.min(5, p.length - 4))}••••${p.slice(-3)}`;
const hashCode = (phone: string, code: string) => crypto.createHash('sha256').update(`${phone}:${code}:${env.JWT_SECRET}`).digest('hex');

/** SQL: semua data milik satu nomor (format lama 08…, +62…, 62… dianggap sama). */
export const phoneMatch = (col: unknown, phone: string) => rPhoneMatch(col, phone, countryOfPhone(phone) ?? 'ID');

const OTP_TEXT: Record<string, (code: string) => [string, string]> = {
  id: (c) => ['Kode masuk Masri-M', `Kode masuk Akun Masri-M: *${c}*\nBerlaku ${OTP_TTL_MIN} menit. JANGAN berikan kode ini kepada siapa pun, termasuk petugas Masri-M.`],
  ms: (c) => ['Kod log masuk Masri-M', `Kod log masuk Akaun Masri-M: *${c}*\nSah selama ${OTP_TTL_MIN} minit. JANGAN kongsi kod ini dengan sesiapa, termasuk kakitangan Masri-M.`],
  en: (c) => ['Masri-M sign-in code', `Your Masri-M account sign-in code: *${c}*\nValid for ${OTP_TTL_MIN} minutes. NEVER share this code with anyone, including Masri-M staff.`],
};

export async function requestOtp(raw: string, ip: string, country = 'ID', lang = 'id') {
  const phone = normPhone(raw, country);
  if (!validPhone(phone, country)) throw new HttpError(400, 'Nomor HP tidak valid');
  const recent = await db.select({ createdAt: customerOtps.createdAt }).from(customerOtps)
    .where(and(eq(customerOtps.phone, phone), gt(customerOtps.createdAt, sql`now() - interval '15 minutes'`))).orderBy(desc(customerOtps.createdAt));
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) throw new HttpError(429, 'Tunggu 1 menit sebelum meminta kode baru');
  if (recent.length >= 3) throw new HttpError(429, 'Terlalu banyak permintaan kode. Coba lagi 15 menit lagi');
  const code = String(crypto.randomInt(100000, 1000000));
  await db.transaction(async (tx) => {
    await tx.insert(customerOtps).values({ phone, codeHash: hashCode(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000), ip: ip.slice(0, 64) });
    await tx.insert(notificationOutbox).values({
      channel: 'whatsapp', recipient: phone, template: 'otp', subject: (OTP_TEXT[lang] ?? OTP_TEXT.id)(code)[0], refType: 'otp', refId: phone,
      body: (OTP_TEXT[lang] ?? OTP_TEXT.id)(code)[1],
    });
  });
  processOutbox(10).catch((e) => console.error('[otp] gagal mengirim:', e)); // kirim segera, tidak menunggu worker
  const devCode = !isProd && process.env.ENABLE_DEV_SIMULATION === 'true' && (process.env.WHATSAPP_PROVIDER ?? 'log') === 'log' ? code : undefined;
  return { sentTo: mask(phone), expiresInSec: OTP_TTL_MIN * 60, devCode };
}

export async function verifyOtp(raw: string, code: string, country = 'ID', lang?: string) {
  const phone = normPhone(raw, country);
  // Batas per nomor HP (selain per IP): menahan tebakan terdistribusi dari banyak IP
  const { overLimit } = await import('./ratelimit.js');
  if (await overLimit(`otp-verify-phone:${phone}`, 15, 3600)) throw new HttpError(429, 'Terlalu banyak percobaan untuk nomor ini. Coba lagi 1 jam lagi');
  const [otp] = await db.select().from(customerOtps)
    .where(and(eq(customerOtps.phone, phone), isNull(customerOtps.consumedAt), gt(customerOtps.expiresAt, sql`now()`))).orderBy(desc(customerOtps.createdAt)).limit(1);
  if (!otp) throw new HttpError(400, 'Kode sudah kedaluwarsa. Minta kode baru');
  // Hitung percobaan secara atomik SEBELUM membandingkan: tebakan paralel tetap terhitung semua
  const [slot] = await db.update(customerOtps).set({ attempts: sql`${customerOtps.attempts} + 1` })
    .where(and(eq(customerOtps.id, otp.id), isNull(customerOtps.consumedAt), sql`${customerOtps.attempts} < ${MAX_ATTEMPTS}`)).returning({ attempts: customerOtps.attempts });
  if (!slot) throw new HttpError(429, 'Terlalu banyak percobaan. Minta kode baru');
  const a = Buffer.from(hashCode(phone, code.trim())), b = Buffer.from(otp.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(400, `Kode salah. Sisa percobaan ${Math.max(0, MAX_ATTEMPTS - slot.attempts)}`);
  }
  // Kode sekali pakai: hanya satu permintaan yang berhasil menandainya terpakai
  const [used] = await db.update(customerOtps).set({ consumedAt: new Date() }).where(and(eq(customerOtps.id, otp.id), isNull(customerOtps.consumedAt))).returning({ id: customerOtps.id });
  if (!used) throw new HttpError(400, 'Kode sudah dipakai. Minta kode baru');
  // Pakai data nasabah terlama dengan nomor ini; buat baru bila belum pernah bertransaksi
  let [c] = await db.select().from(customers).where(phoneMatch(customers.phone, phone)).orderBy(customers.createdAt).limit(1);
  if (!c) {
    const { rows: [{ seq }] } = await db.execute<{ seq: string }>(sql`select nextval('customer_no_seq')::text as seq`);
    [c] = await db.insert(customers).values({ fullName: 'Nasabah Masri-M', phone: `+${phone}`, customerNo: `CWEB-${seq.padStart(6, '0')}` }).returning();
  }
  await db.update(customers).set({ lastLoginAt: new Date(), ...(lang ? { lang } : {}) }).where(eq(customers.id, c.id));
  return { id: c.id, phone };
}

const SESSION_DAYS = Number(process.env.CUSTOMER_SESSION_DAYS) || 30;
export function setCustomerCookie(res: Response, s: CustomerSession) {
  const token = jwt.sign({ sub: s.id, ph: s.phone, typ: 'customer' }, env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d`, audience: 'customer', algorithm: 'HS256' });
  res.cookie(CUSTOMER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: SESSION_DAYS * 86400_000, path: '/' });
}
export const clearCustomerCookie = (res: Response) => res.clearCookie(CUSTOMER_COOKIE, { path: '/' });

export function readCustomer(req: Request): CustomerSession | null {
  const t = req.cookies?.[CUSTOMER_COOKIE];
  if (!t) return null;
  try {
    const d = jwt.verify(t, env.JWT_SECRET, { audience: 'customer', algorithms: ['HS256'] }) as { sub: string; ph: string; typ: string };
    // Sesi lama menyimpan format 08…; ubah ke E.164
    return d.typ === 'customer' ? { id: d.sub, phone: d.ph.startsWith('0') ? e164(d.ph, 'ID') : d.ph } : null;
  } catch { return null; }
}

export async function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  const s = readCustomer(req);
  if (!s) return next(new HttpError(401, 'Silakan masuk ke Akun Saya'));
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, s.id)).limit(1);
  if (!c) return next(new HttpError(401, 'Sesi tidak valid, silakan masuk kembali'));
  req.customer = s;
  next();
}
