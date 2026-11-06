import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  accountingPeriods, branches, charityDisbursements, coaAccounts, countries, journalEntries, journalLines, postingErrors, users,
} from '../db/schema.js';
import { HttpError, parseBody } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ACC, charityNo, createManualJournal, ensureCoa, pendingCount, reverseJournal, syncJournals, wibDate } from '../lib/accounting.js';

/** Akuntansi syariah: jurnal, buku besar, laporan keuangan, dana kebajikan, tutup periode. */
export const accountingRouter = Router();

const BOOKKEEPER = requireRole('finance');
const READERS = requireRole('finance', 'biz-mgr', 'super-admin', 'branch-manager');
const r2 = (v: number) => Math.round(v * 100) / 100;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const n = (v: unknown) => Number(v ?? 0);

/**
 * Cakupan laporan: satu negara (satu mata uang) — konsolidasi lintas mata uang memerlukan kurs dan belum didukung.
 * Manager Cabang hanya cabangnya; Pusat memilih negara (default ID) dan opsional satu kantor.
 */
interface Scope { branchId: string | null; country: string }
function scopeBranch(req: Request): Scope {
  const u = req.user!;
  if (u.roleCode === 'branch-manager') return { branchId: u.branch!.id, country: u.branch!.countryCode };
  const b = req.query.branchId;
  const country = z.enum(['ID', 'MY', 'BN']).catch('ID').parse(String(req.query.country ?? 'ID').toUpperCase());
  return { branchId: typeof b === 'string' && b ? z.uuid().parse(b) : null, country };
}
function range(req: Request) {
  const today = wibDate();
  const from = typeof req.query.from === 'string' && req.query.from ? dateStr.parse(req.query.from) : `${today.slice(0, 7)}-01`;
  const to = typeof req.query.to === 'string' && req.query.to ? dateStr.parse(req.query.to) : today;
  if (from > to) throw new HttpError(400, 'Tanggal awal setelah tanggal akhir');
  return { from, to };
}
const branchCond = (b: Scope) => (b.branchId ? sql`and l.branch_id = ${b.branchId}` : sql`and l.branch_id in (select id from branches where country_code = ${b.country})`);
const currencyOf = async (country: string) => (await db.select({ c: countries.currency }).from(countries).where(eq(countries.code, country)).limit(1))[0]?.c ?? 'IDR';

// Posting otomatis dijalankan sebelum laporan dibuat agar angka selalu terbaru
accountingRouter.use('/accounting', READERS, async (_req, _res, next) => { await syncJournals(); next(); });

/** Saldo per akun & kantor dalam rentang tanggal. */
async function sums(cond: SQL) {
  const { rows } = await db.execute<{ code: string; branch_id: string; dr: string; cr: string }>(sql`
    select l.account_code code, l.branch_id, sum(l.debit) dr, sum(l.credit) cr
    from journal_lines l join journal_entries e on e.id = l.entry_id where true ${cond} group by 1, 2`);
  return rows.map((r) => ({ code: r.code, branchId: r.branch_id, dr: n(r.dr), cr: n(r.cr) }));
}
async function accounts() {
  await ensureCoa();
  return db.select().from(coaAccounts).orderBy(asc(coaAccounts.code));
}
async function branchList(scope: Scope) {
  const rows = await db.select({ id: branches.id, code: branches.code, name: branches.name, type: branches.type, countryCode: branches.countryCode }).from(branches)
    .where(eq(branches.countryCode, scope.country)).orderBy(sql`${branches.type} = 'branch'`, asc(branches.code));
  return scope.branchId ? rows.filter((b) => b.id === scope.branchId) : rows;
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/summary', async (req, res) => {
  const b = scopeBranch(req);
  const today = wibDate(), monthStart = `${today.slice(0, 7)}-01`;
  const all = await sums(sql`and e.date <= ${today} ${branchCond(b)}`);
  const month = await sums(sql`and e.date between ${monthStart} and ${today} ${branchCond(b)}`);
  const accs = await accounts();
  const type = new Map(accs.map((a) => [a.code, a.type]));
  const bal = (codes: string[], sign: 1 | -1 = 1) => r2(all.filter((r) => codes.includes(r.code)).reduce((s, r) => s + sign * (r.dr - r.cr), 0));
  const profit = r2(month.reduce((s, r) => s + (type.get(r.code) === 'income' ? r.cr - r.dr : type.get(r.code) === 'expense' ? -(r.dr - r.cr) : 0), 0));
  const [{ entries }] = (await db.execute<{ entries: string }>(sql`select count(*)::text entries from journal_entries where date between ${monthStart} and ${today}`)).rows;
  const errors = await db.select().from(postingErrors).orderBy(desc(postingErrors.lastAt)).limit(20);
  const [lastClosed] = await db.select().from(accountingPeriods).orderBy(desc(accountingPeriods.period)).limit(1);
  res.json({ currency: await currencyOf(b.country), country: b.country,
    cash: bal([ACC.CASH, ACC.BANK, ACC.GATEWAY]), receivable: bal([ACC.AR_MURABAHAH, ACC.DEFERRED_MARGIN]), deferredMargin: bal([ACC.DEFERRED_MARGIN], -1),
    inventory: bal([ACC.INVENTORY]), charity: bal([ACC.CHARITY], -1), payable: bal([ACC.AP], -1), downPayments: bal([ACC.DP_MURABAHAH], -1),
    monthProfit: profit, monthEntries: Number(entries), pending: await pendingCount(), errors, lastClosed: lastClosed?.period ?? null,
  });
});

accountingRouter.post('/accounting/sync', BOOKKEEPER, async (_req, res) => {
  res.json(await syncJournals({ retryErrors: true }));
});

// ---------------------------------------------------------------------------
// Bagan akun
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/accounts', async (_req, res) => {
  const accs = await accounts();
  const { rows } = await db.execute<{ code: string; n: string }>(sql`select account_code code, count(*)::text n from journal_lines group by 1`);
  const used = new Map(rows.map((r) => [r.code, Number(r.n)]));
  res.json({ accounts: accs.map((a) => ({ ...a, lines: used.get(a.code) ?? 0 })) });
});

const accountBody = z.object({
  code: z.string().regex(/^\d{4,6}$/, 'Kode akun 4-6 digit angka'),
  name: z.string().trim().min(3, 'Nama akun minimal 3 karakter').max(120),
  type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  normal: z.enum(['debit', 'credit']).optional(),
  groupName: z.string().trim().max(48).optional(),
  description: z.string().trim().max(300).nullish(),
});
accountingRouter.post('/accounting/accounts', BOOKKEEPER, async (req, res) => {
  const b = parseBody(accountBody, req.body);
  const first = { asset: '1', liability: '2', equity: '3', income: '4', expense: ['5', '6', '7', '8', '9'] }[b.type];
  if (!(Array.isArray(first) ? first : [first]).includes(b.code[0])) throw new HttpError(400, 'Digit pertama kode tidak sesuai tipe (1 aset, 2 kewajiban, 3 ekuitas, 4 pendapatan, 5-9 beban)');
  const normal = b.normal ?? (['asset', 'expense'].includes(b.type) ? 'debit' : 'credit');
  const [a] = await db.insert(coaAccounts).values({ ...b, normal, groupName: b.groupName ?? '', description: b.description ?? null }).onConflictDoNothing().returning();
  if (!a) throw new HttpError(409, `Kode akun ${b.code} sudah dipakai`);
  await writeAudit(req, { action: 'accounting.account_create', entityType: 'coa', entityId: a.code, after: a });
  res.status(201).json({ account: a });
});
accountingRouter.patch('/accounting/accounts/:code', BOOKKEEPER, async (req, res) => {
  const b = parseBody(z.object({ name: z.string().trim().min(3).max(120).optional(), groupName: z.string().trim().max(48).optional(), description: z.string().trim().max(300).nullish(), isActive: z.boolean().optional() }), req.body);
  const [a] = await db.select().from(coaAccounts).where(eq(coaAccounts.code, String(req.params.code))).limit(1);
  if (!a) throw new HttpError(404, 'Akun tidak ditemukan');
  if (b.isActive === false && a.isSystem) throw new HttpError(409, 'Akun sistem dipakai posting otomatis dan tidak bisa dinonaktifkan');
  const [after] = await db.update(coaAccounts).set(b).where(eq(coaAccounts.code, a.code)).returning();
  await writeAudit(req, { action: 'accounting.account_update', entityType: 'coa', entityId: a.code, before: a, after });
  res.json({ account: after });
});

// ---------------------------------------------------------------------------
// Jurnal
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/journals', async (req, res) => {
  const b = scopeBranch(req);
  const { from, to } = range(req);
  const st = typeof req.query.sourceType === 'string' && req.query.sourceType ? req.query.sourceType : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const { rows } = await db.execute<Record<string, string>>(sql`
    select e.id, e.entry_no, e.date, e.source_type, e.source_no, e.memo, e.status, sum(l.debit)::text total, count(*) over()::text full_count
    from journal_entries e join journal_lines l on l.entry_id = e.id
    where e.date between ${from} and ${to}
      ${st ? sql`and e.source_type = ${st}` : sql``}
      ${q ? sql`and (e.entry_no ilike ${`%${q}%`} or e.source_no ilike ${`%${q}%`} or e.memo ilike ${`%${q}%`})` : sql``}
      and exists (select 1 from journal_lines l where l.entry_id = e.id ${branchCond(b)})
    group by e.id order by e.date desc, e.entry_no desc limit 50 offset ${(page - 1) * 50}`);
  res.json({
    total: Number(rows[0]?.full_count ?? 0), page,
    entries: rows.map((r) => ({ id: r.id, entryNo: r.entry_no, date: r.date, sourceType: r.source_type, sourceNo: r.source_no, memo: r.memo, status: r.status, total: n(r.total) })),
  });
});

accountingRouter.get('/accounting/journals/:id', async (req, res) => {
  const [e] = await db.select({ e: journalEntries, by: users.fullName }).from(journalEntries).leftJoin(users, eq(users.id, journalEntries.createdBy))
    .where(eq(journalEntries.id, z.uuid().parse(req.params.id))).limit(1);
  if (!e) throw new HttpError(404, 'Jurnal tidak ditemukan');
  const lines = await db.select({ l: journalLines, account: coaAccounts.name, branch: branches.name, branchCode: branches.code })
    .from(journalLines).innerJoin(coaAccounts, eq(coaAccounts.code, journalLines.accountCode)).innerJoin(branches, eq(branches.id, journalLines.branchId))
    .where(eq(journalLines.entryId, e.e.id)).orderBy(journalLines.lineNo);
  const b = scopeBranch(req);
  if (req.user!.roleCode === 'branch-manager' && !lines.some((x) => x.l.branchId === b.branchId)) throw new HttpError(404, 'Jurnal tidak ditemukan');
  const [rev] = await db.select({ id: journalEntries.id, entryNo: journalEntries.entryNo }).from(journalEntries).where(eq(journalEntries.reversalOf, e.e.id)).limit(1);
  res.json({ entry: { ...e.e, createdByName: e.by, reversedBy: rev ?? null }, lines: lines.map((x) => ({ ...x.l, accountName: x.account, branchName: x.branch, branchCode: x.branchCode })) });
});

accountingRouter.post('/accounting/journals', BOOKKEEPER, async (req, res) => {
  const b = parseBody(z.object({
    date: dateStr, memo: z.string().trim().min(5, 'Keterangan minimal 5 karakter').max(500),
    lines: z.array(z.object({ accountCode: z.string(), branchId: z.uuid('Pilih kantor'), debit: z.number().min(0), credit: z.number().min(0), memo: z.string().trim().max(200).nullish() })).min(2).max(60),
  }), req.body);
  const e = await createManualJournal(req.user!, b);
  await writeAudit(req, { action: 'accounting.journal_create', entityType: 'journal', entityId: e.id, after: { entryNo: e.entryNo, ...b } });
  res.status(201).json({ entry: e });
});

accountingRouter.post('/accounting/journals/:id/reverse', BOOKKEEPER, async (req, res) => {
  const b = parseBody(z.object({ date: dateStr.optional(), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(300) }), req.body);
  const e = await reverseJournal(req.user!, z.uuid().parse(req.params.id), b);
  await writeAudit(req, { action: 'accounting.journal_reverse', entityType: 'journal', entityId: String(req.params.id), after: { reversal: e.entryNo, reason: b.reason } });
  res.status(201).json({ entry: e });
});

// ---------------------------------------------------------------------------
// Buku besar & neraca saldo
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/ledger', async (req, res) => {
  const b = scopeBranch(req);
  const { from, to } = range(req);
  const code = z.string().min(4).parse(req.query.account);
  const [acc] = await db.select().from(coaAccounts).where(eq(coaAccounts.code, code)).limit(1);
  if (!acc) throw new HttpError(404, 'Akun tidak ditemukan');
  const sign = acc.normal === 'debit' ? 1 : -1;
  const { rows: [o] } = await db.execute<{ v: string | null }>(sql`
    select sum(l.debit - l.credit) v from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.account_code = ${code} and e.date < ${from} ${branchCond(b)}`);
  const opening = r2(sign * n(o?.v));
  const { rows } = await db.execute<Record<string, string>>(sql`
    select e.id entry_id, e.entry_no, e.date, e.source_type, e.source_no, e.memo, l.memo line_memo, l.debit, l.credit, br.code branch_code
    from journal_lines l join journal_entries e on e.id = l.entry_id join branches br on br.id = l.branch_id
    where l.account_code = ${code} and e.date between ${from} and ${to} ${branchCond(b)}
    order by e.date, e.entry_no, l.line_no limit 2000`);
  let run = opening;
  const lines = rows.map((r) => {
    run = r2(run + sign * (n(r.debit) - n(r.credit)));
    return { entryId: r.entry_id, entryNo: r.entry_no, date: r.date, sourceType: r.source_type, sourceNo: r.source_no, memo: r.line_memo ? `${r.memo} · ${r.line_memo}` : r.memo, branchCode: r.branch_code, debit: n(r.debit), credit: n(r.credit), balance: run };
  });
  res.json({ currency: await currencyOf(b.country), country: b.country, account: acc, from, to, opening, closing: run, debit: r2(lines.reduce((s, l) => s + l.debit, 0)), credit: r2(lines.reduce((s, l) => s + l.credit, 0)), lines, truncated: rows.length >= 2000 });
});

accountingRouter.get('/accounting/trial-balance', async (req, res) => {
  const b = scopeBranch(req);
  const { from, to } = range(req);
  const [open, mov, accs] = await Promise.all([sums(sql`and e.date < ${from} ${branchCond(b)}`), sums(sql`and e.date between ${from} and ${to} ${branchCond(b)}`), accounts()]);
  const agg = (rows: typeof open, code: string) => rows.filter((r) => r.code === code).reduce((s, r) => ({ dr: s.dr + r.dr, cr: s.cr + r.cr }), { dr: 0, cr: 0 });
  const rows = accs.map((a) => {
    const o = agg(open, a.code), m = agg(mov, a.code);
    const openNet = r2(o.dr - o.cr), closeNet = r2(openNet + m.dr - m.cr);
    return { code: a.code, name: a.name, type: a.type, normal: a.normal, groupName: a.groupName,
      openingDebit: Math.max(0, openNet), openingCredit: Math.max(0, -openNet), debit: r2(m.dr), credit: r2(m.cr), closingDebit: Math.max(0, closeNet), closingCredit: Math.max(0, -closeNet) };
  }).filter((r) => r.openingDebit || r.openingCredit || r.debit || r.credit);
  const tot = (k: keyof typeof rows[number]) => r2(rows.reduce((s, r) => s + (r[k] as number), 0));
  const totals = { openingDebit: tot('openingDebit'), openingCredit: tot('openingCredit'), debit: tot('debit'), credit: tot('credit'), closingDebit: tot('closingDebit'), closingCredit: tot('closingCredit') };
  res.json({ currency: await currencyOf(b.country), country: b.country, from, to, rows, totals, balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01 });
});

// ---------------------------------------------------------------------------
// Laba rugi & neraca (konsolidasi + kolom per kantor)
// ---------------------------------------------------------------------------
type Row = { code: string; name: string; group: string; byBranch: Record<string, number>; total: number };
function buildRows(accs: Awaited<ReturnType<typeof accounts>>, data: Awaited<ReturnType<typeof sums>>, types: string[], signOf: (type: string) => 1 | -1) {
  const rows: Row[] = [];
  for (const a of accs.filter((x) => types.includes(x.type))) {
    const byBranch: Record<string, number> = {};
    for (const d of data.filter((x) => x.code === a.code)) byBranch[d.branchId] = r2((byBranch[d.branchId] ?? 0) + signOf(a.type) * (d.dr - d.cr));
    const total = r2(Object.values(byBranch).reduce((s, v) => s + v, 0));
    if (total || Object.values(byBranch).some(Boolean)) rows.push({ code: a.code, name: a.name, group: a.groupName, byBranch, total });
  }
  return rows;
}
const sumBy = (rows: Row[], branchIds: string[]) => {
  const byBranch: Record<string, number> = {};
  for (const id of branchIds) byBranch[id] = r2(rows.reduce((s, r) => s + (r.byBranch[id] ?? 0), 0));
  return { byBranch, total: r2(rows.reduce((s, r) => s + r.total, 0)) };
};
const groupRows = (rows: Row[], branchIds: string[]) => {
  const groups = [...new Set(rows.map((r) => r.group))];
  return groups.map((g) => { const rs = rows.filter((r) => r.group === g); return { group: g, rows: rs, ...sumBy(rs, branchIds) }; });
};

async function incomeStatement(b: Scope, from: string, to: string) {
  const [data, accs, brs] = await Promise.all([sums(sql`and e.date between ${from} and ${to} ${branchCond(b)}`), accounts(), branchList(b)]);
  const ids = brs.map((x) => x.id);
  const income = buildRows(accs, data, ['income'], () => -1);
  const expense = buildRows(accs, data, ['expense'], () => 1);
  const ti = sumBy(income, ids), te = sumBy(expense, ids);
  const net = { byBranch: Object.fromEntries(ids.map((id) => [id, r2(ti.byBranch[id] - te.byBranch[id])])), total: r2(ti.total - te.total) };
  return { currency: await currencyOf(b.country), country: b.country, branches: brs, from, to, income: groupRows(income, ids), totalIncome: ti, expense: groupRows(expense, ids), totalExpense: te, netIncome: net };
}

accountingRouter.get('/accounting/income-statement', async (req, res) => {
  const { from, to } = range(req);
  res.json(await incomeStatement(scopeBranch(req), from, to));
});

accountingRouter.get('/accounting/balance-sheet', async (req, res) => {
  const b = scopeBranch(req);
  const asOf = typeof req.query.asOf === 'string' && req.query.asOf ? dateStr.parse(req.query.asOf) : wibDate();
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const [data, accs, brs] = await Promise.all([sums(sql`and e.date <= ${asOf} ${branchCond(b)}`), accounts(), branchList(b)]);
  const ids = brs.map((x) => x.id);
  const assets = buildRows(accs, data, ['asset'], () => 1);
  const liabilities = buildRows(accs, data, ['liability'], () => -1);
  const equity = buildRows(accs, data, ['equity'], () => -1);
  const cy = await incomeStatement(b, yearStart, asOf);
  const prior = yearStart > '1900-01-01' ? await incomeStatement(b, '1900-01-01', (() => { const d = new Date(`${yearStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })()) : null;
  if (prior && (prior.netIncome.total || Object.values(prior.netIncome.byBranch).some(Boolean))) equity.push({ code: '', name: 'Laba ditahan tahun lalu (belum ditutup)', group: 'Ekuitas', byBranch: prior.netIncome.byBranch, total: prior.netIncome.total });
  equity.push({ code: '', name: `Laba tahun berjalan ${asOf.slice(0, 4)}`, group: 'Ekuitas', byBranch: cy.netIncome.byBranch, total: cy.netIncome.total });
  const ta = sumBy(assets, ids), tl = sumBy(liabilities, ids), tq = sumBy(equity, ids);
  const tle = { byBranch: Object.fromEntries(ids.map((id) => [id, r2(tl.byBranch[id] + tq.byBranch[id])])), total: r2(tl.total + tq.total) };
  res.json({ currency: await currencyOf(b.country), country: b.country, branches: brs, asOf, assets: groupRows(assets, ids), totalAssets: ta, liabilities: groupRows(liabilities, ids), totalLiabilities: tl,
    equity: groupRows(equity, ids), totalEquity: tq, totalLiabilitiesEquity: tle, balanced: Math.abs(ta.total - tle.total) < 0.01 });
});

// ---------------------------------------------------------------------------
// Dana kebajikan (ta'zir)
// ---------------------------------------------------------------------------
export const CHARITY_PURPOSES: Record<string, string> = {
  social: 'Bantuan sosial / fakir miskin', education: 'Pendidikan', health: 'Kesehatan', disaster: 'Bencana alam', worship: 'Sarana ibadah', other: 'Lainnya',
};

accountingRouter.get('/accounting/charity', async (req, res) => {
  const b = scopeBranch(req);
  const { from, to } = range(req);
  const { rows: [o] } = await db.execute<{ v: string | null }>(sql`
    select sum(l.credit - l.debit) v from journal_lines l join journal_entries e on e.id = l.entry_id where l.account_code = ${ACC.CHARITY} and e.date < ${from} ${branchCond(b)}`);
  const { rows: inflow } = await db.execute<{ branch: string; n: string; v: string }>(sql`
    select br.name branch, count(*)::text n, sum(l.credit)::text v from journal_lines l join journal_entries e on e.id = l.entry_id join branches br on br.id = l.branch_id
    where l.account_code = ${ACC.CHARITY} and l.credit > 0 and e.date between ${from} and ${to} ${branchCond(b)} group by br.name order by br.name`);
  const { rows: inList } = await db.execute<Record<string, string>>(sql`
    select e.date, e.source_no, br.code branch_code, l.credit amount, c.full_name customer, a.contract_no
    from journal_lines l join journal_entries e on e.id = l.entry_id join branches br on br.id = l.branch_id
    left join credit_applications a on a.id = l.sub_id left join customers c on c.id = a.customer_id
    where l.account_code = ${ACC.CHARITY} and l.credit > 0 and e.date between ${from} and ${to} ${branchCond(b)} order by e.date desc limit 200`);
  const disb = await db.select({ d: charityDisbursements, branch: branches.name, by: users.fullName }).from(charityDisbursements)
    .innerJoin(branches, eq(branches.id, charityDisbursements.branchId)).innerJoin(users, eq(users.id, charityDisbursements.createdBy))
    .where(and(sql`${charityDisbursements.date} between ${from} and ${to}`, b.branchId ? eq(charityDisbursements.branchId, b.branchId) : eq(branches.countryCode, b.country))).orderBy(desc(charityDisbursements.date));
  const opening = r2(n(o?.v)), totalIn = r2(inflow.reduce((s, r) => s + n(r.v), 0)), totalOut = r2(disb.reduce((s, x) => s + x.d.amount, 0));
  const byPurpose = Object.entries(CHARITY_PURPOSES).map(([k, label]) => ({ purpose: k, label, amount: r2(disb.filter((x) => x.d.purpose === k).reduce((s, x) => s + x.d.amount, 0)) })).filter((x) => x.amount);
  res.json({ currency: await currencyOf(b.country), country: b.country, from, to, opening, totalIn, totalOut, closing: r2(opening + totalIn - totalOut), purposes: CHARITY_PURPOSES, byPurpose,
    inflowByBranch: inflow.map((r) => ({ branch: r.branch, count: Number(r.n), amount: n(r.v) })),
    inflows: inList.map((r) => ({ date: r.date, paymentNo: r.source_no, branchCode: r.branch_code, amount: n(r.amount), customer: r.customer, contractNo: r.contract_no })),
    disbursements: disb.map((x) => ({ ...x.d, branchName: x.branch, createdByName: x.by })) });
});

accountingRouter.post('/accounting/charity', BOOKKEEPER, async (req, res) => {
  const b = parseBody(z.object({
    branchId: z.uuid('Pilih kantor'), date: dateStr, recipient: z.string().trim().min(3, 'Isi penerima').max(200), purpose: z.enum(Object.keys(CHARITY_PURPOSES) as [string, ...string[]]),
    description: z.string().trim().min(5, 'Keterangan minimal 5 karakter').max(500), amount: z.number().positive('Nominal harus lebih dari 0'),
    method: z.enum(['cash', 'transfer']), ref: z.string().trim().max(64).nullish(),
  }), req.body);
  if (b.date > wibDate()) throw new HttpError(400, 'Tanggal tidak boleh di masa depan');
  if (b.method === 'transfer' && !b.ref) throw new HttpError(400, 'Isi nomor referensi transfer');
  const [br] = await db.select({ c: branches.countryCode }).from(branches).where(eq(branches.id, b.branchId)).limit(1);
  if (!br) throw new HttpError(400, 'Kantor tidak dikenal');
  const { rows: [bal] } = await db.execute<{ v: string | null }>(sql`select sum(credit - debit) v from journal_lines where account_code = ${ACC.CHARITY} and branch_id in (select id from branches where country_code = ${br.c})`);
  if (b.amount - n(bal?.v) > 0.009) throw new HttpError(400, `Saldo dana kebajikan tidak cukup (tersedia ${n(bal?.v).toLocaleString('id-ID')})`);
  const d = await db.transaction(async (tx) => {
    const [row] = await tx.insert(charityDisbursements).values({ ...b, ref: b.ref ?? null, disbNo: await charityNo(tx), createdBy: req.user!.id }).returning();
    return row;
  });
  await syncJournals();
  await writeAudit(req, { action: 'accounting.charity_disburse', entityType: 'charity', entityId: d.id, after: d });
  res.status(201).json({ disbursement: d });
});

// ---------------------------------------------------------------------------
// Rekonsiliasi buku pembantu piutang Murabahah vs data operasional
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/reconciliation', async (req, res) => {
  const b = scopeBranch(req);
  const { rows } = await db.execute<Record<string, string>>(sql`
    select a.id, a.contract_no, a.status, br.code branch_code, c.full_name customer,
      coalesce((select sum(i.amount - i.paid_amount) from installments i where i.application_id = a.id and i.status <> 'paid'), 0)::text ops_outstanding,
      coalesce((select sum(l.debit - l.credit) from journal_lines l where l.sub_type = 'credit' and l.sub_id = a.id and l.account_code = ${ACC.AR_MURABAHAH}), 0)::text gl_ar,
      coalesce((select sum(l.credit - l.debit) from journal_lines l where l.sub_type = 'credit' and l.sub_id = a.id and l.account_code = ${ACC.DEFERRED_MARGIN}), 0)::text gl_deferred,
      coalesce((select sum(l.credit - l.debit) from journal_lines l where l.sub_type = 'credit' and l.sub_id = a.id and l.account_code = ${ACC.DP_MURABAHAH}), 0)::text gl_dp,
      coalesce((select sum(l.credit - l.debit) from journal_lines l where l.sub_type = 'credit' and l.sub_id = a.id and l.account_code = ${ACC.MARGIN_INCOME}), 0)::text gl_margin_income
    from credit_applications a join branches br on br.id = a.branch_id join customers c on c.id = a.customer_id
    where a.contract_no is not null ${b.branchId ? sql`and a.branch_id = ${b.branchId}` : sql`and br.country_code = ${b.country}`}
    order by a.contract_signed_at desc limit 500`);
  const items = rows.map((r) => {
    const ops = ['active'].includes(r.status) ? n(r.ops_outstanding) : 0;
    const ar = n(r.gl_ar), dp = n(r.gl_dp);
    const issue = r.status === 'active' && Math.abs(ops - ar) > 0.5 ? 'Piutang buku besar ≠ sisa angsuran'
      : r.status === 'paid_off' && (Math.abs(ar) > 0.5 || Math.abs(n(r.gl_deferred)) > 0.5) ? 'Lunas tetapi masih ada saldo piutang / margin'
      : r.status === 'contracted' && Math.abs(ar) > 0.5 ? 'Belum serah terima tetapi piutang sudah tercatat'
      : ['active', 'paid_off'].includes(r.status) && Math.abs(dp) > 0.5 ? 'Uang muka belum diterapkan'
      : null;
    return { id: r.id, contractNo: r.contract_no, status: r.status, branchCode: r.branch_code, customer: r.customer, opsOutstanding: r2(ops), glReceivable: r2(ar), glDeferredMargin: r2(n(r.gl_deferred)), glDownPayment: r2(dp), marginIncome: r2(n(r.gl_margin_income)), issue };
  });
  res.json({ currency: await currencyOf(b.country), country: b.country, items, issues: items.filter((i) => i.issue).length });
});

// ---------------------------------------------------------------------------
// Tutup periode
// ---------------------------------------------------------------------------
accountingRouter.get('/accounting/periods', async (_req, res) => {
  const closed = await db.select({ p: accountingPeriods, by: users.fullName }).from(accountingPeriods).leftJoin(users, eq(users.id, accountingPeriods.closedBy));
  const { rows } = await db.execute<{ period: string; n: string; manual: string }>(sql`
    select substr(date, 1, 7) period, count(*)::text n, count(*) filter (where source_type = 'manual')::text manual from journal_entries group by 1 order by 1 desc limit 36`);
  const map = new Map(closed.map((c) => [c.p.period, c]));
  const cur = wibDate().slice(0, 7);
  const periods = [...new Set([cur, ...rows.map((r) => r.period), ...closed.map((c) => c.p.period)])].sort().reverse().map((p) => {
    const c = map.get(p), r = rows.find((x) => x.period === p);
    return { period: p, entries: Number(r?.n ?? 0), manual: Number(r?.manual ?? 0), closed: !!c, closedAt: c?.p.closedAt ?? null, closedBy: c?.by ?? null, note: c?.p.note ?? null };
  });
  res.json({ periods, current: cur });
});

accountingRouter.post('/accounting/periods/:period/close', BOOKKEEPER, async (req, res) => {
  const period = z.string().regex(/^\d{4}-\d{2}$/).parse(req.params.period);
  const { note } = parseBody(z.object({ note: z.string().trim().max(300).nullish() }), req.body);
  if (period >= wibDate().slice(0, 7)) throw new HttpError(400, 'Hanya periode yang sudah lewat yang bisa ditutup');
  await syncJournals();
  if (await pendingCount()) throw new HttpError(409, 'Masih ada transaksi yang belum terposting — jalankan posting dan selesaikan error terlebih dahulu');
  const [y, m] = period.split('-').map(Number);
  const before = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const [{ first }] = (await db.execute<{ first: string | null }>(sql`select min(substr(date, 1, 7)) first from journal_entries`)).rows;
  const [prevClosed] = await db.select().from(accountingPeriods).where(eq(accountingPeriods.period, before)).limit(1);
  if (first && before >= first && !prevClosed) throw new HttpError(409, `Tutup periode ${before} terlebih dahulu (berurutan)`);
  const [p] = await db.insert(accountingPeriods).values({ period, closedBy: req.user!.id, note: note ?? null }).onConflictDoNothing().returning();
  if (!p) throw new HttpError(409, 'Periode sudah ditutup');
  await writeAudit(req, { action: 'accounting.period_close', entityType: 'period', entityId: period, after: p });
  res.json({ period: p });
});

accountingRouter.post('/accounting/periods/:period/reopen', BOOKKEEPER, async (req, res) => {
  const period = z.string().regex(/^\d{4}-\d{2}$/).parse(req.params.period);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(300) }), req.body);
  const [later] = await db.select().from(accountingPeriods).where(sql`${accountingPeriods.period} > ${period}`).limit(1);
  if (later) throw new HttpError(409, `Buka periode ${later.period} terlebih dahulu`);
  const [p] = await db.delete(accountingPeriods).where(eq(accountingPeriods.period, period)).returning();
  if (!p) throw new HttpError(404, 'Periode belum ditutup');
  await writeAudit(req, { action: 'accounting.period_reopen', entityType: 'period', entityId: period, before: p, after: { reason } });
  res.json({ ok: true });
});

