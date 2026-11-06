import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../env.js';

export const SESSION_COOKIE = 'masri_session';

export interface SessionPayload {
  sub: string; // user id
  role: string;
  sv: number; // versi sesi user (users.session_version)
}

/** Kunci turunan per keperluan (HKDF) agar satu JWT_SECRET tidak dipakai langsung untuk banyak hal. */
export const subKey = (purpose: string) => Buffer.from(crypto.hkdfSync('sha256', env.JWT_SECRET, 'masrim', purpose, 32));

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
/** Hash tiruan: dipakai saat email tidak terdaftar agar waktu respons login sama (tidak membocorkan email terdaftar). */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);
export const burnPasswordCheck = (plain: string) => bcrypt.compare(plain, DUMMY_HASH).then(() => false);

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.SESSION_HOURS}h`, audience: 'staff', algorithm: 'HS256' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'staff' });
    if (typeof decoded === 'object' && decoded && 'sub' in decoded && 'role' in decoded) {
      return { sub: String(decoded.sub), role: String(decoded.role), sv: Number((decoded as { sv?: number }).sv ?? 0) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Password sementara yang mudah dibacakan: 12 karakter, tanpa huruf/angka ambigu. */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return `${out}#9`;
}

/** Aturan password: min 10 karakter, ada huruf besar, huruf kecil, dan angka. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password minimal 10 karakter';
  if (!/[A-Z]/.test(pw)) return 'Password harus mengandung huruf besar';
  if (!/[a-z]/.test(pw)) return 'Password harus mengandung huruf kecil';
  if (!/[0-9]/.test(pw)) return 'Password harus mengandung angka';
  return null;
}
