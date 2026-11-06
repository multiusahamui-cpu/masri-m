import { Router } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { env, isProd } from '../env.js';
import { HttpError, parseBody } from '../lib/http.js';
import { SESSION_COOKIE, burnPasswordCheck, hashPassword, passwordProblem, signSession, verifyPassword } from '../lib/security.js';
import { overLimit } from '../lib/ratelimit.js';
import { writeAudit } from '../lib/audit.js';
import { loadAuthUser, requireAuth } from '../middleware/auth.js';

const MAX_FAILED_LOGIN = 5;
export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Format email tidak valid')),
  password: z.string().min(1, 'Password wajib diisi'),
});

const LOCK_MINUTES = 15;

/** Set cookie sesi staf (dipakai saat login & setelah ganti password). */
function setSession(res: import('express').Response, u: { id: string; roleCode: string; sessionVersion: number }) {
  res.cookie(SESSION_COOKIE, signSession({ sub: u.id, role: u.roleCode, sv: u.sessionVersion }), {
    httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: env.SESSION_HOURS * 3600_000, path: '/',
  });
}

authRouter.post('/login', async (req, res) => {
  const { email, password } = parseBody(loginSchema, req.body);
  // Batas per email (berlaku juga untuk email tak terdaftar, agar respons tidak membedakan keduanya)
  if (await overLimit(`login-email:${email}`, 20, 3600)) throw new HttpError(429, 'Terlalu banyak percobaan login untuk akun ini. Coba lagi nanti.');
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Pesan & waktu respons sengaja disamakan agar tidak membocorkan email mana yang terdaftar.
  const invalid = new HttpError(401, 'Email atau password salah');
  if (!u) {
    await burnPasswordCheck(password);
    await writeAudit(req, { action: 'auth.login_failed', entityType: 'user', after: { email }, actor: null });
    throw invalid;
  }
  // Kunci sementara (bukan permanen): penyerang tidak bisa mengunci akun selamanya, termasuk Super Admin
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await burnPasswordCheck(password);
    const min = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(429, `Terlalu banyak percobaan login yang salah. Coba lagi dalam ${min} menit.`);
  }
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) {
    // Kenaikan atomik: percobaan paralel tetap terhitung semua
    const [after] = await db.update(users).set({ failedLoginCount: sql`${users.failedLoginCount} + 1`, updatedAt: new Date() }).where(eq(users.id, u.id)).returning({ n: users.failedLoginCount });
    const lock = (after?.n ?? 0) >= MAX_FAILED_LOGIN;
    if (lock) await db.update(users).set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }).where(eq(users.id, u.id));
    await writeAudit(req, {
      action: lock ? 'auth.account_locked' : 'auth.login_failed', entityType: 'user', entityId: u.id,
      after: { failedLoginCount: after?.n, lockedMinutes: lock ? LOCK_MINUTES : undefined }, actor: { id: u.id, email: u.email },
    });
    throw invalid;
  }
  // Status akun hanya diungkap kepada yang mengetahui password-nya
  if (u.status === 'locked') throw new HttpError(423, 'Akun dikunci oleh Super Admin. Hubungi Super Admin.');
  if (u.status !== 'active') throw new HttpError(403, 'Akun tidak aktif. Hubungi Super Admin.');

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await writeAudit(req, { action: 'auth.login', entityType: 'user', entityId: u.id, actor: { id: u.id, email: u.email } });
  setSession(res, u);
  res.json({ user: await loadAuthUser(u.id) });
});

authRouter.post('/logout', async (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parseBody(changePwSchema, req.body);
  const problem = passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  if (currentPassword === newPassword) throw new HttpError(400, 'Password baru harus berbeda dari password lama');

  const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  if (!u || !(await verifyPassword(currentPassword, u.passwordHash))) throw new HttpError(400, 'Password lama salah');

  // Versi sesi naik: semua sesi lain (perangkat lain / sesi curian) langsung tidak berlaku; sesi ini diperbarui
  const [after] = await db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: sql`now()` })
    .where(eq(users.id, u.id)).returning();
  await writeAudit(req, { action: 'auth.password_changed', entityType: 'user', entityId: u.id });
  setSession(res, after);
  res.json({ ok: true });
});

/** Keluar dari semua perangkat (mis. curiga sesi dicuri). */
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
  await writeAudit(req, { action: 'auth.logout_all', entityType: 'user', entityId: req.user!.id });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});
