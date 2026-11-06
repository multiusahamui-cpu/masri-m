/**
 * Data contoh untuk pengembangan lokal: 3 cabang, staf per cabang, nasabah, dan tiket helpdesk
 * dalam berbagai status. JANGAN dijalankan di production.
 *
 *   pnpm db:seed-demo
 *
 * Semua akun demo memakai password DEMO_PASSWORD di bawah dan tidak wajib ganti password.
 */
import { eq, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { branchExpenses, branches, creditApplications, customers, orders, payments, shipments, productCategories, productPrices, products, stockLevels, tickets, users, journalEntries } from './schema.js';
import { banners, featuredProducts, promoCodes, suppliers } from './schema.js';
import { env } from '../env.js';
import { hashPassword } from '../lib/security.js';
import { loadAuthUser, type AuthUser } from '../middleware/auth.js';
import { branchDone, commentTicket, createTicket, escalateTicket, resolveTicket, startTicket, closeTicket } from '../lib/helpdesk.js';
import { approveTransfer, createTransfer, receiveGoods, receiveTransfer, shipTransfer } from '../lib/stock.js';
import { preparePickup, deliver, scheduleInternal } from '../lib/shipping.js';
import { checkout } from '../lib/orders.js';
import { confirmPayment, recordInstallmentPayment } from '../lib/payments.js';
import { createExpense, decideExpense, openShift, openShiftOf, payExpense } from '../lib/finance.js';
import { assignAo, branchReview, hqDecide, recommend, saveKyc, saveSurvey, signContract, payDownPaymentAtCashier, submitApplication } from '../lib/credit.js';
import { createManualJournal, syncJournals, wibDate } from '../lib/accounting.js';

const DEMO_PASSWORD = 'DemoMasri2026';

if (env.NODE_ENV === 'production') {
  console.error('seed-demo tidak boleh dijalankan di production.');
  process.exit(1);
}

// Setiap bagian hanya dijalankan bila datanya belum ada, jadi aman diulang (mis. setelah update versi).
const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets);
const seedHelpdesk = existing.n === 0;

const [ho] = await db.select().from(branches).where(eq(branches.type, 'head_office')).limit(1);
if (!ho) throw new Error('Jalankan pnpm db:seed terlebih dahulu');

const BRANCHES = [
  { code: 'JKT01', name: 'Cabang Jakarta Timur', city: 'Jakarta Timur', address: 'Jl. Raya Bekasi No. 12', postalCode: '13920', phone: '+62214700001' },
  { code: 'BDG01', name: 'Cabang Bandung', city: 'Bandung', address: 'Jl. Soekarno-Hatta No. 88', postalCode: '40286', phone: '+62227300002' },
  { code: 'PYK01', name: 'Cabang Payakumbuh', city: 'Payakumbuh', address: 'Jl. Sudirman No. 45', postalCode: '26211', phone: '+62752900003' },
];

const branchByCode: Record<string, typeof branches.$inferSelect> = {};
for (const b of BRANCHES) {
  const [row] = await db.insert(branches).values({ ...b, type: 'branch', countryCode: 'ID' })
    .onConflictDoUpdate({ target: branches.code, set: { name: b.name, postalCode: sql`coalesce(${branches.postalCode}, ${b.postalCode})` } }).returning();
  branchByCode[b.code] = row;
}
// Gudang Pusat: alamat & kode pos (untuk ongkir kurir mitra)
await db.update(branches).set({ address: sql`coalesce(nullif(${branches.address}, ''), 'Jl. HR Rasuna Said Kav. 1, Kuningan')`, postalCode: sql`coalesce(${branches.postalCode}, '12950')`, phone: sql`coalesce(${branches.phone}, '+62215200000')` })
  .where(eq(branches.type, 'head_office'));

const pw = await hashPassword(DEMO_PASSWORD);
async function staff(email: string, fullName: string, roleCode: string, branchId: string): Promise<AuthUser> {
  const [u] = await db.insert(users).values({ email, fullName, roleCode, branchId, passwordHash: pw, mustChangePassword: false, countryCode: 'ID' })
    .onConflictDoUpdate({ target: users.email, set: { fullName } }).returning();
  return (await loadAuthUser(u.id))!;
}

const helpdesk = await staff('helpdesk@masri-m.local', 'Rina Helpdesk', 'support', ho.id);
const bm = await staff('bm@masri-m.local', 'Hendra Business Manager', 'biz-mgr', ho.id);
const bm2 = await staff('bm2@masri-m.local', 'Laila Business Manager', 'biz-mgr', ho.id);
const warehouse = await staff('wh@masri-m.local', 'Joko Warehouse Pusat', 'warehouse', ho.id);
await staff('drv.ho@masri-m.local', 'Driver Gudang Pusat', 'delivery', ho.id);
await staff('sysadmin@masri-m.local', 'Dimas System Admin', 'admin', ho.id);
const bookkeeper = await staff('acc@masri-m.local', 'Sari Bookkeeping Pusat', 'finance', ho.id);
const marketer = await staff('mkt@masri-m.local', 'Nadia Marketing Pusat', 'marketing', ho.id);
const branchAdmins: Record<string, AuthUser> = {};
const branchManagers: Record<string, AuthUser> = {};
const aos: Record<string, AuthUser> = {};
const drivers: Record<string, AuthUser> = {};
const cashiers: Record<string, AuthUser> = {};
for (const [code, city] of [['JKT01', 'Jaktim'], ['BDG01', 'Bandung'], ['PYK01', 'Payakumbuh']]) {
  const b = branchByCode[code];
  const k = code.slice(0, 3).toLowerCase();
  branchManagers[code] = await staff(`mc.${k}@masri-m.local`, `Manager Cabang ${city}`, 'branch-manager', b.id);
  branchAdmins[code] = await staff(`admin.${k}@masri-m.local`, `Admin Cabang ${city}`, 'branch-admin', b.id);
  aos[code] = await staff(`ao.${k}@masri-m.local`, `AO ${city}`, 'ao', b.id);
  drivers[code] = await staff(`drv.${k}@masri-m.local`, `Driver ${city}`, 'delivery', b.id);
  cashiers[code] = await staff(`ksr.${k}@masri-m.local`, `Kasir ${city}`, 'cashier', b.id);
}

if (seedHelpdesk) {
const CUSTOMERS = [
  ['Ahmad Fauzi', '+6281211110001', 'Jakarta Timur', 'JKT01'], ['Siti Aminah', '+6281211110002', 'Bekasi', 'JKT01'],
  ['Budi Hartono', '+6281211110003', 'Jakarta Timur', 'JKT01'], ['Dewi Lestari', '+6281211110004', 'Bandung', 'BDG01'],
  ['Rizky Pratama', '+6281211110005', 'Cimahi', 'BDG01'], ['Nurul Hidayah', '+6281211110006', 'Bandung', 'BDG01'],
  ['Yusuf Malik', '+6281211110007', 'Payakumbuh', 'PYK01'], ['Fitri Ramadhani', '+6281211110008', 'Bukittinggi', 'PYK01'],
] as const;
const cust: Record<string, typeof customers.$inferSelect> = {};
for (const [fullName, phone, city, code] of CUSTOMERS) {
  const { rows: [{ seq }] } = await db.execute<{ seq: string }>(sql`select nextval('customer_no_seq')::text as seq`);
  const [c] = await db.insert(customers).values({
    fullName, phone, city, branchId: branchByCode[code].id, customerNo: `C${code}-${seq.padStart(6, '0')}`,
    address: `${city}, Indonesia`,
  }).returning();
  cust[fullName] = c;
}

type Spec = {
  customer: string; subject: string; description: string; category: 'order' | 'delivery' | 'product' | 'credit' | 'payment' | 'account' | 'other';
  priority: 'low' | 'normal' | 'high' | 'urgent'; channel: 'web' | 'whatsapp' | 'phone' | 'email' | 'walk_in'; orderRef?: string;
  flow: ('start' | 'escalate' | 'comment' | 'branch_done' | 'resolve' | 'close')[]; ageHours: number; note?: string; resolution?: string;
};

const SPECS: Spec[] = [
  { customer: 'Ahmad Fauzi', subject: 'Kulkas belum dikirim padahal sudah 5 hari', description: 'Nasabah sudah bayar DP, status pesanan masih "Dikemas" sejak 5 hari lalu.', category: 'delivery', priority: 'high', channel: 'whatsapp', orderRef: 'ORD-2610-0012', flow: ['start', 'escalate'], ageHours: 30, note: 'Cek stok buffer Jaktim & jadwalkan antar.' },
  { customer: 'Siti Aminah', subject: 'Sofa diterima dalam kondisi sobek', description: 'Bagian sandaran sofa L sobek sekitar 10 cm saat diterima. Foto sudah dikirim via WA.', category: 'product', priority: 'urgent', channel: 'phone', orderRef: 'ORD-2609-0101', flow: ['start', 'escalate', 'comment'], ageHours: 8, note: 'Mohon kunjungi nasabah & ambil foto untuk klaim retur.' },
  { customer: 'Budi Hartono', subject: 'Salah tagih angsuran bulan ke-3', description: 'Nasabah ditagih dua kali untuk angsuran bulan ke-3.', category: 'payment', priority: 'normal', channel: 'email', flow: ['start', 'resolve'], ageHours: 50, resolution: 'Tagihan ganda dibatalkan, saldo dikembalikan.' },
  { customer: 'Dewi Lestari', subject: 'Teknisi pemasangan AC tidak datang', description: 'Jadwal pemasangan AC tanggal kemarin, teknisi tidak datang dan tidak ada kabar.', category: 'delivery', priority: 'high', channel: 'phone', orderRef: 'ORD-2610-0033', flow: ['start', 'escalate', 'branch_done'], ageHours: 40, note: 'Jadwalkan ulang teknisi Bandung.', resolution: 'Teknisi dijadwalkan ulang, AC terpasang hari ini pukul 14.00.' },
  { customer: 'Rizky Pratama', subject: 'Pengajuan kredit belum ada kabar', description: 'Sudah 7 hari sejak survei AO, belum ada keputusan.', category: 'credit', priority: 'normal', channel: 'web', flow: ['start', 'escalate'], ageHours: 100, note: 'Mohon Admin Cabang cek kelengkapan berkas survei AO sebelum diteruskan ke BM.' },
  { customer: 'Nurul Hidayah', subject: 'Ingin ubah alamat pengiriman', description: 'Nasabah pindah rumah, minta alamat kirim diubah.', category: 'order', priority: 'low', channel: 'whatsapp', flow: ['start', 'escalate', 'branch_done', 'resolve', 'close'], ageHours: 120, note: 'Ubah alamat & jadwal ulang.', resolution: 'Alamat diperbarui, barang terkirim ke alamat baru.' },
  { customer: 'Yusuf Malik', subject: 'Barang pickup belum siap di gudang cabang', description: 'Nasabah datang ke cabang Payakumbuh untuk ambil TV, barang belum tersedia.', category: 'delivery', priority: 'urgent', channel: 'walk_in', orderRef: 'ORD-2610-0047', flow: ['start', 'escalate'], ageHours: 200, note: 'Konfirmasi kiriman dari Gudang Pusat & kabari nasabah.' },
  { customer: 'Fitri Ramadhani', subject: 'Lupa password aplikasi', description: 'Nasabah tidak bisa login ke aplikasi.', category: 'account', priority: 'low', channel: 'phone', flow: [], ageHours: 2 },
];

for (const s of SPECS) {
  const c = cust[s.customer];
  let t = await createTicket(helpdesk, {
    subject: s.subject, description: s.description, category: s.category, priority: s.priority, channel: s.channel,
    customerId: c.id, branchId: c.branchId, orderRef: s.orderRef ?? null,
  });
  const code = Object.keys(branchByCode).find((k) => branchByCode[k].id === c.branchId)!;
  for (const step of s.flow) {
    if (step === 'start') t = await startTicket(helpdesk, t);
    if (step === 'escalate') t = await escalateTicket(helpdesk, t, c.branchId!, s.note ?? 'Mohon ditindaklanjuti');
    if (step === 'comment') await commentTicket(branchAdmins[code], t, 'Sudah kami hubungi nasabah, kunjungan dijadwalkan besok pagi.');
    if (step === 'branch_done') t = await branchDone(branchAdmins[code], t, s.resolution ?? 'Selesai ditangani cabang');
    if (step === 'resolve') t = await resolveTicket(helpdesk, t, s.resolution);
    if (step === 'close') t = await closeTicket(helpdesk, t);
  }
  // Mundurkan waktu agar aging & SLA terlihat realistis
  const shift = sql`(${s.ageHours} || ' hours')::interval`;
  await db.execute(sql`update helpdesk_tickets set created_at = created_at - ${shift}, due_at = due_at - ${shift},
    escalated_at = escalated_at - ${shift},
    resolved_at = case when resolved_at is not null then created_at - ${shift} + interval '20 hours' end
    where id = ${t.id}`);
  await db.execute(sql`update helpdesk_ticket_events set created_at = created_at - ${shift} where ticket_id = ${t.id}`);
}

console.log(`Helpdesk: ${CUSTOMERS.length} nasabah, ${SPECS.length} tiket.`);
} else console.log('Data helpdesk sudah ada, dilewati.');


// ---------------------------------------------------------------------------
// Katalog & stok contoh
// ---------------------------------------------------------------------------
const [pc] = await db.select({ n: sql<number>`count(*)::int` }).from(products);
if (pc.n === 0) {
  const CATS = [
    ['TV', 'Televisi', 'electronics'], ['KULKAS', 'Kulkas', 'electronics'], ['MESINCUCI', 'Mesin Cuci', 'electronics'],
    ['AC', 'AC', 'electronics'], ['GADGET', 'Smartphone & Laptop', 'electronics'],
    ['SOFA', 'Sofa', 'furniture'], ['LEMARI', 'Lemari', 'furniture'], ['KASUR', 'Kasur & Ranjang', 'furniture'], ['MEJA', 'Meja Makan', 'furniture'],
  ] as const;
  const cat: Record<string, string> = {};
  for (const [i, [code, name, group]] of CATS.entries()) {
    const [c] = await db.insert(productCategories).values({ code, name, group, sortOrder: i }).onConflictDoUpdate({ target: productCategories.code, set: { name } }).returning();
    cat[code] = c.id;
  }
  const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&q=80&w=800`;
  const PRODUCTS: [string, string, string, string, number, string[], string, Partial<typeof products.$inferInsert>][] = [
    ['TV-SAM-55CU', 'Samsung Smart TV 55" 4K UHD', 'Samsung', 'TV', 8_500_000, ['4K Crystal Processor', 'HDR10+', 'Tizen Smart TV'], img('photo-1593359677879-a4bb92f829d1'), { weightKg: 17, lengthCm: 135, widthCm: 15, heightCm: 85, warrantyMonths: 24, requiresInstallation: true }],
    ['TV-LG-43UR', 'LG Smart TV 43" 4K', 'LG', 'TV', 4_999_000, ['4K Active HDR', 'webOS', 'ThinQ AI'], img('photo-1461151304267-38535e780c79'), { weightKg: 9, lengthCm: 105, widthCm: 12, heightCm: 68, warrantyMonths: 24 }],
    ['KLK-LG-2P300', 'Kulkas LG 2 Pintu Inverter 300L', 'LG', 'KULKAS', 5_500_000, ['Smart Inverter', 'Door Cooling+', '300 Liter'], img('photo-1571175443880-49e1d58b95da'), { weightKg: 60, lengthCm: 60, widthCm: 68, heightCm: 172, warrantyMonths: 120, isBulky: true }],
    ['KLK-SHP-1P', 'Sharp Kulkas 1 Pintu 166L', 'Sharp', 'KULKAS', 2_150_000, ['Hybrid Cooling', '166 Liter'], img('photo-1584568694244-14fbdf83bd30'), { weightKg: 32, lengthCm: 50, widthCm: 55, heightCm: 120, warrantyMonths: 60, isBulky: true }],
    ['MC-SAM-FL8', 'Samsung Mesin Cuci Front Load 8kg', 'Samsung', 'MESINCUCI', 6_299_000, ['Eco Bubble', 'Digital Inverter', '8 kg'], img('photo-1626806787461-102c1bfaaea1'), { weightKg: 65, lengthCm: 60, widthCm: 55, heightCm: 85, warrantyMonths: 24, isBulky: true, requiresInstallation: true }],
    ['AC-DKN-1PK', 'Daikin AC Split 1 PK Inverter', 'Daikin', 'AC', 5_750_000, ['Inverter', 'R32', 'Hemat energi'], img('photo-1631545806609-35d4ae440431'), { weightKg: 35, warrantyMonths: 36, requiresInstallation: true }],
    ['HP-IP15-128', 'iPhone 15 128GB', 'Apple', 'GADGET', 16_500_000, ['A16 Bionic', 'Dynamic Island', '48MP'], img('photo-1696446701796-da61225697cc'), { weightKg: 0.5, warrantyMonths: 12 }],
    ['LP-ASUS-V14', 'ASUS Vivobook 14 Core i5', 'ASUS', 'GADGET', 9_299_000, ['Intel Core i5', '16GB RAM', 'SSD 512GB'], img('photo-1496181133206-80ce9b88a853'), { weightKg: 2, warrantyMonths: 24 }],
    ['SF-LSHAPE-PRM', 'Sofa L-Shape Minimalis Premium', 'Masri Living', 'SOFA', 6_000_000, ['Canvas premium', 'Rangka jati solid', 'Busa HD'], img('photo-1555041469-a586c61ea9bc'), { weightKg: 80, lengthCm: 260, widthCm: 160, heightCm: 85, warrantyMonths: 24, isBulky: true, requiresInstallation: true }],
    ['LM-3PNT-JATI', 'Lemari Pakaian 3 Pintu Jati', 'Masri Living', 'LEMARI', 4_750_000, ['Kayu jati', 'Cermin', 'Knock-down'], img('photo-1595428774223-ef52624120d2'), { weightKg: 95, lengthCm: 150, widthCm: 55, heightCm: 200, warrantyMonths: 12, isBulky: true, requiresInstallation: true }],
    ['KSR-SPR-160', 'Springbed 160x200 + Divan', 'Comforta', 'KASUR', 3_900_000, ['Pocket spring', 'Divan + headboard'], img('photo-1505693416388-ac5ce068fe85'), { weightKg: 70, lengthCm: 200, widthCm: 160, heightCm: 60, warrantyMonths: 120, isBulky: true }],
    ['MJ-MKN-6KRS', 'Set Meja Makan 6 Kursi', 'Masri Living', 'MEJA', 5_200_000, ['Kayu mahoni', '6 kursi'], img('photo-1617806118233-18e1de247200'), { weightKg: 85, warrantyMonths: 12, isBulky: true, requiresInstallation: true }],
  ];
  const pid: Record<string, string> = {};
  for (const [sku, name, brand, code, price, specs, image, extra] of PRODUCTS) {
    const [p] = await db.insert(products).values({ sku, name, brand, categoryId: cat[code], specs, images: [image], status: 'active', ...extra }).returning();
    await db.insert(productPrices).values({ productId: p.id, countryCode: 'ID', cashPrice: price });
    pid[sku] = p.id;
  }
  // Barang masuk dari supplier ke Gudang Pusat (harga beli ± 78% harga tunai)
  const priceOf = Object.fromEntries(PRODUCTS.map((x) => [x[0], x[4] as number]));
  const withCost = (items: { productId: string; qty: number }[]) => items.map((i) => {
    const sku = Object.keys(pid).find((k) => pid[k] === i.productId)!;
    return { ...i, unitCost: Math.round(priceOf[sku] * 0.78 / 1000) * 1000 };
  });
  // Master pemasok (hutang dagang per faktur)
  const sup = async (code: string, name: string, terms: number, bankName: string, accountNo: string) =>
    (await db.insert(suppliers).values({ code, name, countryCode: 'ID', paymentTermsDays: terms, bankName, accountNo, accountName: name, phone: '+62215550000', address: 'Jakarta' })
      .onConflictDoUpdate({ target: suppliers.code, set: { name } }).returning())[0];
  const supElek = await sup('SUP-ELN', 'PT Elektronik Nusantara', 30, 'Bank Syariah Indonesia', '7001234567');
  const supMebel = await sup('SUP-MJJ', 'CV Mebel Jepara Jaya', 14, 'Bank Muamalat', '1020304050');
  await receiveGoods(warehouse, { supplierId: supElek.id, supplierRef: 'SJ-0925-118', items: withCost([
    { productId: pid['TV-SAM-55CU'], qty: 20 }, { productId: pid['TV-LG-43UR'], qty: 25 }, { productId: pid['KLK-LG-2P300'], qty: 12 },
    { productId: pid['KLK-SHP-1P'], qty: 15 }, { productId: pid['MC-SAM-FL8'], qty: 10 }, { productId: pid['AC-DKN-1PK'], qty: 18 },
    { productId: pid['HP-IP15-128'], qty: 8 }, { productId: pid['LP-ASUS-V14'], qty: 10 },
  ]) });
  await receiveGoods(warehouse, { supplierId: supMebel.id, supplierRef: 'INV-MJJ-0412', items: withCost([
    { productId: pid['SF-LSHAPE-PRM'], qty: 8 }, { productId: pid['LM-3PNT-JATI'], qty: 6 }, { productId: pid['KSR-SPR-160'], qty: 10 }, { productId: pid['MJ-MKN-6KRS'], qty: 4 },
  ]) });
  // Transfer contoh dalam berbagai status
  const jkt = branchByCode.JKT01.id, bdg = branchByCode.BDG01.id, pyk = branchByCode.PYK01.id;
  const t1 = await createTransfer(branchAdmins.JKT01, { note: 'Stok pajangan & buffer awal', items: [{ productId: pid['TV-SAM-55CU'], qty: 4 }, { productId: pid['KLK-LG-2P300'], qty: 2 }, { productId: pid['SF-LSHAPE-PRM'], qty: 2 }] });
  await approveTransfer(branchManagers.JKT01, t1.id, true);
  await shipTransfer(warehouse, t1.id, { shipmentRef: 'TRUK B 9123 KX', items: [{ productId: pid['TV-SAM-55CU'], qty: 4 }, { productId: pid['KLK-LG-2P300'], qty: 2 }, { productId: pid['SF-LSHAPE-PRM'], qty: 2 }] });
  await receiveTransfer(branchAdmins.JKT01, t1.id, { items: [{ productId: pid['TV-SAM-55CU'], qty: 4 }, { productId: pid['KLK-LG-2P300'], qty: 2 }, { productId: pid['SF-LSHAPE-PRM'], qty: 2 }] });
  const t2 = await createTransfer(warehouse, { toBranchId: bdg, note: 'Buffer awal Bandung', items: [{ productId: pid['TV-LG-43UR'], qty: 5 }, { productId: pid['MC-SAM-FL8'], qty: 2 }, { productId: pid['AC-DKN-1PK'], qty: 3 }] });
  await shipTransfer(warehouse, t2.id, { shipmentRef: 'TRUK D 8812 AB', items: [{ productId: pid['TV-LG-43UR'], qty: 5 }, { productId: pid['MC-SAM-FL8'], qty: 2 }, { productId: pid['AC-DKN-1PK'], qty: 3 }] });
  await createTransfer(branchAdmins.PYK01, { note: 'Nasabah menunggu pickup TV (tiket helpdesk)', items: [{ productId: pid['TV-SAM-55CU'], qty: 2 }, { productId: pid['KSR-SPR-160'], qty: 2 }] });
  const t4 = await createTransfer(branchAdmins.BDG01, { note: 'Tambahan lemari', items: [{ productId: pid['LM-3PNT-JATI'], qty: 2 }] });
  await approveTransfer(branchManagers.BDG01, t4.id, true);
  void jkt; void pyk;
  console.log(`Katalog: ${PRODUCTS.length} produk, 2 penerimaan barang, 4 transfer contoh.`);
} else console.log('Data katalog sudah ada, dilewati.');
void stockLevels;

// ---------------------------------------------------------------------------
// Pengajuan kredit Murabahah contoh (berbagai tahap)
// ---------------------------------------------------------------------------
const [cc] = await db.select({ n: sql<number>`count(*)::int` }).from(creditApplications);
if (cc.n === 0) {
  const prod = async (sku: string) => (await db.select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1))[0]?.id;
  const people = [
    { code: 'JKT01', fullName: 'Ahmad Fauzi', phone: '+6281211110001', nik: '3175010101850001', city: 'Jakarta Timur', occupation: 'Karyawan swasta', employer: 'PT Sinar Logistik', income: 9_500_000, sku: 'KLK-LG-2P300', tenor: 12, dp: 10, stage: 'submitted' },
    { code: 'JKT01', fullName: 'Siti Aminah', phone: '+6281211110002', nik: '3275014202900002', city: 'Bekasi', occupation: 'Guru', employer: 'SDIT Al-Hikmah', income: 6_000_000, sku: 'MC-SAM-FL8', tenor: 18, dp: 15, stage: 'assigned' },
    { code: 'JKT01', fullName: 'Budi Hartono', phone: '+6281211110003', nik: '3175011003880003', city: 'Jakarta Timur', occupation: 'Wiraswasta', employer: 'Toko Hartono', income: 15_000_000, sku: 'TV-SAM-55CU', tenor: 12, dp: 20, stage: 'contracted' },
    { code: 'JKT01', fullName: 'Rahmat Hidayat', phone: '+6281211110010', nik: '3175011507870010', city: 'Jakarta Timur', occupation: 'PNS', employer: 'Kelurahan Cakung', income: 8_000_000, sku: 'SF-LSHAPE-PRM', tenor: 24, dp: 10, stage: 'active' },
    { code: 'BDG01', fullName: 'Dewi Lestari', phone: '+6281211110004', nik: '3273016506920004', city: 'Bandung', occupation: 'Perawat', employer: 'RS Al Islam', income: 7_500_000, sku: 'AC-DKN-1PK', tenor: 12, dp: 10, stage: 'branch_review' },
    { code: 'BDG01', fullName: 'Rizky Pratama', phone: '+6281211110005', nik: '3277011209950005', city: 'Cimahi', occupation: 'Programmer', employer: 'PT Kode Nusantara', income: 18_000_000, sku: 'LP-ASUS-V14', tenor: 6, dp: 10, stage: 'hq_review' },
    { code: 'BDG01', fullName: 'Nurul Hidayah', phone: '+6281211110006', nik: '3273015811930006', city: 'Bandung', occupation: 'Pedagang', employer: '', income: 4_000_000, sku: 'HP-IP15-128', tenor: 24, dp: 10, stage: 'rejected' },
    { code: 'PYK01', fullName: 'Yusuf Malik', phone: '+6281211110007', nik: '1376010304860007', city: 'Payakumbuh', occupation: 'Dosen', employer: 'Politeknik Payakumbuh', income: 11_000_000, sku: 'KSR-SPR-160', tenor: 12, dp: 10, stage: 'approved' },
    { code: 'PYK01', fullName: 'Hj. Rosmaniar', phone: '+6281211110011', nik: '1376014401750011', city: 'Payakumbuh', occupation: 'Pengusaha rendang', employer: 'Rendang Uni Ros', income: 45_000_000, sku: 'HP-IP15-128', tenor: 12, dp: 10, stage: 'committee', qty: 2 },
  ] as const;
  const order = ['submitted', 'assigned', 'branch_review', 'hq_review', 'committee', 'approved', 'contracted', 'active', 'rejected'];
  for (const pp of people) {
    const b = branchByCode[pp.code];
    const productId = await prod(pp.sku);
    if (!productId) continue;
    const { application: a0 } = await submitApplication(null, {
      customer: { fullName: pp.fullName, phone: pp.phone, email: null, nik: pp.nik, birthDate: '1988-05-12', city: pp.city, address: `Jl. Contoh No. ${pp.nik.slice(-2)}, ${pp.city}`,
        occupation: pp.occupation, employer: pp.employer || null, monthlyIncome: pp.income, maritalStatus: 'married', dependents: 2 },
      branchId: b.id, productId, qty: 'qty' in pp ? pp.qty : 1, tenor: pp.tenor, dpPct: pp.dp, purpose: 'Kebutuhan rumah tangga',
    });
    const id = a0.id;
    const stageIdx = order.indexOf(pp.stage);
    if (stageIdx < 1) continue;
    const ao = aos[pp.code], mc = branchManagers[pp.code];
    await assignAo(mc, id, ao.id);
    const allOk = Object.fromEntries(['ktp', 'selfie', 'kk', 'income_proof', 'address_proof'].map((k) => [k, { ok: true }]));
    if (pp.stage === 'assigned') { await saveKyc(ao, id, { ...allOk, income_proof: { ok: false, note: 'Slip gaji belum diserahkan' } }); continue; }
    await saveKyc(ao, id, allOk);
    await saveSurvey(ao, id, { visitedAt: new Date().toISOString(), addressVerified: true, residenceStatus: 'own', lengthOfStayYears: 6, incomeVerified: true,
      verifiedIncome: pp.income, otherObligations: pp.stage === 'rejected' ? 900_000 : 500_000, characterScore: pp.stage === 'rejected' ? 2 : 4, photos: [], notes: 'Rumah permanen, lingkungan baik, tetangga mengenal nasabah.' });
    await recommend(ao, id, pp.stage === 'rejected'
      ? { recommendation: 'reject', tenor: pp.tenor, dpPct: pp.dp, notes: 'Penghasilan tidak tetap dan rasio angsuran terlalu tinggi.' }
      : { recommendation: 'approve', tenor: pp.tenor, dpPct: pp.dp, notes: 'Kapasitas bayar baik, karakter baik, survei sesuai.' });
    if (pp.stage === 'branch_review') continue;
    if (pp.stage === 'rejected') { await branchReview(mc, id, 'reject', 'Sependapat dengan AO, DSR melebihi batas.'); continue; }
    await branchReview(mc, id, 'forward', 'Layak, mohon persetujuan Pusat.');
    if (pp.stage === 'hq_review') continue;
    await hqDecide(bm, id, { decision: 'approve', notes: 'Disetujui sesuai rekomendasi.' });
    if (pp.stage === 'committee' || pp.stage === 'approved') continue;
    await signContract(ao, id, { dpChannel: 'cashier', delivery: { mode: 'pickup', address: '', city: b.city } });
    // Uang muka + ongkir diterima Kasir (transfer dengan referensi)
    await payDownPaymentAtCashier(cashiers[pp.code], id, { method: 'transfer', proofRef: `TRX${pp.nik.slice(-4)}` });
    if (pp.stage === 'contracted') continue;
    const [sh] = await db.select().from(shipments).where(eq(shipments.sourceId, id)).limit(1);
    const ready = await preparePickup(branchAdmins[pp.code], sh.id);
    await deliver(branchAdmins[pp.code], sh.id, { podName: pp.fullName, podNote: 'Diambil sendiri, KTP dicocokkan.', pickupCode: ready.pickupCode });
  }
  void bm2;
  console.log(`Kredit: ${people.length} pengajuan contoh di berbagai tahap.`);
} else console.log('Data kredit sudah ada, dilewati.');

// ---------------------------------------------------------------------------
// Order tunai, pengiriman & pembayaran contoh
// ---------------------------------------------------------------------------
const [oc] = await db.select({ n: sql<number>`count(*)::int` }).from(orders);
if (oc.n === 0) {
  const pid = async (sku: string) => (await db.select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1))[0]?.id;
  const jkt = branchByCode.JKT01;
  const tv = await pid('TV-SAM-55CU'), sofa = await pid('SF-LSHAPE-PRM'), laptop = await pid('LP-ASUS-V14');
  if (tv && sofa && laptop) {
    // 1. Order dibayar via VA -> pengiriman armada internal dijadwalkan
    const o1 = await checkout({ customer: { fullName: 'Andi Saputra', phone: '+6281299990001' }, branchId: jkt.id, items: [{ productId: tv, qty: 1 }],
      delivery: { mode: 'internal', address: 'Jl. Pulogadung Raya No. 21, Jakarta Timur', city: jkt.city }, paymentMethod: 'va' });
    await confirmPayment(o1.payment!.paymentNo, null, 'SIMULASI-SEED');
    const [s1] = await db.select().from(shipments).where(eq(shipments.sourceId, o1.order.id)).limit(1);
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    await scheduleInternal(branchAdmins.JKT01, s1.id, { driverId: drivers.JKT01.id, date: tomorrow, slot: 'pagi', vehicleRef: 'B 9123 KX' });
    // 2. Order menunggu pembayaran VA (bisa disimulasikan lunas dari halaman lacak order)
    await checkout({ customer: { fullName: 'Maya Kartika', phone: '+6281299990002' }, branchId: jkt.id, items: [{ productId: laptop, qty: 1 }],
      delivery: { mode: 'partner', address: 'Jl. Kalimalang Blok C No. 8', city: 'Bekasi', courierCode: 'jne', service: 'Reguler' }, paymentMethod: 'va' });
    // 3. Order bayar di kasir, ambil sendiri
    const o3 = await checkout({ customer: { fullName: 'Bambang Wijaya', phone: '+6281299990003' }, branchId: jkt.id, items: [{ productId: sofa, qty: 1 }],
      delivery: { mode: 'pickup', address: '', city: jkt.city }, paymentMethod: 'cashier' });
    void o3;
  }
  // Pembayaran angsuran pertama untuk pembiayaan aktif
  const actives = await db.select().from(creditApplications).where(eq(creditApplications.status, 'active'));
  for (const a of actives.slice(0, 1)) {
    const code = Object.keys(branchByCode).find((k) => branchByCode[k].id === a.branchId)!;
    if (!(await openShiftOf(cashiers[code].id))) await openShift(cashiers[code], 500_000); // saldo awal kas kecil
    await recordInstallmentPayment(cashiers[code], a.id, { amount: a.monthly!, method: 'cash', note: 'Angsuran ke-1' });
  }
  console.log('Order & pembayaran: 3 order contoh, 1 pembayaran angsuran.');
} else console.log('Data order sudah ada, dilewati.');
void payments;

// ---------------------------------------------------------------------------
// Biaya operasional cabang contoh
// ---------------------------------------------------------------------------
const [{ nExp }] = await db.select({ nExp: sql<number>`count(*)::int` }).from(branchExpenses);
if (nExp === 0) {
  const today = new Date().toISOString().slice(0, 10);
  const ba = branchAdmins.JKT01, mc = branchManagers.JKT01;
  const e1 = await createExpense(ba, { category: 'transport', description: 'BBM armada pengiriman minggu ini', vendor: 'SPBU Cakung', amount: 450_000, expenseDate: today, method: 'cash', receiptRef: 'NOTA-0912' });
  await decideExpense(mc, e1.expense.id, 'approve', null);
  if (!(await openShiftOf(ba.id))) await openShift(ba, 1_000_000);
  await payExpense(ba, e1.expense.id, null);
  await createExpense(ba, { category: 'utilities', description: 'Listrik & internet toko bulan ini', vendor: 'PLN / ISP', amount: 1_850_000, expenseDate: today, method: 'transfer' });
  const e3 = await createExpense(ba, { category: 'maintenance', description: 'Servis besar & ganti ban truk B 9123 KX', vendor: 'Bengkel Maju Motor', amount: 7_200_000, expenseDate: today, method: 'transfer', receiptRef: 'INV-2210' });
  await decideExpense(mc, e3.expense.id, 'approve', 'Wajar, kendaraan operasional utama');
  console.log('Biaya operasional: 3 contoh (dibayar tunai, menunggu MC, menunggu persetujuan Pusat).');
}

// ---------------------------------------------------------------------------
// Akuntansi: posting otomatis + jurnal pembukaan (modal & pelunasan pemasok)
// ---------------------------------------------------------------------------
await syncJournals();
const [{ nManual }] = await db.select({ nManual: sql<number>`count(*)::int` }).from(journalEntries).where(eq(journalEntries.sourceType, 'manual'));
if (nManual === 0) {
  const d = wibDate();
  await createManualJournal(bookkeeper, { date: d, memo: 'Setoran modal awal pemegang saham', lines: [
    { accountCode: '1102', branchId: ho.id, debit: 2_000_000_000, credit: 0 }, { accountCode: '3101', branchId: ho.id, debit: 0, credit: 2_000_000_000 }] });
  const { rows: [ap] } = await db.execute<{ v: string }>(sql`select coalesce(sum(credit - debit), 0)::text v from journal_lines where account_code = '2101'`);
  if (Number(ap.v) > 0) await createManualJournal(bookkeeper, { date: d, memo: 'Pelunasan hutang pemasok (PT Elektronik Nusantara, CV Mebel Jepara Jaya)', lines: [
    { accountCode: '2101', branchId: ho.id, debit: Number(ap.v), credit: 0 }, { accountCode: '1102', branchId: ho.id, debit: 0, credit: Number(ap.v) }] });
  const brs = await db.select({ id: branches.id, code: branches.code }).from(branches).where(eq(branches.type, 'branch'));
  await createManualJournal(bookkeeper, { date: d, memo: 'Dropping kas operasional awal dari Pusat ke cabang', lines: [
    ...brs.map((b) => ({ accountCode: '1101', branchId: b.id, debit: 5_000_000, credit: 0, memo: `Kas awal ${b.code}` })),
    { accountCode: '1102', branchId: ho.id, debit: 0, credit: 5_000_000 * brs.length }] });
  console.log('Akuntansi: jurnal otomatis diposting + 3 jurnal pembukaan (modal, pelunasan pemasok, dropping kas cabang).');
}

// ---------------------------------------------------------------------------
// Marketing: contoh kode promo, banner beranda & produk unggulan
// ---------------------------------------------------------------------------
{
  const start = new Date(Date.now() - 86400_000), end = new Date(Date.now() + 60 * 86400_000);
  await db.insert(promoCodes).values([
    { code: 'HEMAT10', countryCode: 'ID', name: 'Hemat 10% pembelian tunai', description: 'Potongan 10% maks. Rp500.000 untuk pembelian tunai min. Rp2.000.000', type: 'percent', value: 10, maxDiscount: 500_000, minPurchase: 2_000_000, appliesTo: 'cash', quota: 200, perCustomer: 1, startsAt: start, endsAt: end, createdBy: marketer.id },
    { code: 'CICIL250', countryCode: 'ID', name: 'Potongan Rp250.000 pembiayaan', description: 'Potongan harga barang Rp250.000 untuk pengajuan cicilan min. Rp3.000.000', type: 'amount', value: 250_000, minPurchase: 3_000_000, appliesTo: 'credit', quota: 100, perCustomer: 1, startsAt: start, endsAt: end, createdBy: marketer.id },
  ]).onConflictDoNothing();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(banners);
  if (n === 0) await db.insert(banners).values([
    { countryCode: 'ID', title: { id: 'Hemat 10% belanja tunai', ms: 'Jimat 10% belian tunai', en: 'Save 10% on cash purchases' }, subtitle: { id: 'Pakai kode HEMAT10 saat checkout. Berlaku sampai stok promo habis.', ms: 'Guna kod HEMAT10 semasa checkout.', en: 'Use code HEMAT10 at checkout.' }, theme: 'emerald', linkType: 'promo', linkValue: 'HEMAT10', sortOrder: 0, startsAt: start, endsAt: end, createdBy: marketer.id },
    { countryCode: 'ID', title: { id: 'Cicilan syariah tanpa bunga', ms: 'Ansuran patuh syariah tanpa faedah', en: 'Sharia installments, no interest' }, subtitle: { id: 'Akad murabahah, margin tetap sejak awal. Potongan Rp250.000 dengan kode CICIL250.', ms: 'Akad murabahah, margin tetap.', en: 'Murabahah contract, fixed margin.' }, theme: 'gold', linkType: 'promo', linkValue: 'CICIL250', sortOrder: 1, startsAt: start, endsAt: end, createdBy: marketer.id },
  ]);
  const [{ f }] = await db.select({ f: sql<number>`count(*)::int` }).from(featuredProducts).where(eq(featuredProducts.countryCode, 'ID'));
  if (f === 0) {
    const top = await db.select({ id: products.id }).from(products).innerJoin(productPrices, eq(productPrices.productId, products.id)).where(eq(productPrices.countryCode, 'ID')).orderBy(sql`${productPrices.cashPrice} desc`).limit(4);
    if (top.length) await db.insert(featuredProducts).values(top.map((p, i) => ({ countryCode: 'ID', productId: p.id, rank: i, label: i === 0 ? 'bestseller' : 'featured' })));
  }
  console.log('Marketing: 2 kode promo (HEMAT10, CICIL250), 2 banner, produk unggulan.');
}

console.log(`Seed demo selesai: ${BRANCHES.length} cabang.`);
console.log(`Akun demo (password: ${DEMO_PASSWORD}):`);
console.log('  helpdesk@masri-m.local      Helpdesk Pusat');
console.log('  wh@masri-m.local            Warehouse Pusat');
console.log('  sysadmin@masri-m.local      System Admin (produk)');
console.log('  acc@masri-m.local           Bookkeeping Pusat (akuntansi)');
console.log('  mkt@masri-m.local           Marketing Pusat (promo & kampanye)');
console.log('  bm@ / bm2@masri-m.local     Business Manager (2 akun untuk komite)');
console.log('  ao.jkt / ao.bdg / ao.pyk @masri-m.local        Account Officer');
console.log('  ksr.jkt / ksr.bdg / ksr.pyk @masri-m.local     Kasir');
console.log('  drv.jkt / drv.bdg / drv.pyk / drv.ho @masri-m.local  Driver (Delivery)');
console.log('  mc.jkt / mc.bdg / mc.pyk @masri-m.local        Manager Cabang');
console.log('  admin.jkt / admin.bdg / admin.pyk @masri-m.local  Admin Cabang');
await pool.end();
