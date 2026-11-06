import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, users } from '../db/schema.js';
import { SESSION_COOKIE, verifySession } from '../lib/security.js';
import { HttpError } from '../lib/http.js';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roleCode: string;
  countryCode: string;
  mustChangePassword: boolean;
  branch: { id: string; code: string; name: string; type: 'head_office' | 'branch'; countryCode: string } | null;
  sessionVersion?: number;
}

/** Ambil user + kantor penempatannya. Mengembalikan null bila tidak ada / tidak aktif. */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [row] = await db.select({ u: users, b: branches }).from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(eq(users.id, userId)).limit(1);
  if (!row || row.u.status !== 'active') return null;
  const { u, b } = row;
  return {
    id: u.id, email: u.email, fullName: u.fullName, roleCode: u.roleCode,
    countryCode: u.countryCode, mustChangePassword: u.mustChangePassword, sessionVersion: u.sessionVersion,
    branch: b ? { id: b.id, code: b.code, name: b.name, type: b.type, countryCode: b.countryCode } : null,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Wajib login. Status user dicek ulang ke DB setiap request agar nonaktif = langsung tertendang. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;
  if (!session) throw new HttpError(401, 'Sesi tidak valid, silakan login kembali');

  const user = await loadAuthUser(session.sub);
  if (!user) throw new HttpError(401, 'Akun tidak aktif');
  // Password diganti / direset setelah sesi ini dibuat -> sesi lama tidak berlaku lagi
  if ((user.sessionVersion ?? 0) !== session.sv) throw new HttpError(401, 'Sesi berakhir karena password diubah. Silakan login kembali.');
  req.user = user;
  next();
}

/** Batasi ke role tertentu. User yang wajib ganti password diblokir sampai menggantinya. */
export const requireRole = (...roleCodes: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new HttpError(401, 'Belum login');
  if (req.user.mustChangePassword) throw new HttpError(403, 'Silakan ganti password terlebih dahulu');
  if (!roleCodes.includes(req.user.roleCode)) throw new HttpError(403, 'Anda tidak memiliki akses ke fitur ini');
  next();
};
