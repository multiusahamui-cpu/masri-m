/**
 * Data contoh ekspansi Asia (pengembangan): aktivasi Malaysia & Brunei, cabang Kuala Lumpur & Bandar Seri Begawan,
 * harga MYR/BND, stok dari pemasok lokal, staf, dan modal awal per negara. JANGAN dijalankan di production.
 *
 *   pnpm db:seed-asia      (setelah pnpm db:seed-demo)
 *
 * Aman diulang: setiap bagian dilewati bila datanya sudah ada.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { branches, businessConfigs, countries, goodsReceipts, journalEntries, productPrices, products, suppliers, users } from './schema.js';
import { COUNTRY_DEFAULTS } from '../config/business-defaults.js';
import { hashPassword } from '../lib/security.js';
import { loadAuthUser, type AuthUser } from '../middleware/auth.js';
import { receiveGoods } from '../lib/stock.js';
import { createManualJournal, syncJournals } from '../lib/accounting.js';

const DEMO_PASSWORD = 'DemoMasri2026';
if (process.env.NODE_ENV === 'production') {
  console.error('seed-asia berisi data demo dan tidak boleh dijalankan di production.');
  process.exit(1);
}
const [ho] = await db.select().from(branches).where(eq(branches.type, 'head_office')).limit(1);
if (!ho) throw new Error('Jalankan pnpm db:seed & pnpm db:seed-demo terlebih dahulu');

const COUNTRIES = [
  {
    code: 'MY', rate: 3_500, // perkiraan IDR per MYR untuk harga contoh
    branch: { code: 'KUL01', name: 'Cawangan Kuala Lumpur', city: 'Kuala Lumpur', address: 'No. 12, Jalan Tun Razak', postalCode: '50400', phone: '+60321000001' },
    staff: 'kul', bankInfo: 'Bank Islam Malaysia Berhad 1401-2010-123456 a.n. Masri-M Syariah Sdn. Bhd.', company: 'Masri-M Syariah Sdn. Bhd.',
  },
  {
    code: 'BN', rate: 11_800,
    branch: { code: 'BSB01', name: 'Cawangan Bandar Seri Begawan', city: 'Bandar Seri Begawan', address: 'Unit 5, Simpang 88, Jalan Gadong', postalCode: 'BE3519', phone: '+6732420001' },
    staff: 'bsb', bankInfo: 'Bank Islam Brunei Darussalam 00-01-02-123456 a.n. Masri-M Syariah Sdn. Bhd.', company: 'Masri-M Syariah Sdn. Bhd. (Brunei)',
  },
];

const pw = await hashPassword(DEMO_PASSWORD);
async function staff(email: string, fullName: string, roleCode: string, branchId: string, countryCode: string): Promise<AuthUser> {
  const [u] = await db.insert(users).values({ email, fullName, roleCode, branchId, passwordHash: pw, mustChangePassword: false, countryCode })
    .onConflictDoUpdate({ target: users.email, set: { fullName } }).returning();
  return (await loadAuthUser(u.id))!;
}
const localPrice = (idr: number, rate: number) => Math.max(9, Math.round(idr / rate / 10) * 10 - 1);

const [bookkeeper] = await db.select().from(users).where(eq(users.email, 'acc@masri-m.local')).limit(1);
const prods = await db.select({ id: products.id, sku: products.sku, price: productPrices.cashPrice }).from(products)
  .innerJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, 'ID'))).where(eq(products.status, 'active'));

for (const c of COUNTRIES) {
  // 1. Parameter bisnis negara: salin dari Indonesia, nilai khas negara dari COUNTRY_DEFAULTS
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(businessConfigs).where(eq(businessConfigs.countryCode, c.code));
  if (n === 0) {
    const src = await db.select().from(businessConfigs).where(eq(businessConfigs.countryCode, 'ID'));
    const local: Record<string, unknown> = { ...COUNTRY_DEFAULTS[c.code], 'general.bank_transfer_info': c.bankInfo, 'general.company_name': c.company };
    await db.insert(businessConfigs).values(src.map(({ updatedAt: _u, updatedBy: _b, ...r }) => ({ ...r, countryCode: c.code, value: r.key in local ? local[r.key] : r.value })))
      .onConflictDoNothing();
  }
  await db.update(countries).set({ isActive: true }).where(eq(countries.code, c.code));

  // 2. Cabang & staf
  const [b] = await db.insert(branches).values({ ...c.branch, type: 'branch', countryCode: c.code })
    .onConflictDoUpdate({ target: branches.code, set: { name: c.branch.name } }).returning();
  await staff(`mc.${c.staff}@masri-m.local`, `Pengurus ${c.branch.name}`, 'branch-manager', b.id, c.code);
  const admin = await staff(`admin.${c.staff}@masri-m.local`, `Admin ${c.branch.name}`, 'branch-admin', b.id, c.code);
  await staff(`ao.${c.staff}@masri-m.local`, `Pegawai Pembiayaan ${c.branch.city}`, 'ao', b.id, c.code);
  await staff(`ksr.${c.staff}@masri-m.local`, `Juruwang ${c.branch.city}`, 'cashier', b.id, c.code);
  await staff(`drv.${c.staff}@masri-m.local`, `Pemandu ${c.branch.city}`, 'delivery', b.id, c.code);

  // 3. Harga dalam mata uang lokal
  for (const p of prods) {
    await db.insert(productPrices).values({ productId: p.id, countryCode: c.code, cashPrice: localPrice(p.price, c.rate) }).onConflictDoNothing();
  }

  // 4. Stok dari pemasok lokal (penerimaan barang regional)
  const [{ gr }] = await db.select({ gr: sql<number>`count(*)::int` }).from(goodsReceipts).where(eq(goodsReceipts.branchId, b.id));
  if (gr === 0) {
    const supName = c.code === 'MY' ? 'Syarikat Elektrik & Perabot Sdn. Bhd.' : 'Syarikat Perniagaan Gadong Sdn. Bhd.';
    const [supRow] = await db.insert(suppliers).values({ code: `SUP-${c.code}1`, name: supName, countryCode: c.code, paymentTermsDays: 30, bankName: c.code === 'MY' ? 'Bank Islam Malaysia' : 'Bank Islam Brunei Darussalam', accountNo: c.code === 'MY' ? '1401-0101234-5' : '00-01-02-123456', accountName: supName })
      .onConflictDoUpdate({ target: suppliers.code, set: { name: supName } }).returning();
    await receiveGoods(admin, {
      supplierId: supRow.id, supplierRef: `INV-${c.code}-0001`,
      items: prods.slice(0, 10).map((p) => ({ productId: p.id, qty: c.code === 'MY' ? 6 : 3, unitCost: Math.round(localPrice(p.price, c.rate) * 0.78) })),
    });
  }

  // 5. Modal awal per negara (mata uang lokal)
  await syncJournals();
  const [{ m }] = await db.select({ m: sql<number>`count(*)::int` }).from(journalEntries)
    .where(and(eq(journalEntries.sourceType, 'manual'), sql`${journalEntries.memo} like ${`Modal awal ${c.code}%`}`));
  if (m === 0 && bookkeeper) {
    const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    const cap = c.code === 'MY' ? 500_000 : 150_000;
    await createManualJournal(bookkeeper, { date: d, memo: `Modal awal ${c.code} — setoran pemegang saham ke rekening ${c.branch.name}`, lines: [
      { accountCode: '1102', branchId: b.id, debit: cap, credit: 0 }, { accountCode: '3101', branchId: b.id, debit: 0, credit: cap }] });
    const { rows: [ap] } = await db.execute<{ v: string }>(sql`select coalesce(sum(credit - debit), 0)::text v from journal_lines where account_code = '2101' and branch_id = ${b.id}`);
    if (Number(ap.v) > 0) await createManualJournal(bookkeeper, { date: d, memo: `Modal awal ${c.code} — pelunasan pemasok lokal`, lines: [
      { accountCode: '2101', branchId: b.id, debit: Number(ap.v), credit: 0 }, { accountCode: '1102', branchId: b.id, debit: 0, credit: Number(ap.v) }] });
    await createManualJournal(bookkeeper, { date: d, memo: `Modal awal ${c.code} — kas operasional cabang`, lines: [
      { accountCode: '1101', branchId: b.id, debit: c.code === 'MY' ? 2_000 : 1_000, credit: 0 }, { accountCode: '1102', branchId: b.id, debit: 0, credit: c.code === 'MY' ? 2_000 : 1_000 }] });
  }
  console.log(`${c.code}: cabang ${b.code} aktif, ${prods.length} harga lokal, stok dari pemasok lokal.`);
}

console.log(`Akun demo Asia (password: ${DEMO_PASSWORD}):`);
console.log('  mc.kul / admin.kul / ao.kul / ksr.kul / drv.kul @masri-m.local   Cawangan Kuala Lumpur (MYR)');
console.log('  mc.bsb / admin.bsb / ao.bsb / ksr.bsb / drv.bsb @masri-m.local   Cawangan Bandar Seri Begawan (BND)');
await pool.end();
