import type { Request } from 'express';
import { db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { clientIp } from './http.js';

interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  actor?: { id: string; email: string } | null;
}

export async function writeAudit(req: Request, entry: AuditEntry) {
  const actor = entry.actor === undefined ? req.user ?? null : entry.actor;
  await db.insert(auditLogs).values({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: clientIp(req),
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
  });
}
