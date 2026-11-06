import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bankAccounts, bankImports, bankLines, branches, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { CURRENCY } from '../lib/region.js';
import { PRESETS, autoMatch, candidatesFor, ignoreLine, importStatement, matchLine, parseCsv, parseStatement, postLine, reconSummary, unmatchLine } from '../lib/bankrec.js';
import { syncJournals, wibDate } from '../lib/accounting.js';

/** Rekonsiliasi rekening koran (Bookkeeping). */
export const bankrecRouter = Router();
bankrecRouter.use('/bank', requireRole('finance'));

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const columnMap = z.object({
  date: z.string().min(1), description: z.string().min(1), debit: z.string().optional(), credit: z.string().optional(), amount: z.string().optional(), dc: z.string().optional(),
  balance: z.string().optional(), reference: z.string().optional(), dateFormat: z.enum(['dmy', 'mdy']).default('dmy'), decimal: z.enum([',', '.']).optional(), delimiter: z.string().max(1).optional(), skipRows: z.number().int().min(0).optional(),
});

bankrecRouter.get('/bank/presets', (_req, res) => { res.json({ presets: Object.entries(PRESETS).map(([code, p]) => ({ code, ...p })) }); });

bankrecRouter.get('/bank/accounts', async (_req, res) => {
  const rows = await db.select({ a: bankAccounts, branchName: branches.name, countryCode: branches.countryCode }).from(bankAccounts).innerJoin(branches, eq(branches.id, bankAccounts.branchId))
    .orderBy(asc(branches.countryCode), asc(bankAccounts.bankName));
  const out = [];
  for (const r of rows) {
    const s = await reconSummary(r.a.id, wibDate());
    out.push({ ...r.a, branchName: r.branchName, countryCode: r.countryCode, summary: { statementBalance: s.statementBalance, statementDate: s.statementDate, bookBalance: s.bookBalance, difference: s.difference, unmatched: s.status.unmatched?.count ?? 0 } });
  }
  res.json({ accounts: out });
});

const accSchema = z.object({ branchId: z.uuid(), bankName: z.string().trim().min(2).max(80), accountNo: z.string().trim().min(4).max(40), accountName: z.string().trim().min(2).max(120),
  preset: z.enum(['generic', 'bca', 'mandiri', 'bsi']).default('generic'), isActive: z.boolean().default(true) });

bankrecRouter.post('/bank/accounts', async (req, res) => {
  const b = parseBody(accSchema, req.body);
  const [br] = await db.select().from(branches).where(eq(branches.id, b.branchId)).limit(1);
  if (!br) throw new HttpError(400, 'Kantor tidak dikenal');
  const [a] = await db.insert(bankAccounts).values({ ...b, currency: CURRENCY[br.countryCode] ?? 'IDR' }).returning()
    .catch((e) => { if (String(e?.cause?.code ?? e?.code) === '23505') throw new HttpError(409, 'Rekening ini sudah terdaftar'); throw e; });
  await writeAudit(req, { action: 'bank.account.create', entityType: 'bank_account', entityId: a.id, after: a });
  res.status(201).json({ account: a });
});

bankrecRouter.put('/bank/accounts/:id', async (req, res) => {
  const b = parseBody(accSchema.partial().extend({ columnMap: columnMap.nullish() }), req.body);
  const [a] = await db.update(bankAccounts).set(b).where(eq(bankAccounts.id, z.uuid().parse(req.params.id))).returning();
  if (!a) throw new HttpError(404, 'Rekening tidak ditemukan');
  res.json({ account: a });
});

/** Pratinjau file: header & pemetaan kolom terdeteksi, 10 baris pertama. */
bankrecRouter.post('/bank/accounts/:id/preview', async (req, res) => {
  const b = parseBody(z.object({ content: z.string().min(10).max(5_000_000), columnMap: columnMap.nullish() }), req.body);
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, z.uuid().parse(req.params.id))).limit(1);
  if (!acc) throw new HttpError(404, 'Rekening tidak ditemukan');
  const raw = parseCsv(b.content).slice(0, 12);
  try {
    const p = parseStatement(b.content, acc.preset, b.columnMap ?? acc.columnMap);
    res.json({ ok: true, header: p.header, columnMap: p.columnMap, sample: p.lines.slice(0, 10), total: p.lines.length, skipped: p.skipped.slice(0, 20), raw });
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message, raw });
  }
});

bankrecRouter.post('/bank/accounts/:id/import', async (req, res) => {
  const b = parseBody(z.object({ filename: z.string().trim().min(1).max(200), content: z.string().min(10).max(5_000_000), columnMap: columnMap.nullish(), saveMap: z.boolean().default(true) }), req.body);
  const r = await importStatement(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: 'bank.import', entityType: 'bank_account', entityId: req.params.id, after: { filename: b.filename, rows: r.rows, newRows: r.newRows } });
  res.status(201).json(r);
});

bankrecRouter.post('/bank/accounts/:id/auto-match', async (req, res) => {
  res.json({ matched: await autoMatch(z.uuid().parse(req.params.id)) });
});

bankrecRouter.get('/bank/accounts/:id/summary', async (req, res) => {
  const to = typeof req.query.to === 'string' && req.query.to ? dateStr.parse(req.query.to) : wibDate();
  await syncJournals();
  res.json(await reconSummary(z.uuid().parse(req.params.id), to));
});

bankrecRouter.get('/bank/accounts/:id/imports', async (req, res) => {
  const rows = await db.select({ i: bankImports, by: users.fullName }).from(bankImports).innerJoin(users, eq(users.id, bankImports.importedBy))
    .where(eq(bankImports.accountId, z.uuid().parse(req.params.id))).orderBy(desc(bankImports.createdAt)).limit(30);
  res.json({ imports: rows.map((r) => ({ ...r.i, importedByName: r.by })) });
});

bankrecRouter.get('/bank/lines', async (req, res) => {
  const q = parseBody(z.object({ accountId: z.uuid(), status: z.string().optional(), from: dateStr.optional(), to: dateStr.optional() }), req.query);
  const where: SQL[] = [eq(bankLines.accountId, q.accountId)];
  if (q.status) where.push(eq(bankLines.status, q.status));
  if (q.from) where.push(gte(bankLines.txDate, q.from));
  if (q.to) where.push(lte(bankLines.txDate, q.to));
  const rows = await db.select().from(bankLines).where(and(...where)).orderBy(desc(bankLines.txDate), desc(bankLines.createdAt), desc(bankLines.seq)).limit(500);
  res.json({ lines: rows });
});

bankrecRouter.get('/bank/lines/:id/candidates', async (req, res) => {
  const [r] = await db.select({ l: bankLines, acc: bankAccounts }).from(bankLines).innerJoin(bankAccounts, eq(bankAccounts.id, bankLines.accountId)).where(eq(bankLines.id, z.uuid().parse(req.params.id))).limit(1);
  if (!r) throw new HttpError(404, 'Mutasi tidak ditemukan');
  const any = req.query.any === '1';
  res.json({ candidates: await candidatesFor(r.l, r.acc, any ? 31 : 7, any) });
});

bankrecRouter.post('/bank/lines/:id/match', async (req, res) => {
  const b = parseBody(z.object({ refs: z.array(z.object({ type: z.string(), id: z.string() })).min(1), note: z.string().max(300).nullish() }), req.body);
  res.json({ line: await matchLine(req.user!, z.uuid().parse(req.params.id), b.refs, b.note) });
});

bankrecRouter.post('/bank/lines/:id/post', async (req, res) => {
  const b = parseBody(z.object({ type: z.enum(['gateway_settlement', 'bank_fee', 'other_income']), gross: z.number().positive().nullish(), note: z.string().max(300).nullish() }), req.body);
  const line = await postLine(req.user!, z.uuid().parse(req.params.id), b);
  await syncJournals();
  res.json({ line });
});

bankrecRouter.post('/bank/lines/:id/ignore', async (req, res) => {
  const { note } = parseBody(z.object({ note: z.string().trim().min(3, 'Isi alasan (mis. pindah buku antar rekening sendiri)') }), req.body);
  res.json({ line: await ignoreLine(req.user!, z.uuid().parse(req.params.id), note) });
});

bankrecRouter.post('/bank/lines/:id/unmatch', async (req, res) => {
  res.json({ line: await unmatchLine(req.user!, z.uuid().parse(req.params.id)) });
});
