import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, creditApplications, customers, installments, products } from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';

/** Data dokumen Akad Murabahah (dicetak di browser) — untuk nasabah (Akun Saya) dan staf. */
export async function contractDoc(appId: string, opts: { maskNik: boolean; lang?: string | null }) {
  const [row] = await db.select({ a: creditApplications, c: customers, p: products, b: branches }).from(creditApplications)
    .innerJoin(customers, eq(customers.id, creditApplications.customerId)).innerJoin(products, eq(products.id, creditApplications.productId))
    .innerJoin(branches, eq(branches.id, creditApplications.branchId)).where(eq(creditApplications.id, appId)).limit(1);
  if (!row) throw new HttpError(404, 'Pembiayaan tidak ditemukan');
  const { a, c, p, b } = row;
  if (!a.contractNo) throw new HttpError(409, 'Akad belum ditandatangani');
  const [schedule, company, tazir, grace, ibraPct] = await Promise.all([
    db.select({ seq: installments.seq, dueDate: installments.dueDate, amount: installments.amount, status: installments.status }).from(installments)
      .where(eq(installments.applicationId, a.id)).orderBy(asc(installments.seq)),
    getConfig<string>('general.company_name', b.countryCode).catch(() => 'Masri-M Syariah'),
    getConfig<number>('credit.late_tazir_flat', b.countryCode), getConfig<number>('credit.grace_period_days', b.countryCode), getConfig<number>('credit.early_settlement_ibra_pct', b.countryCode),
  ]);
  const lang = (['id', 'ms', 'en'].includes(String(opts.lang)) ? opts.lang : c.lang ?? (b.countryCode === 'ID' ? 'id' : 'ms')) as 'id' | 'ms' | 'en';
  const nik = c.nik ? (opts.maskNik ? `${c.nik.slice(0, 4)}••••••••${c.nik.slice(-4)}` : c.nik) : '-';
  return {
    company: String(company), branch: { name: b.name, address: b.address, city: b.city },
    contractNo: a.contractNo, appNo: a.appNo, signedAt: a.contractSignedAt, currency: a.currency, status: a.status,
    customer: { name: c.fullName, nik, address: c.city && !c.address.includes(c.city) ? [c.address, c.city].filter(Boolean).join(', ') : c.address, phone: c.phone },
    item: { name: p.name, brand: p.brand, qty: a.qty, warrantyMonths: p.warrantyMonths },
    terms: {
      cashPrice: a.cashPrice, downPayment: a.downPayment, financed: a.financed, marginPct: a.marginPct, marginAmount: a.marginAmount,
      salePrice: a.salePrice, tenor: a.tenor, monthly: a.monthly, shippingFee: a.shippingFee ?? 0,
      tazir: Number(tazir), graceDays: Number(grace), ibraPct: Number(ibraPct),
    },
    schedule,
    lang,
    clauses: clauses(lang, b.countryCode, String(company), Number(tazir), Number(grace), Number(ibraPct), a.currency),
  };
}

const FORUM: Record<string, Record<'id' | 'ms' | 'en', string>> = {
  ID: { id: 'Badan Arbitrase Syariah Nasional (BASYARNAS) atau Pengadilan Agama', ms: 'Badan Arbitrase Syariah Nasional (BASYARNAS) atau Pengadilan Agama di Indonesia', en: 'the National Sharia Arbitration Board (BASYARNAS) or the Religious Courts of Indonesia' },
  MY: { id: 'timbang tara atau mahkamah yang berwenang di Malaysia', ms: 'timbang tara atau mahkamah yang mempunyai bidang kuasa di Malaysia', en: 'arbitration or the courts of competent jurisdiction in Malaysia' },
  BN: { id: 'timbang tara atau mahkamah yang berwenang di Negara Brunei Darussalam', ms: 'timbang tara atau mahkamah yang mempunyai bidang kuasa di Negara Brunei Darussalam', en: 'arbitration or the courts of competent jurisdiction in Brunei Darussalam' },
};

/** Ketentuan akad Murabahah dalam bahasa akad; forum sengketa mengikuti negara cabang. */
function clauses(lang: 'id' | 'ms' | 'en', country: string, company: string, tazir: number, grace: number, ibraPct: number, currency: string) {
  const amt = new Intl.NumberFormat(lang === 'id' ? 'id-ID' : lang === 'ms' ? 'ms-MY' : 'en-MY', { style: 'currency', currency, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(tazir);
  const forum = (FORUM[country] ?? FORUM.ID)[lang];
  if (lang === 'ms') return [
    `${company} (Penjual) telah membeli dan memiliki barang tersebut, kemudian menjualnya kepada Pembeli dengan akad Murabahah. Kos perolehan dan keuntungan (margin) dimaklumkan secara terbuka dan dipersetujui kedua-dua pihak.`,
    'Harga jualan Murabahah adalah tetap sejak akad ditandatangani sehingga selesai; tiada faedah dan tidak berubah walaupun berlaku kelewatan.',
    'Pembeli membayar wang pendahuluan (urbun) semasa akad dan menjelaskan baki harga jualan secara ansuran mengikut jadual yang dilampirkan. Ansuran pertama bermula selepas barang diterima Pembeli.',
    `Kelewatan bayaran oleh Pembeli yang berkemampuan dikenakan ta'zir sebanyak ${amt} bagi setiap ansuran yang lewat melebihi ${grace} hari. Ta'zir tidak diiktiraf sebagai pendapatan Penjual dan disalurkan untuk kebajikan. Pembeli yang menghadapi kesukaran akibat musibah boleh memohon keringanan di cawangan.`,
    `Pembeli boleh menyelesaikan lebih awal. Penjual boleh memberi rebat (ibra') atas margin ansuran yang belum matang mengikut dasar semasa (kini ${ibraPct}%), yang bukan merupakan kewajipan yang dijanjikan dari awal.`,
    'Barang menjadi milik Pembeli sejak diserahkan. Pembeli wajib menjaga barang dan tidak memindah milik sebelum kewajipan selesai tanpa persetujuan Penjual.',
    'Waranti barang mengikut syarat pengeluar. Aduan, pemulangan dan pembaikan disampaikan melalui Helpdesk atau cawangan.',
    `Pertikaian diselesaikan secara musyawarah; jika tiada persetujuan, diselesaikan melalui ${forum} mengikut undang-undang yang berkuat kuasa.`,
  ];
  if (lang === 'en') return [
    `${company} (the Seller) has purchased and owns the goods above and sells them to the Buyer under a Murabahah contract. The cost price and the profit margin are disclosed openly and agreed by both parties.`,
    'The Murabahah sale price is fixed from the signing of this contract until full settlement; there is no interest and it does not change even if payments are late.',
    'The Buyer pays a down payment (urbun) at signing and settles the remaining sale price by instalments according to the attached schedule. The first instalment starts after the Buyer receives the goods.',
    `Late payment by a Buyer who is able to pay incurs ta'zir of ${amt} per instalment more than ${grace} days late. Ta'zir is not recognised as income of the Seller and is channelled to charity. A Buyer in hardship due to misfortune may apply to the branch for relief.`,
    `The Buyer may settle early. The Seller may grant a rebate (ibra') on the margin of instalments not yet due according to prevailing policy (currently ${ibraPct}%), which is not an obligation promised at the outset.`,
    'Ownership of the goods passes to the Buyer upon handover. The Buyer shall take care of the goods and not transfer them before full settlement without the Seller\'s consent.',
    'Warranty follows the manufacturer\'s terms. Complaints, returns and repairs are submitted through the Helpdesk or the branch.',
    `Disputes shall be resolved amicably; failing agreement, through ${forum} in accordance with the applicable law.`,
  ];
  return [
    `${company} (Penjual) telah membeli dan memiliki barang tersebut di atas, lalu menjualnya kepada Pembeli dengan akad Murabahah. Harga beli (pokok) dan keuntungan (margin) diberitahukan secara terbuka dan disepakati kedua belah pihak.`,
    'Harga jual Murabahah bersifat tetap sejak akad ditandatangani sampai lunas; tidak ada bunga dan tidak berubah meskipun terjadi keterlambatan.',
    'Pembeli membayar uang muka (urbun) pada saat akad dan melunasi sisa harga jual secara angsuran sesuai jadwal terlampir. Angsuran pertama dimulai setelah barang diterima Pembeli.',
    `Keterlambatan pembayaran oleh Pembeli yang mampu dikenakan ta'zir sebesar ${amt} per angsuran yang terlambat lebih dari ${grace} hari. Ta'zir tidak diakui sebagai pendapatan Penjual dan disalurkan untuk kegiatan sosial. Pembeli yang mengalami kesulitan karena musibah dapat mengajukan keringanan kepada cabang.`,
    `Pembeli dapat melunasi lebih cepat. Penjual dapat memberikan potongan (ibra') atas margin angsuran yang belum jatuh tempo sesuai kebijakan yang berlaku (saat ini ${ibraPct}%), yang bukan merupakan kewajiban yang diperjanjikan di awal.`,
    'Barang menjadi milik Pembeli sejak diserahterimakan. Pembeli wajib merawat barang dan tidak memindahtangankannya sebelum kewajiban lunas tanpa persetujuan Penjual.',
    'Garansi barang mengikuti ketentuan produsen. Keluhan, retur, dan perbaikan disampaikan melalui Helpdesk atau cabang.',
    `Perselisihan diselesaikan secara musyawarah; bila tidak tercapai mufakat, diselesaikan melalui ${forum} sesuai ketentuan yang berlaku.`,
  ];
}
