import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branchExpenses, files, productReturns, users, type StoredFile } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import type { AuthUser } from '../middleware/auth.js';
import { getStorage, sniffType } from '../lib/storage.js';
import { getAppForUser } from '../lib/credit.js';
import { canOperate, loadShipment } from '../lib/shipping.js';
import { writeAudit } from '../lib/audit.js';

/** Lampiran: foto KTP & survei (kredit), bukti terima (pengiriman), nota (biaya), foto retur. */
export const filesRouter = Router();

const MAX = 8 * 1024 * 1024;
const OWNER = z.enum(['credit', 'shipment', 'expense', 'return']);
const KINDS: Record<z.infer<typeof OWNER>, string[]> = {
  credit: ['ktp', 'selfie', 'kk', 'income_proof', 'address_proof', 'survey', 'contract', 'other'],
  shipment: ['pod', 'other'], expense: ['receipt', 'other'], return: ['photo', 'other'],
};
const HQ = ['biz-mgr', 'super-admin', 'support', 'finance'];

/** Cek hak akses ke pemilik lampiran. write=true untuk unggah. */
async function assertOwner(u: AuthUser, type: z.infer<typeof OWNER>, id: string, write: boolean) {
  if (type === 'credit') {
    const a = await getAppForUser(u, id); // melempar 404 bila di luar cakupan
    if (write && !['ao', 'branch-manager', 'branch-admin'].includes(u.roleCode)) throw new HttpError(403, 'Dokumen pengajuan diunggah AO / cabang');
    return a.branchId;
  }
  if (type === 'shipment') {
    const s = await loadShipment(id);
    const ok = canOperate(u, s) || (u.roleCode === 'delivery' && s.driverId === u.id) || (!write && (HQ.includes(u.roleCode) || u.branch?.id === s.branchId));
    if (!ok) throw new HttpError(403, 'Bukan pengiriman Anda');
    return s.branchId;
  }
  if (type === 'expense') {
    const [e] = await db.select().from(branchExpenses).where(eq(branchExpenses.id, id)).limit(1);
    if (!e) throw new HttpError(404, 'Biaya tidak ditemukan');
    if (!(u.branch?.id === e.branchId || (!write && HQ.includes(u.roleCode)))) throw new HttpError(403, 'Bukan biaya cabang Anda');
    if (write && !['branch-admin', 'cashier'].includes(u.roleCode)) throw new HttpError(403, 'Nota diunggah Admin Cabang / Kasir');
    return e.branchId;
  }
  const [r] = await db.select().from(productReturns).where(eq(productReturns.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'Retur tidak ditemukan');
  if (!(u.branch?.id === r.branchId || (!write && HQ.includes(u.roleCode)))) throw new HttpError(403, 'Bukan retur cabang Anda');
  return r.branchId;
}

const meta = (f: StoredFile & { uploadedByName?: string | null }) => ({ id: f.id, kind: f.kind, filename: f.filename, contentType: f.contentType, size: f.size, createdAt: f.createdAt, uploadedByName: f.uploadedByName ?? null, url: `/api/files/${f.id}/content` });

filesRouter.get('/files', async (req, res) => {
  const q = z.object({ ownerType: OWNER, ownerId: z.uuid() }).parse(req.query);
  await assertOwner(req.user!, q.ownerType, q.ownerId, false);
  const rows = await db.select({ f: files, uploadedByName: users.fullName }).from(files).leftJoin(users, eq(users.id, files.uploadedBy))
    .where(and(eq(files.ownerType, q.ownerType), eq(files.ownerId, q.ownerId))).orderBy(desc(files.createdAt));
  res.json({ files: rows.map(({ f, uploadedByName }) => meta({ ...f, uploadedByName })) });
});

/** Unggah: body biner mentah (image/jpeg, image/png, image/webp, application/pdf), maks 8 MB. */
filesRouter.post('/files', express.raw({ type: () => true, limit: MAX }), async (req, res) => {
  const q = z.object({ ownerType: OWNER, ownerId: z.uuid(), kind: z.string(), filename: z.string().trim().min(1).max(150) }).parse(req.query);
  if (!KINDS[q.ownerType].includes(q.kind)) throw new HttpError(400, 'Jenis lampiran tidak dikenal');
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'File kosong');
  const type = sniffType(data);
  if (!type) throw new HttpError(415, 'Format file harus JPG, PNG, WEBP, atau PDF');
  await assertOwner(req.user!, q.ownerType, q.ownerId, true);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[type];
  const key = `${q.ownerType}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await getStorage().put(key, data, type);
  const [f] = await db.insert(files).values({ ownerType: q.ownerType, ownerId: q.ownerId, kind: q.kind, filename: q.filename.replace(/[^\w .()-]/g, '_'),
    contentType: type, size: data.length, storageKey: key, sha256, uploadedBy: req.user!.id }).returning();
  if (q.ownerType === 'credit') await writeAudit(req, { action: 'file.upload', entityType: 'credit', entityId: q.ownerId, after: { kind: q.kind, fileId: f.id, filename: f.filename } }).catch(() => undefined);
  res.status(201).json({ file: meta(f) });
});

filesRouter.get('/files/:id/content', async (req, res) => {
  const [f] = await db.select().from(files).where(eq(files.id, z.uuid().parse(req.params.id))).limit(1);
  if (!f) throw new HttpError(404, 'File tidak ditemukan');
  await assertOwner(req.user!, f.ownerType as z.infer<typeof OWNER>, f.ownerId, false);
  const data = await getStorage().get(f.storageKey);
  res.set({ 'Content-Type': f.contentType, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff',
    // PDF diunduh (bukan dibuka di origin aplikasi) + sandbox CSP: konten aktif di dalam berkas tidak bisa menjalankan skrip
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${f.contentType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.filename)}"` });
  res.send(data);
});
