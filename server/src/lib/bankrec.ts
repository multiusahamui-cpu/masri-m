import crypto from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bankAccounts, bankImports, bankLines, branches } from '../db/schema.js';
import { HttpError } from './http.js';
import type { AuthUser } from '../middleware/auth.js';

/**
 * Rekonsiliasi rekening koran.
 * 1. Impor mutasi (CSV) — preset BCA / Mandiri / BSI atau pemetaan kolom bebas; baris ganda diabaikan (hash).
 * 2. Pencocokan otomatis dengan dokumen yang sudah dijurnal ke akun Bank: setoran shift, transfer nasabah,
 *    pembayaran pemasok, refund, biaya, penyaluran dana kebajikan.
 * 3. Sisanya dicocokkan manual atau dibukukan langsung: pencairan payment gateway (bruto − MDR), biaya bank, pendapatan lain.
 */
export type ColumnMap = NonNullable<typeof bankAccounts.$inferSelect['columnMap']>;
export interface ParsedLine { txDate: string; description: string; reference: string | null; debit: number; credit: number; balance: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// CSV & format bank
// ---------------------------------------------------------------------------
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  // Pemisah: yang paling banyak muncul di satu baris pada 15 baris pertama (ekspor bank sering diawali baris judul tanpa pemisah)
  const head = src.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  const d = delimiter || ([';', '\t', ','].map((c) => [c, Math.max(0, ...head.map((l) => l.split(c).length))] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
/** Tanggal: dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, dd MMM yyyy (Indonesia / Inggris), dd/mm (tahun dari konteks). */
export function parseDate(v: string, fmt = 'dmy', yearHint?: number): string | null {
  const s = v.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(year(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return fmt === 'mdy' ? iso(year(+m[3]), +m[1], +m[2]) : iso(year(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m && yearHint) return iso(yearHint, +m[2], +m[1]);
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function iso(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Angka: 1.234.567,89 | 1,234,567.89 | 1234567 | (1.000) | 1.000,00 CR | -500 */
export function parseAmount(v: string | undefined, decimal?: ',' | '.'): { value: number; dc: 'D' | 'C' | null } | null {
  if (v == null) return null;
  let s = v.trim().toUpperCase();
  if (!s || s === '-') return null;
  let dc: 'D' | 'C' | null = null;
  const suffix = /\s*(CR|DB|DR|K|D|C)\.?$/.exec(s);
  if (suffix) { dc = suffix[1].startsWith('C') || suffix[1] === 'K' ? 'C' : 'D'; s = s.slice(0, suffix.index); }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  let dec = decimal;
  if (!dec) {
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) dec = lc > ld ? ',' : '.';
    else if (lc >= 0) dec = /,\d{1,2}$/.test(s) && (s.match(/,/g) ?? []).length === 1 ? ',' : '.';
    else dec = /\.\d{1,2}$/.test(s) && (s.match(/\./g) ?? []).length === 1 ? '.' : ',';
  }
  s = dec === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { value: r2(neg ? -n : n), dc };
}

const ALIASES: Record<keyof Omit<ColumnMap, 'dateFormat' | 'decimal' | 'delimiter' | 'skipRows'>, string[]> = {
  date: ['tanggal transaksi', 'tgl transaksi', 'tanggal', 'tgl', 'date', 'transaction date', 'trans. date', 'posting date', 'post date', 'tanggal posting'],
  description: ['keterangan', 'description', 'uraian', 'uraian transaksi', 'remark', 'remarks', 'narrative', 'transaction description', 'deskripsi'],
  debit: ['debit', 'debet', 'mutasi debet', 'mutasi debit', 'withdrawal', 'withdrawals', 'db', 'dr', 'debit amount'],
  credit: ['credit', 'kredit', 'mutasi kredit', 'deposit', 'deposits', 'cr', 'credit amount'],
  amount: ['jumlah', 'amount', 'mutasi', 'nominal', 'nilai'],
  dc: ['d/k', 'db/cr', 'dk', 'cr/db', 'd/c', 'dc', 'type', 'jenis'],
  balance: ['saldo', 'balance', 'running balance', 'saldo akhir'],
  reference: ['reference no.', 'reference no', 'reference', 'no. referensi', 'no referensi', 'ref', 'no ref', 'ref no', 'nomor referensi'],
};
export const PRESETS: Record<string, { label: string; note: string; decimal?: ',' | '.'; dateFormat: string }> = {
  generic: { label: 'CSV umum (pemetaan kolom)', note: 'Pilih kolom tanggal, keterangan, debit/kredit (atau jumlah + D/K), saldo.', dateFormat: 'dmy' },
  bca: { label: 'BCA (KlikBCA Bisnis)', note: 'Ekspor mutasi CSV. Kolom Jumlah berakhiran CR / DB.', decimal: '.', dateFormat: 'dmy' },
  mandiri: { label: 'Mandiri (Cash Management)', note: 'Ekspor mutasi CSV dengan kolom Debit & Credit terpisah.', decimal: '.', dateFormat: 'dmy' },
  bsi: { label: 'BSI (BSI Net / Cash Management)', note: 'Ekspor mutasi CSV dengan kolom Debet & Kredit; format angka Indonesia.', decimal: ',', dateFormat: 'dmy' },
};

/** Tentukan pemetaan kolom dari baris header (alias per preset), kecuali pemetaan disimpan pengguna. */
export function detectColumns(header: string[], saved?: ColumnMap | null, preset = 'generic'): ColumnMap & { headerIndex: Record<string, number> } {
  const norm = header.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const pick = (key: keyof typeof ALIASES) => {
    const want = saved?.[key];
    if (want) { const i = norm.indexOf(want.toLowerCase().trim()); return i >= 0 ? i : -1; }
    for (const a of ALIASES[key]) { const i = norm.indexOf(a); if (i >= 0) return i; }
    return -1;
  };
  const idx: Record<string, number> = {};
  for (const k of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) idx[k] = pick(k);
  // kolom debit/credit yang terdeteksi sama dengan kolom D/K (mis. "DB") diabaikan bila ada kolom jumlah
  if (idx.amount >= 0 && (idx.debit === idx.dc || idx.credit === idx.dc)) { idx.debit = -1; idx.credit = -1; }
  if (idx.date < 0) throw new HttpError(400, 'Kolom tanggal tidak ditemukan — pilih pemetaan kolom secara manual');
  if (idx.description < 0) throw new HttpError(400, 'Kolom keterangan tidak ditemukan — pilih pemetaan kolom secara manual');
  if (idx.amount < 0 && idx.debit < 0 && idx.credit < 0) throw new HttpError(400, 'Kolom nominal (debit/kredit atau jumlah) tidak ditemukan');
  const p = PRESETS[preset] ?? PRESETS.generic;
  const name = (i: number) => (i >= 0 ? header[i] : undefined);
  return {
    date: header[idx.date], description: header[idx.description], debit: name(idx.debit), credit: name(idx.credit), amount: name(idx.amount), dc: name(idx.dc),
    balance: name(idx.balance), reference: name(idx.reference), dateFormat: saved?.dateFormat ?? p.dateFormat, decimal: saved?.decimal ?? p.decimal,
    headerIndex: idx,
  };
}

/** Uraikan CSV menjadi baris mutasi. Mengembalikan baris valid & catatan baris yang dilewati. */
export function parseStatement(text: string, preset: string, saved?: ColumnMap | null) {
  const rows = parseCsv(text, saved?.delimiter);
  if (rows.length < 2) throw new HttpError(400, 'File kosong atau bukan CSV');
  // Header = baris pertama (setelah skipRows) yang memuat kolom tanggal & keterangan
  let h = saved?.skipRows ?? -1;
  if (h < 0) {
    h = rows.findIndex((r) => r.some((c) => ALIASES.date.includes(c.toLowerCase().trim())) && r.some((c) => ALIASES.description.includes(c.toLowerCase().trim())));
    if (h < 0) h = 0;
  }
  const map = detectColumns(rows[h], saved, preset);
  const ix = map.headerIndex;
  const dec = map.decimal || undefined;
  const years = rows.slice(h + 1).map((r) => /\b(20\d{2})\b/.exec(r[ix.date] ?? '')?.[1]).filter(Boolean);
  const yearHint = years.length ? Number(years[0]) : new Date().getFullYear();
  const lines: ParsedLine[] = [];
  const skipped: { row: number; reason: string }[] = [];
  rows.slice(h + 1).forEach((r, k) => {
    const rowNo = h + k + 2;
    const rawDate = r[ix.date] ?? '';
    if (/^(saldo|opening|closing|total|ending|starting|beginning)/i.test(rawDate) || /^(saldo awal|saldo akhir|total)/i.test(r[ix.description] ?? '')) return;
    if (/^pend/i.test(rawDate)) { skipped.push({ row: rowNo, reason: 'transaksi PEND (belum efektif)' }); return; }
    const txDate = parseDate(rawDate, map.dateFormat, yearHint);
    if (!txDate) { if (rawDate) skipped.push({ row: rowNo, reason: `tanggal tidak dikenali "${rawDate}"` }); return; }
    let debit = 0, credit = 0;
    if (ix.amount >= 0) {
      const a = parseAmount(r[ix.amount], dec);
      if (!a) { skipped.push({ row: rowNo, reason: 'nominal kosong' }); return; }
      let dc = a.dc;
      if (ix.dc >= 0) { const t = (r[ix.dc] ?? '').trim().toUpperCase(); if (/^(C|CR|K|KREDIT|CREDIT)/.test(t)) dc = 'C'; else if (/^(D|DB|DR|DEBET|DEBIT)/.test(t)) dc = 'D'; }
      if (!dc) dc = a.value < 0 ? 'D' : 'C';
      if (dc === 'C') credit = Math.abs(a.value); else debit = Math.abs(a.value);
    } else {
      debit = Math.abs(parseAmount(r[ix.debit], dec)?.value ?? 0);
      credit = Math.abs(parseAmount(r[ix.credit], dec)?.value ?? 0);
    }
    if (!debit && !credit) { skipped.push({ row: rowNo, reason: 'nominal nol' }); return; }
    const bal = ix.balance >= 0 ? parseAmount(r[ix.balance], dec) : null;
    lines.push({ txDate, description: (r[ix.description] ?? '').slice(0, 500), reference: ix.reference >= 0 ? (r[ix.reference] || null) : null, debit, credit, balance: bal ? (bal.dc === 'D' ? -bal.value : bal.value) : null });
  });
  const { headerIndex: _h, ...columnMap } = map;
  return { lines, skipped, columnMap: { ...columnMap, skipRows: h } as ColumnMap, header: rows[h] };
}

// ---------------------------------------------------------------------------
// Impor
// ---------------------------------------------------------------------------
export async function importStatement(actor: AuthUser, accountId: string, p: { filename: string; content: string; columnMap?: ColumnMap | null; saveMap?: boolean }) {
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1);
  if (!acc) throw new HttpError(404, 'Rekening tidak ditemukan');
  if (p.content.length > 5_000_000) throw new HttpError(413, 'File terlalu besar (maks. 5 MB)');
  const parsed = parseStatement(p.content, acc.preset, p.columnMap ?? acc.columnMap);
  if (!parsed.lines.length) throw new HttpError(400, `Tidak ada baris mutasi yang terbaca${parsed.skipped.length ? ` (${parsed.skipped[0].reason})` : ''}`);
  const seen = new Map<string, number>();
  const rows = parsed.lines.map((l) => {
    const base = [acc.id, l.txDate, l.description, l.reference ?? '', l.debit.toFixed(2), l.credit.toFixed(2), l.balance?.toFixed(2) ?? ''].join('|');
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { ...l, hash: crypto.createHash('sha256').update(`${base}|${n}`).digest('hex') };
  });
  const dates = rows.map((r) => r.txDate).sort();
  // Sebagian bank mengekspor terbaru di atas: urutan baris disimpan agar saldo terakhir per tanggal tepat
  const newestLast = rows[0].txDate <= rows[rows.length - 1].txDate;
  const last = [...rows].reverse().find((r) => r.balance != null);
  return db.transaction(async (tx) => {
    const [imp] = await tx.insert(bankImports).values({ accountId: acc.id, filename: p.filename.slice(0, 200), rowsTotal: rows.length, rowsNew: 0, dateFrom: dates[0], dateTo: dates[dates.length - 1],
      closingBalance: last?.balance ?? null, importedBy: actor.id }).returning();
    const inserted = await tx.insert(bankLines).values(rows.map((r, k) => ({ accountId: acc.id, importId: imp.id, txDate: r.txDate, description: r.description, reference: r.reference,
      debit: r.debit, credit: r.credit, balance: r.balance, hash: r.hash, seq: newestLast ? k + 1 : rows.length - k }))).onConflictDoNothing().returning({ id: bankLines.id });
    await tx.update(bankImports).set({ rowsNew: inserted.length }).where(eq(bankImports.id, imp.id));
    if (p.saveMap !== false && (p.columnMap || !acc.columnMap)) await tx.update(bankAccounts).set({ columnMap: parsed.columnMap }).where(eq(bankAccounts.id, acc.id));
    return { importId: imp.id, rows: rows.length, newRows: inserted.length, duplicates: rows.length - inserted.length, skipped: parsed.skipped, dateFrom: dates[0], dateTo: dates[dates.length - 1], columnMap: parsed.columnMap };
  }).then(async (r) => ({ ...r, autoMatched: await autoMatch(accountId) }));
}

// ---------------------------------------------------------------------------
// Pencocokan
// ---------------------------------------------------------------------------
export interface Candidate { type: string; id: string; no: string; amount: number; date: string; label: string }

/** Dokumen yang sudah membukukan uang masuk/keluar Bank (akun 1102) dan belum dicocokkan ke mutasi mana pun. */
export async function candidatesFor(line: typeof bankLines.$inferSelect, acc: typeof bankAccounts.$inferSelect, windowDays = 4, anyAmount = false): Promise<Candidate[]> {
  const amt = line.credit > 0 ? line.credit : line.debit;
  const [b] = await db.select({ country: branches.countryCode }).from(branches).where(eq(branches.id, acc.branchId)).limit(1);
  const from = new Date(Date.parse(line.txDate) - windowDays * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(line.txDate) + windowDays * 86400_000).toISOString().slice(0, 10);
  const amtCond = anyAmount ? sql`true` : sql`abs(x.amount - ${amt}) < 0.01`;
  const q = line.credit > 0 ? sql`
      select 'shift_deposit' t, s.id::text id, s.shift_no no, s.deposit_amount::float amount, (s.closed_at at time zone 'Asia/Jakarta')::date::text d, 'Setoran shift ' || coalesce(s.deposit_ref, '') label, s.branch_id
        from cashier_shifts s where s.closed_at is not null and coalesce(s.deposit_amount,0) > 0
      union all
      select 'customer_transfer', p.id::text, p.payment_no, (p.amount + p.tazir_amount)::float, (p.paid_at at time zone 'Asia/Jakarta')::date::text, p.kind || ' ' || p.ref_no || ' ' || coalesce(p.proof_ref,''), p.branch_id
        from payments p where p.status = 'paid' and p.method = 'transfer'` : sql`
      select 'supplier_payment' t, sp.id::text id, sp.payment_no no, sp.amount::float amount, (sp.paid_at at time zone 'Asia/Jakarta')::date::text d, 'Bayar pemasok ' || coalesce(sp.bank_ref,'') label, sp.branch_id
        from supplier_payments sp where sp.method = 'transfer'
      union all
      select 'refund', r.id::text, r.refund_no, r.amount::float, (r.paid_at at time zone 'Asia/Jakarta')::date::text, 'Refund ' || r.source_no, r.branch_id
        from refunds r where r.status = 'paid' and r.method = 'transfer'
      union all
      select 'expense', e.id::text, e.expense_no, e.amount::float, (e.paid_at at time zone 'Asia/Jakarta')::date::text, e.description, e.branch_id
        from branch_expenses e where e.status = 'paid' and e.method = 'transfer'
      union all
      select 'charity', c.id::text, c.disb_no, c.amount::float, c.date, 'Penyaluran ' || c.recipient, c.branch_id
        from charity_disbursements c where c.method = 'transfer'`;
  const { rows } = await db.execute<{ t: string; id: string; no: string; amount: number; d: string; label: string }>(sql`
    select x.t, x.id, x.no, x.amount, x.d, x.label from (${q}) x join branches br on br.id = x.branch_id
    where br.country_code = ${b.country} and x.d between ${from} and ${to} and ${amtCond}
      and not exists (select 1 from bank_lines bl where bl.match_refs @> jsonb_build_array(jsonb_build_object('type', x.t, 'id', x.id)) and bl.id <> ${line.id})
    order by abs(x.d::date - ${line.txDate}::date), x.no limit 30`);
  return rows.map((r) => ({ type: r.t, id: r.id, no: r.no, amount: r2(Number(r.amount)), date: r.d, label: r.label.trim() }));
}

/** Cocokkan otomatis: satu kandidat dengan nominal persis dan satu-satunya dalam rentang tanggal. */
export async function autoMatch(accountId: string) {
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1);
  const open = await db.select().from(bankLines).where(and(eq(bankLines.accountId, accountId), eq(bankLines.status, 'unmatched'))).orderBy(asc(bankLines.txDate));
  let n = 0;
  for (const l of open) {
    const c = await candidatesFor(l, acc, 3);
    if (c.length !== 1) continue;
    await db.update(bankLines).set({ status: 'matched', matchType: c[0].type, matchRefs: [{ type: c[0].type, id: c[0].id, no: c[0].no, amount: c[0].amount }], note: 'Dicocokkan otomatis', matchedAt: new Date() })
      .where(and(eq(bankLines.id, l.id), eq(bankLines.status, 'unmatched')));
    n++;
  }
  return n;
}

async function loadLine(id: string) {
  const [r] = await db.select({ l: bankLines, acc: bankAccounts }).from(bankLines).innerJoin(bankAccounts, eq(bankAccounts.id, bankLines.accountId)).where(eq(bankLines.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'Mutasi tidak ditemukan');
  return r;
}

export async function matchLine(actor: AuthUser, id: string, refs: { type: string; id: string }[], note?: string | null) {
  const { l, acc } = await loadLine(id);
  if (l.status !== 'unmatched') throw new HttpError(409, 'Mutasi sudah diproses');
  const cands = await candidatesFor(l, acc, 31, true);
  const chosen = refs.map((r) => cands.find((c) => c.type === r.type && c.id === r.id));
  if (chosen.some((c) => !c)) throw new HttpError(400, 'Dokumen tidak ditemukan atau sudah dicocokkan ke mutasi lain');
  const total = r2(chosen.reduce((s, c) => s + c!.amount, 0)), amt = l.credit > 0 ? l.credit : l.debit;
  if (Math.abs(total - amt) > 0.009) throw new HttpError(400, `Jumlah dokumen ${total.toLocaleString('id-ID')} ≠ nominal mutasi ${amt.toLocaleString('id-ID')}`);
  const [after] = await db.update(bankLines).set({ status: 'matched', matchType: chosen.length === 1 ? chosen[0]!.type : 'manual', matchRefs: chosen.map((c) => ({ type: c!.type, id: c!.id, no: c!.no, amount: c!.amount })),
    note: note ?? null, matchedBy: actor.id, matchedAt: new Date() }).where(eq(bankLines.id, id)).returning();
  return after;
}

/** Bukukan mutasi yang belum ada dokumennya: pencairan gateway, biaya bank, pendapatan lain. */
export async function postLine(actor: AuthUser, id: string, p: { type: 'gateway_settlement' | 'bank_fee' | 'other_income'; gross?: number | null; note?: string | null }) {
  const { l } = await loadLine(id);
  if (l.status !== 'unmatched') throw new HttpError(409, 'Mutasi sudah diproses');
  const amt = l.credit > 0 ? l.credit : l.debit;
  if (p.type === 'bank_fee' && !(l.debit > 0)) throw new HttpError(400, 'Biaya bank harus mutasi keluar (debit)');
  if (p.type !== 'bank_fee' && !(l.credit > 0)) throw new HttpError(400, 'Pencairan gateway / pendapatan lain harus mutasi masuk (kredit)');
  let refs: { type: string; id: string; no: string; amount: number }[] = [];
  if (p.type === 'gateway_settlement') {
    const gross = r2(p.gross ?? amt);
    if (gross < amt || gross > amt * 1.1 + 1) throw new HttpError(400, 'Nilai bruto pencairan harus ≥ nominal diterima dan potongan maksimal 10%');
    refs = [{ type: 'gateway_gross', id: l.id, no: 'GROSS', amount: gross }];
  }
  const [after] = await db.update(bankLines).set({ status: 'posted', matchType: p.type, matchRefs: refs, note: p.note ?? null, matchedBy: actor.id, matchedAt: new Date() }).where(eq(bankLines.id, id)).returning();
  return after;
}

export async function ignoreLine(actor: AuthUser, id: string, note: string) {
  const { l } = await loadLine(id);
  if (l.status !== 'unmatched') throw new HttpError(409, 'Mutasi sudah diproses');
  const [after] = await db.update(bankLines).set({ status: 'ignored', note, matchedBy: actor.id, matchedAt: new Date() }).where(eq(bankLines.id, id)).returning();
  return after;
}

export async function unmatchLine(actor: AuthUser, id: string) {
  const { l } = await loadLine(id);
  if (l.status === 'posted') {
    const { rows: [j] } = await db.execute<{ id: string }>(sql`select id from journal_entries where source_type = 'bank' and source_id = ${id}`);
    if (j) throw new HttpError(409, 'Mutasi sudah dijurnal — koreksi dengan jurnal manual');
  }
  if (l.status === 'unmatched') return l;
  const [after] = await db.update(bankLines).set({ status: 'unmatched', matchType: null, matchRefs: null, note: `Dibatalkan oleh ${actor.fullName}`, matchedBy: null, matchedAt: null }).where(eq(bankLines.id, id)).returning();
  return after;
}

/** Ringkasan rekonsiliasi: saldo rekening koran vs saldo buku Bank (1102) kantor pemilik rekening. */
export async function reconSummary(accountId: string, to: string) {
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1);
  if (!acc) throw new HttpError(404, 'Rekening tidak ditemukan');
  const { rows: [st] } = await db.execute<{ bal: string | null; d: string | null }>(sql`
    select l.balance bal, l.tx_date d from bank_lines l join bank_imports i on i.id = l.import_id where l.account_id = ${accountId} and l.tx_date <= ${to} and l.balance is not null order by l.tx_date desc, i.created_at desc, l.seq desc limit 1`);
  const { rows: [gl] } = await db.execute<{ v: string | null }>(sql`
    select sum(l.debit - l.credit) v from journal_lines l join journal_entries e on e.id = l.entry_id where l.account_code = '1102' and l.branch_id = ${acc.branchId} and e.date <= ${to}`);
  const { rows: counts } = await db.execute<{ status: string; n: number; dr: string; cr: string }>(sql`
    select status, count(*)::int n, sum(debit) dr, sum(credit) cr from bank_lines where account_id = ${accountId} and tx_date <= ${to} group by status`);
  const { rows: [{ others }] } = await db.execute<{ others: number }>(sql`select count(*)::int others from bank_accounts where branch_id = ${acc.branchId} and is_active and id <> ${accountId}`);
  const unmatched = counts.find((c) => c.status === 'unmatched');
  return {
    account: acc, asOf: to, statementBalance: st?.bal != null ? Number(st.bal) : null, statementDate: st?.d ?? null, bookBalance: r2(Number(gl?.v ?? 0)),
    difference: st?.bal != null ? r2(Number(st.bal) - Number(gl?.v ?? 0)) : null,
    status: Object.fromEntries(counts.map((c) => [c.status, { count: c.n, debit: Number(c.dr ?? 0), credit: Number(c.cr ?? 0) }])),
    unmatchedIn: Number(unmatched?.cr ?? 0), unmatchedOut: Number(unmatched?.dr ?? 0), sharedBookAccount: others > 0,
  };
}
