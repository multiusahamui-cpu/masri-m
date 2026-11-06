import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, countries, roles, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { generateTempPassword, hashPassword, passwordProblem } from '../lib/security.js';
import { writeAudit } from '../lib/audit.js';
import { INTERNAL_ROLE_CODES, roleFitsBranch } from '../config/roles.js';

export const adminUsersRouter = Router();

// Kolom yang aman dikirim ke frontend (tanpa password hash)
const publicCols = {
  id: users.id, email: users.email, fullName: users.fullName, phone: users.phone,
  roleCode: users.roleCode, countryCode: users.countryCode, branchId: users.branchId, status: users.status,
  mustChangePassword: users.mustChangePassword, failedLoginCount: users.failedLoginCount,
  lastLoginAt: users.lastLoginAt, createdAt: users.createdAt, updatedAt: users.updatedAt,
};
type PublicUser = { [K in keyof typeof publicCols]: unknown };

const roleCodeSchema = z.enum(INTERNAL_ROLE_CODES as [string, ...string[]], 'Role tidak valid untuk user internal');
const phoneSchema = z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, 'Format nomor telepon tidak valid').nullish();

const ROLE_SCOPE_LABEL = { head_office: 'Kantor Pusat', branch: 'Cabang' } as const;

/** Pastikan kantor ada, aktif, dan cocok dengan role (mis. Admin Cabang tidak boleh di Kantor Pusat). */
async function assertBranchForRole(branchId: string, roleCode: string) {
  const [b] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!b) throw new HttpError(400, 'Kantor/cabang tidak ditemukan');
  if (!b.isActive) throw new HttpError(400, `Cabang ${b.name} sedang nonaktif`);
  if (!roleFitsBranch(roleCode, b.type)) {
    const [r] = await db.select({ name: roles.name, scope: roles.scope }).from(roles).where(eq(roles.code, roleCode)).limit(1);
    const where = r && r.scope !== 'any' ? ROLE_SCOPE_LABEL[r.scope] : '';
    throw new HttpError(400, `Role ${r?.name ?? roleCode} hanya dapat ditempatkan di ${where}`);
  }
  return b;
}

async function getUser(id: string) {
  const [u] = await db.select(publicCols).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new HttpError(404, 'User tidak ditemukan');
  return u;
}

async function assertCountry(code: string) {
  const [c] = await db.select().from(countries).where(eq(countries.code, code)).limit(1);
  if (!c) throw new HttpError(400, 'Kode negara tidak dikenal');
}

/** Pastikan selalu tersisa minimal satu Super Admin aktif. */
async function assertNotLastSuperAdmin(userId: string) {
  const [{ n }] = await db.select({ n: count() }).from(users)
    .where(and(eq(users.roleCode, 'super-admin'), eq(users.status, 'active'), ne(users.id, userId)));
  if (n === 0) throw new HttpError(409, 'Tidak bisa: ini satu-satunya Super Admin aktif');
}

// ---- Daftar role (untuk dropdown & matriks) ----
adminUsersRouter.get('/roles', async (_req, res) => {
  const rows = await db.select({
    code: roles.code, name: roles.name, description: roles.description, isInternal: roles.isInternal, scope: roles.scope,
    userCount: sql<number>`(select count(*)::int from "users" u where u."role_code" = "roles"."code")`,
  }).from(roles).orderBy(asc(roles.sortOrder));
  res.json({ roles: rows });
});

adminUsersRouter.get('/countries', async (_req, res) => {
  res.json({ countries: await db.select().from(countries).orderBy(desc(countries.isActive), asc(countries.code)) });
});

// ---- Statistik ringkas untuk dashboard ----
adminUsersRouter.get('/stats', async (_req, res) => {
  const byStatus = await db.select({ status: users.status, n: count() }).from(users).groupBy(users.status);
  const byRole = await db.select({ roleCode: users.roleCode, n: count() }).from(users).groupBy(users.roleCode);
  res.json({ byStatus, byRole });
});

// ---- List user internal ----
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.string().optional(),
  branchId: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminUsersRouter.get('/users', async (req, res) => {
  const q = parseBody(listQuery, req.query);
  const where: SQL[] = [];
  if (q.search) {
    const s = `%${q.search}%`;
    where.push(or(ilike(users.email, s), ilike(users.fullName, s), ilike(users.phone, s))!);
  }
  if (q.role) where.push(eq(users.roleCode, q.role));
  if (q.branchId) where.push(eq(users.branchId, q.branchId));
  if (q.status) where.push(eq(users.status, q.status));
  const cond = where.length ? and(...where) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select({ ...publicCols, branchCode: branches.code, branchName: branches.name }).from(users)
      .leftJoin(branches, eq(branches.id, users.branchId)).where(cond).orderBy(desc(users.createdAt))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(users).where(cond),
  ]);
  res.json({ users: rows, total, page: q.page, pageSize: q.pageSize });
});

// ---- Buat user internal ----
const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Format email tidak valid')),
  fullName: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  phone: phoneSchema,
  roleCode: roleCodeSchema,
  countryCode: z.string().length(2).toUpperCase().optional(),
  branchId: z.uuid('Kantor/cabang wajib dipilih'),
  password: z.string().optional(), // kosong = dibuatkan password sementara
});

adminUsersRouter.post('/users', async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const branch = await assertBranchForRole(body.branchId, body.roleCode);
  const countryCode = body.countryCode ?? branch.countryCode;
  await assertCountry(countryCode);

  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (exists) throw new HttpError(409, 'Email sudah terdaftar');

  let plain = body.password?.trim();
  if (plain) {
    const p = passwordProblem(plain);
    if (p) throw new HttpError(400, p);
  } else {
    plain = generateTempPassword();
  }

  const [created] = await db.insert(users).values({
    email: body.email, fullName: body.fullName, phone: body.phone ?? null,
    roleCode: body.roleCode, countryCode, branchId: branch.id,
    passwordHash: await hashPassword(plain), mustChangePassword: true, createdBy: req.user!.id,
  }).returning(publicCols);

  await writeAudit(req, { action: 'user.create', entityType: 'user', entityId: created.id, after: created });
  // Password sementara hanya dikirim SEKALI di respons ini.
  res.status(201).json({ user: created, temporaryPassword: body.password ? undefined : plain });
});

// ---- Ubah user ----
const updateSchema = z.object({
  fullName: z.string().trim().min(3).max(120).optional(),
  phone: phoneSchema,
  roleCode: roleCodeSchema.optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  branchId: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan');

adminUsersRouter.patch('/users/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = parseBody(updateSchema, req.body);
  const before = await getUser(id);
  const isSelf = id === req.user!.id;

  if (before.roleCode === 'customer') throw new HttpError(400, 'Akun nasabah tidak dikelola dari menu ini');
  if (isSelf && body.roleCode && body.roleCode !== before.roleCode) throw new HttpError(400, 'Tidak bisa mengubah role akun sendiri');
  if (isSelf && body.status && body.status !== 'active') throw new HttpError(400, 'Tidak bisa menonaktifkan akun sendiri');
  if (body.countryCode) await assertCountry(body.countryCode);
  if (body.roleCode || body.branchId) {
    const branchId = body.branchId ?? (before.branchId as string | null);
    if (!branchId) throw new HttpError(400, 'Kantor/cabang wajib dipilih');
    await assertBranchForRole(branchId, body.roleCode ?? (before.roleCode as string));
  }

  const leavingSuperAdmin = before.roleCode === 'super-admin' && before.status === 'active' &&
    ((body.roleCode && body.roleCode !== 'super-admin') || (body.status && body.status !== 'active'));
  if (leavingSuperAdmin) await assertNotLastSuperAdmin(id);

  const patch: Partial<typeof users.$inferInsert> = { ...body, phone: body.phone === undefined ? undefined : body.phone ?? null, updatedAt: new Date() };
  if (body.status === 'active' && before.status === 'locked') { patch.failedLoginCount = 0; patch.lockedUntil = null; } // buka kunci
  // Role / kantor / status berubah -> paksa login ulang (hak akses dihitung ulang dari sesi baru)
  if ((body.roleCode && body.roleCode !== before.roleCode) || (body.branchId && body.branchId !== before.branchId) || (body.status && body.status !== before.status)) {
    patch.sessionVersion = sql`${users.sessionVersion} + 1` as unknown as number;
  }

  const [after] = await db.update(users).set(patch).where(eq(users.id, id)).returning(publicCols);
  await writeAudit(req, { action: 'user.update', entityType: 'user', entityId: id, before: diff(before, after).before, after: diff(before, after).after });
  res.json({ user: after });
});

// ---- Reset password ----
adminUsersRouter.post('/users/:id/reset-password', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const target = await getUser(id);
  if (target.roleCode === 'customer') throw new HttpError(400, 'Akun nasabah tidak dikelola dari menu ini');

  const plain = generateTempPassword();
  await db.update(users).set({
    passwordHash: await hashPassword(plain), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null,
    sessionVersion: sql`${users.sessionVersion} + 1`,
    status: target.status === 'locked' ? 'active' : (target.status as 'active' | 'inactive'), updatedAt: new Date(),
  }).where(eq(users.id, id));
  await writeAudit(req, { action: 'user.reset_password', entityType: 'user', entityId: id });
  res.json({ temporaryPassword: plain });
});

function diff(before: PublicUser, after: PublicUser) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof PublicUser)[]) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k]; a[k] = after[k]; }
  }
  return { before: b, after: a };
}
