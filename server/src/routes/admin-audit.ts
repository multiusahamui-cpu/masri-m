import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, ilike, like, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { parseBody } from '../lib/http.js';

export const adminAuditRouter = Router();

const query = z.object({
  action: z.string().trim().max(64).optional(), // awalan, mis. "user." atau "config."
  actor: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

adminAuditRouter.get('/audit-logs', async (req, res) => {
  const q = parseBody(query, req.query);
  const where: SQL[] = [];
  if (q.action) where.push(like(auditLogs.action, `${q.action}%`));
  if (q.actor) where.push(ilike(auditLogs.actorEmail, `%${q.actor}%`));
  const cond = where.length ? and(...where) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(auditLogs).where(cond).orderBy(desc(auditLogs.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(auditLogs).where(cond),
  ]);
  res.json({ logs: rows, total, page: q.page, pageSize: q.pageSize });
});
