import { afterAll, beforeAll, expect, test } from 'vitest';
import { parseAmount, parseDate, parseStatement } from '../src/lib/bankrec.js';
import { unsubscribeToken } from '../src/lib/promo.js';
import { call, login, pool, pub, q1, startApp, startFakes } from './helpers.js';
import { activeCredit, ensureShift } from './helpers.js';

/** Kelompok 2: hutang pemasok, rekonsiliasi bank, karantina & klaim, iqalah, pengiriman terpisah, promo & kampanye. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let r: any;
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let wh: any, acc: any, bm: any, mcJ: any, baJ: any, ksrJ: any, mkt: any, ho: any, jkt: any;
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const ctx: Record<string, any> = {};

beforeAll(async () => {
  fakes = startFakes();
  app = await startApp();
  [wh, acc, bm, mcJ, baJ, ksrJ, mkt] = await Promise.all(['wh', 'acc', 'bm', 'mc.jkt', 'admin.jkt', 'ksr.jkt', 'mkt'].map((u) => login(`${u}@masri-m.local`)));
  ho = await q1(`select id from branches where type='head_office'`);
  jkt = await q1(`select id from branches where code='JKT01'`);
});
afterAll(async () => { app.server.close(); fakes.server.close(); });

// ---------------------------------------------------------------------------
test('PARSER rekening koran: BCA, Mandiri, BSI, CSV umum', () => {
  check(parseDate('05/10/2026') === '2026-10-05' && parseDate('5 Okt 2026') === '2026-10-05' && parseDate('2026-10-05') === '2026-10-05' && parseDate('10/05/2026', 'mdy') === '2026-10-05', 'format tanggal');
  check(parseDate('31/02/2026') === null, 'tanggal tidak valid ditolak');
  const a = parseAmount('1,500,000.00 DB'), b = parseAmount('1.250.000,50'), c = parseAmount('(2.000)');
  check(a?.value === 1500000 && a.dc === 'D' && b?.value === 1250000.5 && c?.value === -2000, `angka: ${JSON.stringify([a, b, c])}`);
  const bca = parseStatement([
    'Informasi Rekening - Mutasi Rekening', 'No. rekening : 1234567890', '',
    'Tanggal Transaksi,Keterangan,Cabang,Jumlah,Saldo',
    "'05/10,TRSF E-BANKING DB 0510/FTSCY/WS95051 PT ELEKTRONIK,0000,\"2,000,000.00 DB\",\"98,000,000.00\"",
    "'05/10,BIAYA ADM,0000,\"15,000.00 DB\",\"97,985,000.00\"",
    "PEND,SETORAN TUNAI,0000,\"100,000.00 CR\",\"\"",
    'Saldo Awal,,,"100,000,000.00",',
  ].join('\n').replace(/'(\d)/g, '$1'), 'bca');
  check(bca.lines.length === 2 && bca.lines[0].debit === 2000000 && bca.lines[1].debit === 15000 && bca.lines[0].balance === 98000000, `BCA: ${JSON.stringify(bca.lines.map((l) => [l.txDate, l.debit, l.credit]))}`);
  check(bca.skipped.some((s) => /PEND/.test(s.reason)), 'transaksi PEND dilewati');
  const mandiri = parseStatement('Account No,Date,Val. Date,Transaction Code,Description,Reference No.,Debit,Credit,Balance\n1230001,05/10/2026,05/10/2026,9999,SKN MASUK PELUNASAN,REF1,0.00,"7,500,000.00","107,500,000.00"\n', 'mandiri');
  check(mandiri.lines.length === 1 && mandiri.lines[0].credit === 7500000 && mandiri.lines[0].reference === 'REF1', `Mandiri: ${JSON.stringify(mandiri.lines)}`);
  const bsi = parseStatement('Tanggal;Keterangan;Debet;Kredit;Saldo\n05-10-2026;BAGI HASIL;0,00;12.345,67;1.012.345,67\n', 'bsi');
  check(bsi.lines.length === 1 && bsi.lines[0].credit === 12345.67, `BSI: ${JSON.stringify(bsi.lines)}`);
  const gen = parseStatement('Posting Date;Narrative;Amount;D/C\n2026-10-05;Fee;"1.000,00";D\n', 'generic', { date: 'Posting Date', description: 'Narrative', amount: 'Amount', dc: 'D/C', dateFormat: 'dmy', decimal: ',' });
  check(gen.lines[0]?.debit === 1000, `umum dgn pemetaan: ${JSON.stringify(gen.lines)}`);
});

// ---------------------------------------------------------------------------
test('HUTANG PEMASOK: GR bernilai → faktur → bayar sebagian & lunas → umur hutang', async () => {
  r = await wh.post('/suppliers', { code: 'SUP-TST', name: 'PT Pemasok Uji', countryCode: 'ID', address: 'Jakarta', bankName: 'BCA', accountNo: '7770001', accountName: 'PT Pemasok Uji', paymentTermsDays: 30 });
  check(r.s === 201, `gudang menambah pemasok ${r.error ?? ''}`);
  ctx.sup = r.supplier;
  r = await wh.post('/suppliers', { code: 'SUP-TST', name: 'Duplikat', countryCode: 'ID' });
  check(r.s === 409, `kode pemasok duplikat ditolak (${r.s})`);
  const p = await q1(`select id from products where sku='TV-LG-43UR'`);
  ctx.tv = p.id;
  r = await wh.post('/inventory/receipts', { supplierId: ctx.sup.id, supplierRef: 'SJ-001', items: [{ productId: p.id, qty: 4, unitCost: 3_000_000 }] });
  check(r.s === 201 && r.receipt.supplierName === 'PT Pemasok Uji', `GR dengan pemasok master ${r.receipt?.grNo ?? r.error}`);
  ctx.gr = r.receipt;
  r = await acc.get('/payables/uninvoiced?country=ID');
  const u = r.receipts.find((x: any) => x.id === ctx.gr.id);
  check(u && u.value === 12_000_000, `GR muncul di "belum difakturkan" senilai ${u?.value}`);
  r = await acc.post('/payables/invoices', { supplierId: ctx.sup.id, receiptId: ctx.gr.id, supplierInvoiceNo: 'INV-77', invoiceDate: today(), subtotal: 15_000_000, tax: 0 });
  check(r.s === 400 || r.s === 409, `faktur selisih 25% dari GR ditolak: ${r.error}`);
  r = await acc.post('/payables/invoices', { supplierId: ctx.sup.id, receiptId: ctx.gr.id, supplierInvoiceNo: 'INV-77', invoiceDate: today(), subtotal: 12_000_000, tax: 1_320_000 });
  check(r.s === 201 && r.invoice.total === 13_320_000, `faktur dicatat ${r.invoice?.invoiceNo} total ${r.invoice?.total} ${r.error ?? ''}`);
  ctx.inv = r.invoice;
  r = await acc.post('/payables/invoices', { supplierId: ctx.sup.id, receiptId: ctx.gr.id, supplierInvoiceNo: 'INV-78', invoiceDate: today(), subtotal: 12_000_000 });
  check(r.s === 409, 'GR yang sama tidak bisa difakturkan dua kali');
  r = await acc.post(`/payables/invoices/${ctx.inv.id}/pay`, { amount: 20_000_000, method: 'transfer', bankRef: 'X' });
  check(r.s === 400, 'bayar melebihi sisa hutang ditolak');
  r = await acc.post(`/payables/invoices/${ctx.inv.id}/pay`, { amount: 5_000_000, method: 'transfer', bankRef: 'TRF-AP-1' });
  check(r.s === 201, `bayar sebagian ${r.payment?.paymentNo}`);
  ctx.apPay = r.payment;
  r = await acc.get('/payables/aging?country=ID');
  const s = r.suppliers.find((x: any) => x.supplierId === ctx.sup.id);
  check(s && s.total === 8_320_000 && s.current === 8_320_000, `umur hutang pemasok uji: ${JSON.stringify(s)}`);
  r = await acc.get(`/payables/invoices?status=unpaid&supplierId=${ctx.sup.id}`);
  check(r.invoices[0]?.status === 'partial' && r.invoices[0].remaining === 8_320_000, 'status faktur dibayar sebagian');
  r = await wh.get('/payables/aging');
  check(r.s === 403, 'gudang tidak bisa melihat hutang');
  r = await bm.post(`/payables/invoices/${ctx.inv.id}/pay`, { amount: 1, method: 'cash' });
  check(r.s === 403, 'BM hanya membaca');
});

// ---------------------------------------------------------------------------
test('REKONSILIASI BANK: impor BCA, duplikat dilewati, cocok otomatis, jurnal biaya bank', async () => {
  r = await acc.post('/bank/accounts', { branchId: ho.id, bankName: 'BCA', accountNo: '1234567890', accountName: 'PT Masri-M Syariah', preset: 'bca' });
  check(r.s === 201 && r.account.currency === 'IDR', `rekening BCA Pusat ${r.error ?? ''}`);
  ctx.bank = r.account;
  const d = today(), [y, m, dd] = d.split('-');
  const csv = ['Tanggal Transaksi,Keterangan,Cabang,Jumlah,Saldo',
    `${dd}/${m}/${y},TRSF E-BANKING DB PT PEMASOK UJI TRF-AP-1,0000,"5,000,000.00 DB","95,000,000.00"`,
    `${dd}/${m}/${y},BIAYA ADM,0000,"17,500.00 DB","94,982,500.00"`,
    `${dd}/${m}/${y},BUNGA/BAGI HASIL,0000,"40,000.00 CR","95,022,500.00"`].join('\n');
  r = await acc.post(`/bank/accounts/${ctx.bank.id}/preview`, { content: csv });
  check(r.ok && r.total === 3 && r.columnMap.amount === 'Jumlah', `pratinjau: ${r.total} baris, kolom ${JSON.stringify(r.columnMap)}`);
  r = await acc.post(`/bank/accounts/${ctx.bank.id}/import`, { filename: 'mutasi.csv', content: csv });
  check(r.s === 201 && r.newRows === 3 && r.autoMatched >= 1, `impor: ${r.newRows} baru, ${r.autoMatched} cocok otomatis ${r.error ?? ''}`);
  r = await acc.post(`/bank/accounts/${ctx.bank.id}/import`, { filename: 'mutasi.csv', content: csv });
  check(r.s === 201 && r.newRows === 0 && r.duplicates === 3, 'impor ulang file yang sama tidak menggandakan');
  r = await acc.get(`/bank/lines?accountId=${ctx.bank.id}`);
  const ap = r.lines.find((l: any) => l.debit === 5_000_000), fee = r.lines.find((l: any) => l.debit === 17_500), inc = r.lines.find((l: any) => l.credit === 40_000);
  check(ap.status === 'matched' && ap.matchType === 'supplier_payment' && ap.matchRefs[0].no === ctx.apPay.paymentNo, `pembayaran pemasok cocok otomatis (${ap.status} ${ap.matchType})`);
  r = await acc.post(`/bank/lines/${fee.id}/post`, { type: 'other_income' });
  check(r.s === 400, 'mutasi keluar tidak bisa dijurnal sebagai pendapatan');
  r = await acc.post(`/bank/lines/${fee.id}/post`, { type: 'bank_fee' });
  check(r.line?.status === 'posted', 'biaya administrasi bank dijurnal');
  r = await acc.post(`/bank/lines/${inc.id}/post`, { type: 'other_income', note: 'bagi hasil giro' });
  check(r.line?.status === 'posted', 'bagi hasil dijurnal sebagai pendapatan lain');
  const j = await q1(`select count(*)::int n, sum(l.debit)::float dr, sum(l.credit)::float cr from journal_entries e join journal_lines l on l.entry_id=e.id where e.source_type='bank' and e.source_id = any($1)`, [[fee.id, inc.id]]);
  check(j.n >= 4 && Math.abs(j.dr - j.cr) < 0.01, `jurnal mutasi bank seimbang (${j.dr} = ${j.cr})`);
  r = await acc.post(`/bank/lines/${fee.id}/unmatch`);
  check(r.s === 409, 'mutasi yang sudah dijurnal tidak bisa dibatalkan begitu saja');
  r = await acc.post(`/bank/lines/${ap.id}/unmatch`);
  check(r.line?.status === 'unmatched', 'batalkan pencocokan');
  r = await acc.get(`/bank/lines/${ap.id}/candidates`);
  check(r.candidates.some((c: any) => c.no === ctx.apPay.paymentNo), 'kandidat tersedia lagi setelah dibatalkan');
  r = await acc.post(`/bank/lines/${ap.id}/match`, { refs: [{ type: 'supplier_payment', id: r.candidates[0].id }] });
  check(r.line?.status === 'matched', 'cocokkan manual');
  r = await acc.get(`/bank/accounts/${ctx.bank.id}/summary`);
  check(r.statementBalance === 95_022_500 && typeof r.bookBalance === 'number' && r.status.posted?.count === 2, `ringkasan: saldo RK ${r.statementBalance}, buku ${r.bookBalance}, selisih ${r.difference}`);
  r = await bm.get('/bank/accounts');
  check(r.s === 403, 'rekonsiliasi bank khusus Bookkeeping');
});

// ---------------------------------------------------------------------------
test('KARANTINA: stok rusak → klaim pemasok → penggantian sebagian', async () => {
  const before = await q1(`select on_hand from stock_levels where product_id=$1 and branch_id=$2`, [ctx.tv, ho.id]);
  r = await wh.post('/quarantine', { productId: ctx.tv, qty: 1, note: 'Panel retak dari pengiriman pemasok', source: 'receipt' });
  check(r.s === 201 && r.item.status === 'quarantined', `pindah ke karantina ${r.item?.qNo ?? r.error}`);
  ctx.q = r.item;
  const after = await q1(`select on_hand from stock_levels where product_id=$1 and branch_id=$2`, [ctx.tv, ho.id]);
  check(after.on_hand === before.on_hand - 1, 'stok jual berkurang 1');
  r = await baJ.post(`/quarantine/${ctx.q.id}/decide`, { action: 'write_off', note: 'x' });
  check(r.s === 403, 'admin cabang tidak memutuskan barang Pusat');
  r = await wh.post(`/quarantine/${ctx.q.id}/decide`, { action: 'claim', note: 'Cacat produksi, klaim ke pemasok' });
  check(r.s === 400, 'klaim tanpa pemasok ditolak');
  r = await wh.post(`/quarantine/${ctx.q.id}/decide`, { action: 'claim', note: 'Cacat produksi, klaim ke pemasok', supplierId: ctx.sup.id });
  check(r.item?.status === 'claimed' && r.item.claimNo && r.item.claimAmount > 0, `klaim ${r.item?.claimNo} senilai ${r.item?.claimAmount}`);
  ctx.claim = r.item;
  r = await wh.post(`/quarantine/${ctx.q.id}/settle`, { method: 'transfer', amount: 1 });
  check(r.s === 403, 'penyelesaian klaim hanya Bookkeeping');
  r = await acc.post(`/quarantine/${ctx.q.id}/settle`, { method: 'transfer', amount: ctx.claim.claimAmount + 1 });
  check(r.s === 400, 'penggantian melebihi klaim ditolak');
  r = await acc.post(`/quarantine/${ctx.q.id}/settle`, { method: 'credit_note', amount: 2_000_000, invoiceId: ctx.inv.id, ref: 'CN-01' });
  check(r.item?.status === 'claim_settled' && r.item.settledAmount === 2_000_000, `klaim diselesaikan lewat nota kredit (${r.error ?? 'ok'})`);
  r = await acc.get(`/payables/invoices?supplierId=${ctx.sup.id}`);
  check(r.invoices[0].remaining === 6_320_000, `nota kredit memotong sisa hutang → ${r.invoices[0].remaining}`);
  // Barang rusak lain: perbaiki & kembali ke stok
  r = await wh.post('/quarantine', { productId: ctx.tv, qty: 1, note: 'Remote hilang, unit baik' });
  r = await wh.post(`/quarantine/${r.item.id}/decide`, { action: 'restock', note: 'Remote diganti, layak jual' });
  check(r.item?.status === 'restocked', 'barang kembali ke stok');
  const fin = await q1(`select on_hand from stock_levels where product_id=$1 and branch_id=$2`, [ctx.tv, ho.id]);
  check(fin.on_hand === before.on_hand - 1, 'stok akhir: hanya unit yang diklaim yang keluar');
});

// ---------------------------------------------------------------------------
test('IQALAH: pengajuan cabang → BM tetapkan potongan → barang kembali, dana dikembalikan', async () => {
  const a = await activeCredit('jkt', 'TV-SAM-55CU', { phone: '+6281277776001', nik: '3175019999990001', name: 'Nasabah Iqalah Uji' });
  check(a.status === 'active', `pembiayaan uji aktif ${a.app_no}`);
  r = await mcJ.get(`/credit/applications/${a.id}/iqalah-preview`);
  check(r.paidByCustomer > 0, `dana dibayar nasabah ${r.paidByCustomer}`);
  const paid = r.paidByCustomer;
  r = await mcJ.post(`/credit/applications/${a.id}/iqalah`, { reason: 'singkat' });
  check(r.s === 400, 'alasan terlalu pendek ditolak');
  r = await mcJ.post(`/credit/applications/${a.id}/iqalah`, { reason: 'Nasabah pindah tugas ke luar pulau, barang masih baik', proposedDepreciation: 100_000 });
  check(r.s === 201 && r.request.status === 'requested', `iqalah ${r.request?.iqalahNo ?? r.error}`);
  ctx.iq = r.request;
  r = await mcJ.post(`/credit/applications/${a.id}/iqalah`, { reason: 'Pengajuan kedua untuk akad yang sama' });
  check(r.s === 409, 'tidak boleh ada dua iqalah berjalan');
  r = await mcJ.post(`/iqalah/${ctx.iq.id}/decide`, { decision: 'approve', note: 'ok' });
  check(r.s === 403, 'MC tidak memutuskan iqalah');
  r = await bm.post(`/iqalah/${ctx.iq.id}/decide`, { decision: 'approve', depreciation: paid + 1, note: 'ok' });
  check(r.s === 400, 'potongan melebihi dana dibayar ditolak');
  const dep = Math.min(250_000, paid);
  r = await bm.post(`/iqalah/${ctx.iq.id}/decide`, { decision: 'approve', depreciation: dep, note: 'Disepakati potongan pemakaian 2 bulan' });
  check(r.request?.status === 'approved' && Math.abs(r.request.refundAmount - (paid - dep)) < 0.01, `disetujui, dikembalikan ${r.request?.refundAmount}`);
  const stock0 = await q1(`select coalesce(on_hand,0) v from stock_levels where product_id=$1 and branch_id=$2`, [a.product_id, a.branch_id]);
  r = await baJ.post(`/iqalah/${ctx.iq.id}/receive`, { condition: 'good', refundMethod: 'transfer' });
  check(r.s === 400, 'transfer tanpa rekening ditolak');
  r = await baJ.post(`/iqalah/${ctx.iq.id}/receive`, { condition: 'good', refundMethod: 'transfer', bankName: 'BRI', accountNo: '0001-01-000001-50-1', accountName: 'Nasabah Uji' });
  check(r.request?.status === 'completed', `barang diterima ${r.error ?? ''}`);
  const app2 = await q1(`select status from credit_applications where id=$1`, [a.id]);
  check(app2.status === 'cancelled', 'akad dibatalkan');
  const ref = await q1(`select amount::float, status, source_type from refunds where source_type='iqalah' and source_id=$1`, [a.id]).catch(() => null)
    ?? await q1(`select amount::float, status, source_type from refunds where source_type='iqalah' order by created_at desc limit 1`);
  check(ref && Math.abs(ref.amount - (paid - dep)) < 0.01, `refund iqalah ${ref?.amount} (${ref?.status})`);
  const stock1 = await q1(`select on_hand v from stock_levels where product_id=$1 and branch_id=$2`, [a.product_id, a.branch_id]);
  check(stock1.v === Number(stock0?.v ?? 0) + 1, 'barang kembali ke stok cabang');
  const unpaid = await q1(`select count(*)::int n from payments where ref_id=$1 and status='pending'`, [a.id]);
  check(unpaid.n === 0, 'tagihan tertunda dibatalkan');
});

// ---------------------------------------------------------------------------
test('PENGIRIMAN TERPISAH: stok cabang + Pusat digabung, ambil sendiri tidak tersedia', async () => {
  const { rows } = await pool.query(`
    select p.id, coalesce(sum(s.on_hand - s.reserved) filter (where s.branch_id=$1),0)::int a, coalesce(sum(s.on_hand - s.reserved) filter (where s.branch_id=$2),0)::int h,
      coalesce(sum(s.on_hand - s.reserved),0)::int t
    from products p join product_prices pp on pp.product_id=p.id and pp.country_code='ID' left join stock_levels s on s.product_id=p.id and s.branch_id in (select id from branches where country_code='ID')
    where p.status='active' group by p.id`, [jkt.id, ho.id]);
  const p = rows.find((x) => x.a > 0 && Math.max(x.a, x.h) + 1 <= Math.min(20, x.t));
  check(p, 'ada produk dengan stok di JKT dan Pusat');
  const qty = Math.max(p.a, p.h) + 1;
  const items = [{ productId: p.id, qty }];
  r = await pub('POST', '/public/cart/quote', { branchId: jkt.id, city: 'Jakarta Timur', items });
  check(r.split === true && r.locations.length >= 2 && !r.options.some((o: any) => o.mode === 'pickup'), `kutipan terpisah dari ${r.locations?.join(' + ')}`);
  r = await pub('POST', '/public/orders', { customer: { fullName: 'Uji Kirim Terpisah', phone: '081277778001' }, branchId: jkt.id, items,
    delivery: { mode: 'pickup', address: '', city: 'Jakarta Timur' }, paymentMethod: 'cashier' });
  check(r.s >= 400 && r.s < 500, `ambil sendiri ditolak untuk pesanan terpisah (${r.error})`);
  r = await pub('POST', '/public/orders', { customer: { fullName: 'Uji Kirim Terpisah', phone: '081277778001' }, branchId: jkt.id, items,
    delivery: { mode: 'internal', address: 'Jl. Raya Bekasi 99', city: 'Jakarta Timur' }, paymentMethod: 'cashier' });
  check(r.s === 201, `order terpisah ${r.orderNo ?? r.error}`);
  const o = await q1(`select id, allocation from orders where order_no=$1`, [r.orderNo]);
  check(o.allocation.length >= 2 && o.allocation.reduce((s: number, x: any) => s + x.qty, 0) === qty, `alokasi ${JSON.stringify(o.allocation)}`);
  await ensureShift('ksr.jkt@masri-m.local');
  r = await ksrJ.post(`/orders/${o.id}/pay`, { method: 'cash' });
  check(r.payment?.status === 'paid', `kasir menerima pembayaran ${r.error ?? ''}`);
  const sh = await q1(`select count(*)::int n, count(distinct from_branch_id)::int locs, sum(shipping_fee)::float fee from shipments where source_type='order' and source_id=$1`, [o.id]);
  check(sh.n >= 2 && sh.locs >= 2, `${sh.n} pengiriman dari ${sh.locs} lokasi`);
  r = await pub('GET', `/public/orders/track?orderNo=${(await q1(`select order_no from orders where id=$1`, [o.id])).order_no}&phone=081277778001`);
  check(r.shipment?.parts?.length >= 2 || r.shipments?.length >= 2 || r.parts?.length >= 2, `lacak pesanan menampilkan beberapa paket`);
  ctx.splitOrder = o.id;
});

// ---------------------------------------------------------------------------
test('PROMO: kode promo di checkout & pengajuan cicilan, batas per nasabah, batal → kuota kembali', async () => {
  const p = await q1(`select p.id, pp.cash_price::float price from products p join product_prices pp on pp.product_id=p.id and pp.country_code='ID' where p.sku='LP-ASUS-V14'`);
  const items = [{ productId: p.id, qty: 1 }];
  r = await pub('POST', '/public/promo/check', { code: 'HEMAT10', country: 'ID', channel: 'credit', items });
  check(r.s >= 400, `HEMAT10 khusus tunai: ${r.error}`);
  r = await pub('POST', '/public/promo/check', { code: 'hemat10', country: 'ID', channel: 'cash', items });
  const want = Math.min(500_000, Math.round(p.price * 0.1));
  check(r.discount === want, `potongan ${r.discount} (harapan ${want})`);
  r = await pub('POST', '/public/cart/quote', { branchId: jkt.id, city: 'Jakarta Timur', items, promoCode: 'HEMAT10', phone: '081277779001' });
  check(r.promo?.discount === want && !r.promo.error, `kutipan keranjang memuat potongan ${r.promo?.discount}`);
  const order = { customer: { fullName: 'Pembeli Promo', phone: '081277779001', email: 'promo@example.com' }, branchId: jkt.id, items,
    delivery: { mode: 'pickup', address: '', city: 'Jakarta Timur' }, paymentMethod: 'cashier', promoCode: 'HEMAT10', marketingOptIn: true };
  r = await pub('POST', '/public/orders', order);
  check(r.s === 201 && Math.abs(r.total - (p.price - want)) < 1, `order dengan promo total ${r.total} ${r.error ?? ''}`);
  ctx.promoOrder = r.orderNo;
  const o = await q1(`select id, discount::float, promo_code from orders where order_no=$1`, [r.orderNo]);
  check(o.discount === want && o.promo_code === 'HEMAT10', 'potongan tercatat di order');
  r = await pub('POST', '/public/orders', order);
  check(r.s >= 400, `kode yang sama kedua kali ditolak: ${r.error}`);
  const c = await q1(`select marketing_opt_in from customers where phone='+6281277779001'`);
  check(c.marketing_opt_in === true, 'persetujuan promo tercatat');
  const cons = await q1(`select count(*)::int n from consents where document='marketing' and phone like '%81277779001'`);
  check(cons.n >= 1, 'bukti persetujuan disimpan');
  r = await ksrJ.post(`/orders/${o.id}/cancel`, { reason: 'Nasabah batal' });
  const red = await q1(`select status from promo_redemptions where source_id=$1`, [o.id]);
  check(red?.status === 'void', `order dibatalkan → pemakaian promo dibatalkan (${red?.status}, ${r.error ?? 'ok'})`);
  r = await pub('POST', '/public/orders', order);
  check(r.s === 201, 'setelah batal, nasabah bisa memakai kode lagi');
  // Pembiayaan: potongan mengurangi harga barang sebelum akad
  r = await pub('POST', '/public/credit-applications', {
    customer: { fullName: 'Pemohon Promo', phone: '081277779002', nik: '3175012345670002', birthDate: '1990-01-01', city: 'Jakarta Timur', address: 'Jl. Pemuda 1', occupation: 'Karyawan', monthlyIncome: 15_000_000, maritalStatus: 'married', dependents: 1 },
    branchId: jkt.id, productId: p.id, qty: 1, tenor: 12, dpPct: 20, consent: true, promoCode: 'CICIL250', marketingOptIn: true });
  check(r.s === 201, `pengajuan dengan CICIL250 ${r.appNo ?? r.error}`);
  const a = await q1(`select cash_price::float, list_price::float, promo_code from credit_applications where app_no=$1`, [r.appNo]);
  check(a.list_price === p.price && a.cash_price === p.price - 250_000 && a.promo_code === 'CICIL250', `harga barang ${a.list_price} → ${a.cash_price}`);
});

// ---------------------------------------------------------------------------
test('KAMPANYE: hanya ke nasabah yang setuju, batas frekuensi, berhenti berlangganan', async () => {
  const promo = await q1(`select id from promo_codes where code='HEMAT10'`);
  r = await mkt.post('/marketing/audience', { countryCode: 'ID', segment: { type: 'all' }, channel: 'both' });
  check(r.optedIn >= 2 && r.reachable >= 2, `audiens yang setuju: ${JSON.stringify(r)}`);
  const total = await q1(`select count(*)::int n from customers c join branches b on b.id=c.branch_id where b.country_code='ID'`);
  check(r.optedIn < total.n, 'nasabah yang tidak setuju tidak termasuk');
  r = await mkt.post('/marketing/campaigns', { name: 'Uji Kampanye Oktober', countryCode: 'ID', channel: 'both', segment: { type: 'all' }, subject: 'Promo Oktober',
    body: { id: 'Halo {nama}, pakai kode {kode} untuk hemat belanja tunai bulan ini.' }, promoId: promo.id });
  check(r.s === 201 && r.campaign.status === 'draft', `kampanye draf ${r.error ?? ''}`);
  const id = r.campaign.id;
  r = await acc.post(`/marketing/campaigns/${id}/send`);
  check(r.s === 403, 'hanya Marketing yang mengirim');
  r = await mkt.post(`/marketing/campaigns/${id}/send`);
  check(r.campaign?.status === 'sent' && r.campaign.recipients >= 2, `terkirim ke ${r.campaign?.recipients} nasabah`);
  const ob = await q1(`select count(*)::int n, bool_and(body like '%HEMAT10%' and body like '%unsubscribe?c=%') ok, count(*) filter (where channel='email')::int em from notification_outbox where ref_type='campaign' and ref_id=$1`, [id]);
  check(ob.n >= 3 && ob.ok && ob.em >= 1, `outbox: ${ob.n} pesan (email ${ob.em}), kode & tautan berhenti berlangganan ada`);
  r = await mkt.post(`/marketing/campaigns/${id}/send`);
  check(r.s === 409, 'kampanye tidak bisa dikirim dua kali');
  r = await mkt.post('/marketing/campaigns', { name: 'Uji Kampanye Kedua', countryCode: 'ID', channel: 'whatsapp', segment: { type: 'all' }, subject: 'Promo lagi', body: { id: 'Promo lagi untuk {nama} minggu ini.' } });
  r = await mkt.post(`/marketing/campaigns/${r.campaign.id}/send`);
  check(r.campaign.recipients === 0 && r.campaign.skipped >= 2, `batas frekuensi: ${r.campaign.skipped} dilewati`);
  // Berhenti berlangganan
  const cust = await q1(`select id from customers where phone='+6281277779001'`);
  r = await call('GET', `${app.base}/public/unsubscribe?c=${cust.id}&t=salah`);
  check((await q1(`select marketing_opt_in from customers where id=$1`, [cust.id])).marketing_opt_in === true, 'token salah tidak mengubah');
  const page = await fetch(`${app.base}/public/unsubscribe?c=${cust.id}&t=${unsubscribeToken(cust.id)}`);
  check(page.ok && (await page.text()).includes('<form'), 'GET hanya menampilkan konfirmasi');
  check((await q1(`select marketing_opt_in from customers where id=$1`, [cust.id])).marketing_opt_in === true, 'pratinjau tautan (GET) tidak membatalkan langganan');
  const res = await fetch(`${app.base}/public/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `c=${cust.id}&t=${unsubscribeToken(cust.id)}` });
  check(res.ok && (await res.text()).includes('berhenti'), 'halaman berhenti berlangganan');
  check((await q1(`select marketing_opt_in from customers where id=$1`, [cust.id])).marketing_opt_in === false, 'opt-out tercatat');
  const w = await q1(`select count(*)::int n from consents where document='marketing_withdrawn' and subject_id=$1`, [cust.id]);
  check(w.n === 1, 'pencabutan persetujuan tercatat');
  // Laporan efektivitas
  r = await mkt.get('/marketing/report?country=ID');
  const h = r.promos.find((x: any) => x.code === 'HEMAT10'), cc = r.promos.find((x: any) => x.code === 'CICIL250');
  check(h.uses >= 1 && h.discount > 0 && cc.credits === 1, `laporan: HEMAT10 ${h.uses}× potongan ${h.discount}; CICIL250 ${cc.credits} pengajuan`);
  check(r.campaigns.some((x: any) => x.id === id && x.recipients >= 2), 'laporan kampanye');
  r = await bm.get('/marketing/report?country=ID');
  check(r.s === 200, 'BM bisa membaca laporan promosi');
  r = await bm.post('/marketing/promos', {});
  check(r.s === 403, 'BM tidak bisa membuat promo');
  // Banner & unggulan publik
  r = await pub('GET', '/public/banners?country=ID');
  check(r.banners.length >= 1 && r.banners[0].title.id, 'banner publik');
  r = await pub('GET', '/catalog/products?country=ID&featured=1');
  check(r.products.length >= 1 && r.products.every((p: any) => p.featured), 'produk unggulan berlabel');
});

test('Jurnal karantina: persediaan hanya dikredit satu kali', async () => {
  const { syncJournals } = await import('../src/lib/accounting.js');
  await syncJournals();
  const q = await q1(`select id, q_no, (unit_cost * qty)::float v from quarantine_items where source in ('opname','receipt') order by created_at limit 1`);
  check(q, 'ada barang karantina dari opname/penerimaan');
  const { rows } = await pool.query(`select coalesce(sum(l.credit),0)::float cr from journal_lines l join journal_entries e on e.id=l.entry_id
    where l.account_code='1301' and (e.source_no=$1 or e.source_id like $2)`, [q.q_no, `${q.id}%`]);
  check(Math.abs(rows[0].cr - q.v) < 0.01, `kredit Persediaan ${rows[0].cr} = nilai barang ${q.v} (bukan dua kali)`);
});
