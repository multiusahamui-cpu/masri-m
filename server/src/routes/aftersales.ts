import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, productReturns, products, refunds, shipments, users } from '../db/schema.js';
import { parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  REQUEST_ROLES, RETURN_REASONS, completeRepair, decideRefund, decideReturn, lookupSource, payRefund, receiveReturn, requestRefund, requestReturn,
} from '../lib/aftersales.js';

/** Purna jual: pembatalan + refund, retur barang. */
export const aftersalesRouter = Router();

const VIEW = requireRole(...REQUEST_ROLES, 'biz-mgr');
const idParam = (v: unknown) => z.uuid().parse(v);
const requester = aliasedTable(users, 'requester');
const scopeOf = (u: AuthUser, col: typeof refunds.branchId | typeof productReturns.branchId): SQL | undefined =>
  ['support', 'biz-mgr'].includes(u.roleCode) ? undefined : u.branch ? eq(col, u.branch.id) : undefined;
const payout = {
  bankName: z.string().trim().max(60).nullish(), accountNo: z.string().trim().max(40).nullish(), accountName: z.string().trim().max(100).nullish(),
};

aftersalesRouter.get('/aftersales/lookup', VIEW, async (req, res) => {
  const { no } = parseBody(z.object({ no: z.string().trim().min(5, 'Masukkan nomor order / akad') }), req.query);
  res.json({ source: await lookupSource(req.user!, no) });
});

aftersalesRouter.get('/aftersales/meta', VIEW, (_req, res) => { res.json({ reasons: RETURN_REASONS }); });

// ----- Refund -----
aftersalesRouter.get('/refunds', VIEW, async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const sc = scopeOf(req.user!, refunds.branchId);
  if (sc) where.push(sc);
  if (q.status) where.push(inArray(refunds.status, q.status.split(',')));
  const rows = await db.select({ r: refunds, branchName: branches.name, requesterName: requester.fullName }).from(refunds)
    .innerJoin(branches, eq(branches.id, refunds.branchId)).innerJoin(requester, eq(requester.id, refunds.requestedBy))
    .where(where.length ? and(...where) : undefined).orderBy(desc(refunds.createdAt)).limit(200);
  res.json({ refunds: rows.map(({ r, ...x }) => ({ ...r, ...x })) });
});

aftersalesRouter.post('/refunds', requireRole(...REQUEST_ROLES), async (req, res) => {
  const b = parseBody(z.object({ sourceNo: z.string().trim().min(5), amount: z.number().positive('Nominal harus lebih dari 0'), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500), method: z.enum(['cash', 'transfer']), ...payout }), req.body);
  res.status(201).json({ refund: await requestRefund(req.user!, b) });
});

aftersalesRouter.post('/refunds/:id/decide', requireRole('branch-manager', 'biz-mgr'), async (req, res) => {
  const b = parseBody(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ refund: await decideRefund(req.user!, idParam(req.params.id), b.decision, b.note ?? null) });
});

aftersalesRouter.post('/refunds/:id/pay', requireRole('cashier', 'branch-admin'), async (req, res) => {
  const { paidRef } = parseBody(z.object({ paidRef: z.string().trim().max(64).nullish() }), req.body);
  res.json({ refund: await payRefund(req.user!, idParam(req.params.id), paidRef ?? null) });
});

// ----- Retur -----
aftersalesRouter.get('/returns', VIEW, async (req, res) => {
  const q = parseBody(z.object({ status: z.string().optional() }), req.query);
  const where: SQL[] = [];
  const sc = scopeOf(req.user!, productReturns.branchId);
  if (sc) where.push(sc);
  if (q.status) where.push(inArray(productReturns.status, q.status.split(',')));
  const rows = await db.select({ r: productReturns, branchName: branches.name, requesterName: requester.fullName, productName: products.name,
    shipmentNo: shipments.shipmentNo, shipmentStatus: shipments.status, refundNo: refunds.refundNo, refundStatus: refunds.status })
    .from(productReturns).innerJoin(branches, eq(branches.id, productReturns.branchId)).innerJoin(requester, eq(requester.id, productReturns.requestedBy))
    .innerJoin(products, eq(products.id, productReturns.productId)).leftJoin(shipments, eq(shipments.id, productReturns.replacementShipmentId))
    .leftJoin(refunds, eq(refunds.id, productReturns.refundId))
    .where(where.length ? and(...where) : undefined).orderBy(desc(productReturns.createdAt)).limit(200);
  res.json({ returns: rows.map(({ r, ...x }) => ({ ...r, ...x })) });
});

aftersalesRouter.post('/returns', requireRole(...REQUEST_ROLES), async (req, res) => {
  const b = parseBody(z.object({
    sourceNo: z.string().trim().min(5), productId: z.uuid('Pilih produk'), qty: z.number().int().positive(), reason: z.string(),
    description: z.string().trim().min(10, 'Jelaskan kondisi barang minimal 10 karakter').max(1000), resolution: z.enum(['replace', 'refund', 'repair']),
  }), req.body);
  res.status(201).json({ return: await requestReturn(req.user!, b) });
});

aftersalesRouter.post('/returns/:id/decide', requireRole('branch-manager', 'biz-mgr'), async (req, res) => {
  const b = parseBody(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).nullish() }), req.body);
  res.json({ return: await decideReturn(req.user!, idParam(req.params.id), b.decision, b.note ?? null) });
});

aftersalesRouter.post('/returns/:id/receive', requireRole('branch-admin'), async (req, res) => {
  const b = parseBody(z.object({
    condition: z.enum(['good', 'damaged']), note: z.string().trim().max(500).nullish(),
    deliveryMode: z.enum(['pickup', 'internal']).optional(), address: z.string().trim().max(300).nullish(), city: z.string().trim().max(80).nullish(),
    refundMethod: z.enum(['cash', 'transfer']).optional(), ...payout,
  }), req.body);
  res.json({ return: await receiveReturn(req.user!, idParam(req.params.id), b) });
});

aftersalesRouter.post('/returns/:id/complete', requireRole('branch-admin'), async (req, res) => {
  const { note } = parseBody(z.object({ note: z.string().trim().min(3, 'Isi catatan penyelesaian') }), req.body);
  res.json({ return: await completeRepair(req.user!, idParam(req.params.id), note) });
});
