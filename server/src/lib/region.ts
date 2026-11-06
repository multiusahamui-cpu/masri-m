import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, countries } from '../db/schema.js';

/**
 * Konteks negara (go global Asia): kode telepon, format nomor HP, kode pos, label pajak, bahasa default.
 * Semua nomor HP dibandingkan dalam format E.164 tanpa "+", mis. 6281234567890 (ID), 60123456789 (MY), 6737123456 (BN).
 */
export type CountryCode = 'ID' | 'MY' | 'BN';
export const SUPPORTED: CountryCode[] = ['ID', 'MY', 'BN'];
export const DIAL: Record<string, string> = { ID: '62', MY: '60', BN: '673' };
export const CURRENCY: Record<string, string> = { ID: 'IDR', MY: 'MYR', BN: 'BND' };
export const TAX_LABEL: Record<string, string> = { ID: 'PPN', MY: 'SST', BN: 'Pajak' };
export const DEFAULT_LANG: Record<string, 'id' | 'ms' | 'en'> = { ID: 'id', MY: 'ms', BN: 'ms' };
export const TIMEZONE: Record<string, string> = { ID: 'Asia/Jakarta', MY: 'Asia/Kuala_Lumpur', BN: 'Asia/Brunei' };

const PHONE_RE: Record<string, RegExp> = {
  ID: /^628\d{7,11}$/,     // 08xx-xxxx-xxxx
  MY: /^601\d{7,9}$/,      // 01x-xxx xxxx
  BN: /^673[2-8]\d{6}$/,   // 7 digit
};
const POSTAL_RE: Record<string, RegExp> = { ID: /^\d{5}$/, MY: /^\d{5}$/, BN: /^[A-Z]{2}\d{4}$/ };
export const POSTAL_HINT: Record<string, string> = { ID: '5 digit, mis. 40111', MY: '5 digit, mis. 50450', BN: '2 huruf + 4 angka, mis. BS8811' };

/** Nomor HP → E.164 tanpa "+" sesuai negara (nomor lokal berawalan 0 memakai kode negara tersebut). */
export function e164(raw: string | null | undefined, country = 'ID') {
  const s = (raw ?? '').trim();
  let d = s.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (s.startsWith('+') || s.startsWith('00')) return d.replace(/^00/, '');
  const dial = DIAL[country] ?? '62';
  if (d.startsWith('0')) return dial + d.slice(1);
  for (const c of Object.values(DIAL)) if (d.startsWith(c) && PHONE_RE[Object.keys(DIAL).find((k) => DIAL[k] === c)!]?.test(d)) return d;
  if (country === 'ID' && d.startsWith('8')) return `62${d}`;
  if (country === 'MY' && d.startsWith('1')) return `60${d}`;
  if (country === 'BN' && d.length === 7) return `673${d}`;
  return d;
}
export const validPhoneFor = (e: string, country = 'ID') => (PHONE_RE[country] ?? PHONE_RE.ID).test(e);
/** Negara dari nomor E.164 (null bila tidak dikenali). */
export const countryOfPhone = (e: string) => (Object.keys(PHONE_RE).find((c) => PHONE_RE[c].test(e)) ?? null) as CountryCode | null;
export const samePhone = (a: string | null | undefined, b: string | null | undefined, country = 'ID') => !!a && !!b && e164(a, country) === e164(b, country);
export const validPostal = (p: string | null | undefined, country = 'ID') => !p || (POSTAL_RE[country] ?? POSTAL_RE.ID).test(p.trim().toUpperCase());

/** SQL: kolom nomor HP dinormalkan ke E.164 (nomor lokal dianggap dari negara `country`). */
export function phoneSql(col: unknown, country = 'ID') {
  const dial = DIAL[country] ?? '62';
  const d = sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;
  return sql`(case when ${d} like '0%' then ${dial} || substr(${d}, 2)
    when ${country} = 'ID' and ${d} like '8%' then '62' || ${d}
    else ${d} end)`;
}
export const phoneMatch = (col: unknown, phoneE164: string, country = 'ID') => sql`${phoneSql(col, country)} = ${phoneE164}`;

// ---------------------------------------------------------------------------
// Negara cabang (cache singkat)
// ---------------------------------------------------------------------------
const cache = new Map<string, { code: string; at: number }>();
export async function branchCountry(branchId: string | null | undefined): Promise<string> {
  if (!branchId) return 'ID';
  const c = cache.get(branchId);
  if (c && Date.now() - c.at < 60_000) return c.code;
  const [b] = await db.select({ code: branches.countryCode }).from(branches).where(eq(branches.id, branchId)).limit(1);
  const code = b?.code ?? 'ID';
  cache.set(branchId, { code, at: Date.now() });
  return code;
}

export async function countryInfo(code: string) {
  const [c] = await db.select().from(countries).where(eq(countries.code, code)).limit(1);
  return c ?? null;
}

/** Tanggal lokal negara (YYYY-MM-DD). */
export const localDate = (country = 'ID', d: Date = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: TIMEZONE[country] ?? 'Asia/Jakarta' });

/** Bandingkan nomor HP (nomor lokal ditafsirkan sesuai negara cabang pemilik data). */
export const phoneEq = async (a: string | null | undefined, b: string | null | undefined, branchId: string | null | undefined) => samePhone(a, b, await branchCountry(branchId));
