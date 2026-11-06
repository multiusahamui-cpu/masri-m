import { afterAll, beforeAll, expect, test } from 'vitest';
import { assessTazir } from '../src/lib/payments.js';
import { login, pool, pub, q1, startApp, startFakes } from './helpers.js';
/** Nomor dokumen memakai YYMM bulan berjalan (WIB). */
const YM = (() => { const d = new Date(Date.now() + 7 * 3600_000); return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

/** Alur keuangan cabang & purna jual: shift, biaya, ta'zir, pelunasan, refund, retur, kwitansi. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let r: any;
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let ksrJ: any, ksrB: any, baJ: any, baP: any, mcJ: any, mcP: any, bm: any, aoP: any, aoJ: any, wh: any;
let a5: any, payNo1: string, settleNo: string, ho: any;
const assess = async () => String(await assessTazir());
const db = pool;

beforeAll(async () => {
  fakes = startFakes();
  app = await startApp();
  [ksrJ, ksrB, baJ, baP, mcJ, mcP, bm, aoP, aoJ, wh] = await Promise.all(['ksr.jkt', 'ksr.bdg', 'admin.jkt', 'admin.pyk', 'mc.jkt', 'mc.pyk', 'bm', 'ao.pyk', 'ao.jkt', 'wh'].map((u) => login(`${u}@masri-m.local`)));
  ho = await q1(`select id from branches where type='head_office'`);
});
afterAll(async () => { app.server.close(); fakes.server.close(); });

test('SHIFT', async () => {
r = await ksrJ.get('/shifts/current');
check(r.shift?.status === 'open' && r.summary.cashIn > 0, `kasir JKT punya shift terbuka dari seed, cashIn=${r.summary?.cashIn}`);
a5 = await q1(`select a.id, c.phone from credit_applications a join customers c on c.id=a.customer_id where app_no='APP-${YM}-00005'`);
r = await ksrB.post(`/cashier/credits/${a5.id}/pay`, { amount: 1000, method: 'cash' });
check(r.s === 403 || r.s === 409, `kasir BDG tanpa shift / beda cabang ditolak (${r.s} ${r.error})`);
});

test('EXPENSES', async () => {
r = await baJ.get('/expenses');
check(r.expenses.length === 3, `3 biaya contoh (${r.expenses.map((e) => e.status).join(',')})`);
const hq = r.expenses.find((e) => e.status === 'hq_review'), sub = r.expenses.find((e) => e.status === 'submitted');
r = await mcJ.post(`/expenses/${hq.id}/decide`, { decision: 'approve' });
check(r.s === 409, 'MC tidak bisa menyetujui ulang biaya hq_review');
r = await bm.post(`/expenses/${hq.id}/decide`, { decision: 'approve', note: 'OK Pusat' });
check(r.expense?.status === 'approved', 'BM menyetujui biaya > batas');
r = await mcJ.post(`/expenses/${sub.id}/decide`, { decision: 'reject' });
check(r.s === 400, 'tolak tanpa alasan ditolak');
r = await mcJ.post(`/expenses/${sub.id}/decide`, { decision: 'approve' });
check(r.expense?.status === 'approved', 'MC menyetujui biaya listrik');
r = await baJ.post(`/expenses/${sub.id}/pay`, {});
check(r.s === 400, 'bayar transfer tanpa ref ditolak');
r = await ksrJ.post(`/expenses/${sub.id}/pay`, { paidRef: 'TRF-001' });
check(r.expense?.status === 'paid', 'kasir membayar biaya transfer');
r = await baJ.post('/expenses', { category: 'meals', description: 'Konsumsi rapat cabang', amount: 300000, expenseDate: new Date().toISOString().slice(0, 10), method: 'cash' });
check(r.s === 201 && r.overBudget === false, `admin cabang ajukan biaya baru, terpakai ${r.monthUsed}`);
r = await ksrJ.post('/expenses', { category: 'meals', description: 'xxxxx', amount: 1, expenseDate: '2026-10-06', method: 'cash' });
check(r.s === 403, 'kasir tidak bisa mengajukan biaya');
r = await bm.get('/expenses/report');
check(r.branches?.length >= 1 && r.branches[0].paid > 0, `laporan biaya: ${JSON.stringify(r.branches?.map((b) => [b.branchName, b.paid, b.committed]))}`);
r = await baJ.get(`/vouchers/expense/${hq.id}`);
check(r.doc?.title === 'BUKTI KAS KELUAR', 'bukti kas keluar biaya');
});

test("TA'ZIR", async () => {
await db.query(`update installments set due_date = to_char((now() at time zone 'Asia/Jakarta') - interval '12 days','YYYY-MM-DD') where application_id=$1 and seq=2`, [a5.id]);
let n = await assess();
check(n === '1', `assessTazir membuat ${n} ta'zir`);
n = await assess();
check(n === '0', 'assessTazir idempoten');
r = await ksrJ.get(`/cashier/credits/${a5.id}`);
check(r.tazirDue === 50000 && r.position.dpd === 12, `posisi: tazirDue ${r.tazirDue}, dpd ${r.position.dpd}`);
const inst1 = await q1(`select amount, paid_amount from installments where application_id=$1 and seq=2`, [a5.id]);
r = await ksrJ.post(`/cashier/credits/${a5.id}/pay`, { amount: Number(inst1.amount) - Number(inst1.paid_amount), method: 'cash', payTazir: true });
check(r.s === 201 && Number(r.payment.tazirAmount) === 50000, `bayar angsuran + ta'zir (${r.error ?? r.payment.paymentNo})`);
payNo1 = r.payment?.paymentNo;
check((await q1(`select status from tazir_charges where application_id=$1`, [a5.id])).status === 'paid', "ta'zir berstatus paid");
});

test('SETTLEMENT (kasir)', async () => {
r = await ksrJ.get(`/credits/${a5.id}/settlement`);
const qt = r.quote;
check(qt && qt.ibra > 0 && qt.payable + qt.ibra === qt.outstanding, `kutipan pelunasan: sisa ${qt?.outstanding}, ibra ${qt?.ibra} (${qt?.ibraPct}%), bayar ${qt?.payable}`);
r = await ksrJ.post(`/cashier/credits/${a5.id}/pay`, { settlement: true, method: 'transfer', proofRef: 'TRF-LUNAS' });
check(r.s === 201 && Number(r.payment.ibraAmount) === qt.ibra, `pelunasan dipercepat ${r.error ?? r.payment.paymentNo}`);
settleNo = r.payment?.paymentNo;
const a5s = await q1(`select status, ibra_amount, settled_early_at from credit_applications where id=$1`, [a5.id]);
check(a5s.status === 'paid_off' && Number(a5s.ibra_amount) === qt.ibra && a5s.settled_early_at, 'akad paid_off dengan ibra tercatat');
});

test('RECEIPTS', async () => {
r = await ksrJ.get(`/receipts/${payNo1}`);
check(r.doc?.lines.some((l) => l.label.includes("Ta'zir")) && r.doc.total > 50000, `kwitansi angsuran + ta'zir total ${r.doc?.total}`);
r = await pub('GET', `/public/receipts/${settleNo}?phone=${encodeURIComponent(a5.phone)}`);
check(r.doc?.lines.some((l) => l.label.includes('ibra')), 'kwitansi pelunasan publik (verifikasi HP)');
r = await pub('GET', `/public/receipts/${settleNo}?phone=081200000000`);
check(r.s === 404, 'kwitansi publik dengan HP salah ditolak');
const dp = await q1(`select payment_no from payments where kind='down_payment' and status='paid' limit 1`);
r = dp ? await aoJ.get(`/receipts/${dp.payment_no}`) : { s: 0 };
check(r.doc?.lines[0].label.startsWith('Uang muka'), `kwitansi uang muka ${dp?.payment_no}`);
});

test("APP-10: akad + pickup -> aktif, ta'zir dibebaskan, pelunasan via VA", async () => {
const a10 = await q1(`select a.id, a.down_payment, c.phone, a.fulfill_branch_id from credit_applications a join customers c on c.id=a.customer_id where app_no='APP-${YM}-00010'`);
r = await aoP.get(`/credit/applications/${a10.id}/delivery-quote?city=Payakumbuh`);
r = await aoP.post(`/credit/applications/${a10.id}/contract`, { dpChannel: 'cashier', delivery: { mode: 'pickup', address: '', city: 'Payakumbuh' } });
check((r.s === 200 || r.s === 201) && r.application.status === 'approved' && r.application.contractNo, `akad APP-10 ditandatangani, uang muka belum dibayar ${r.error ?? ''}`);
check(!(await q1(`select id from shipments where source_id=$1`, [a10.id])), 'pengiriman belum dibuat sebelum uang muka lunas');
const dpPend = await q1(`select amount, channel from payments where kind='down_payment' and ref_id=$1 and status='pending'`, [a10.id]);
check(dpPend?.channel === 'cashier' && Number(dpPend.amount) === Number(a10.down_payment), `tagihan uang muka kasir ${dpPend?.amount}`);
r = await aoP.post(`/credit/applications/${a10.id}/contract`, { dpChannel: 'cashier', delivery: { mode: 'pickup', address: '', city: 'Payakumbuh' } });
check(r.s === 409, 'akad tidak bisa ditandatangani dua kali');
// Nasabah memilih bayar online (VA) dari halaman cek status, lalu akhirnya membayar di kasir
r = await pub('POST', '/public/credit-applications/pay-dp', { appNo: `APP-${YM}-00010`, phone: a10.phone, method: 'va', bank: 'bni' });
check(r.s === 201 && r.dpDue.payment.channel === 'gateway' && r.dpDue.payment.vaNumber, `VA uang muka ${r.dpDue?.payment?.vaNumber}`);
const ksrP = await login('ksr.pyk@masri-m.local');
r = await ksrP.get('/cashier/down-payments');
check(r.downPayments?.some((x: any) => x.id === a10.id), 'muncul di daftar Terima Uang Muka kasir');
r = await aoP.post(`/cashier/down-payments/${a10.id}/pay`, { method: 'cash' });
check(r.s === 403, 'AO tidak bisa menerima uang muka');
if (!(await ksrP.get('/shifts/current')).shift) await ksrP.post('/shifts/open', { openingCash: 100000 });
r = await ksrP.post(`/cashier/down-payments/${a10.id}/pay`, { method: 'cash' });
check(r.s === 201 && r.payment.status === 'paid' && r.payment.shiftId, `kasir terima uang muka tunai dalam shift ${r.error ?? r.payment?.paymentNo}`);
const st10 = await q1(`select status, dp_paid_at from credit_applications where id=$1`, [a10.id]);
check(st10.status === 'contracted' && st10.dp_paid_at, 'akad berlaku setelah uang muka lunas');
check((await q1(`select count(*)::int n from payments where kind='down_payment' and ref_id=$1 and status='cancelled'`, [a10.id])).n >= 2, 'tagihan uang muka lama dibatalkan');
const sh10 = await q1(`select id, from_branch_id from shipments where source_id=$1`, [a10.id]);
const op = sh10.from_branch_id === ho.id ? wh : baP;
r = await op.post(`/shipments/${sh10.id}/prepare-pickup`);
const code = (await q1(`select pickup_code from shipments where id=$1`, [sh10.id])).pickup_code;
r = await op.post(`/shipments/${sh10.id}/deliver`, { podName: 'Nasabah', pickupCode: code });
check((await q1(`select status from credit_applications where id=$1`, [a10.id])).status === 'active', `APP-10 aktif setelah pickup (${r.error ?? 'ok'})`);
await db.query(`update installments set due_date = to_char((now() at time zone 'Asia/Jakarta') - interval '10 days','YYYY-MM-DD') where application_id=$1 and seq=1`, [a10.id]);
await assess();
const tz = await q1(`select id from tazir_charges where application_id=$1`, [a10.id]);
r = await mcJ.post(`/tazir/${tz.id}/waive`, { reason: 'Nasabah sakit, tidak mampu' });
check(r.s === 403, 'MC cabang lain tidak bisa membebaskan');
r = await mcP.post(`/tazir/${tz.id}/waive`, { reason: 'Nasabah sakit, tidak mampu' });
check(r.charge?.status === 'waived', "MC PYK membebaskan ta'zir");
r = await pub('GET', `/public/credit-applications/position?appNo=APP-${YM}-00010&phone=${encodeURIComponent(a10.phone)}`);
check(r.settlement?.payable > 0 && r.position.tazirDue === 0, `posisi publik: pelunasan ${r.settlement?.payable}, ibra ${r.settlement?.ibra}`);
r = await pub('POST', '/public/credit-applications/pay', { appNo: `APP-${YM}-00010`, phone: a10.phone, method: 'va', settlement: true });
check(r.s === 201 && r.payment.ibraAmount > 0, `VA pelunasan ${r.payment?.paymentNo} ${r.payment?.amount}`);
r = await pub('POST', `/dev/payments/${r.payment.paymentNo}/pay`);
check((await q1(`select status from credit_applications where id=$1`, [a10.id])).status === 'paid_off', 'APP-10 lunas via VA pelunasan');
});

test('REFUND ORDER', async () => {
const o1 = await q1(`select id, total from orders where order_no='ORD-${YM}-00001'`);
r = await baJ.get(`/aftersales/lookup?no=ORD-${YM}-00001`);
check(r.source?.canRefund, 'lookup ORD-1 bisa refund');
r = await baJ.post('/refunds', { sourceNo: `ORD-${YM}-00001`, amount: Number(o1.total), reason: 'Nasabah membatalkan pesanan', method: 'transfer' });
check(r.s === 400, 'refund transfer tanpa rekening ditolak');
r = await baJ.post('/refunds', { sourceNo: `ORD-${YM}-00001`, amount: Number(o1.total), reason: 'Nasabah membatalkan pesanan', method: 'transfer', bankName: 'BSI', accountNo: '7123456789', accountName: 'Hana Pertiwi' });
check(r.s === 201, `refund diajukan ${r.refund?.refundNo}`);
const rf1 = r.refund;
r = await baJ.post('/refunds', { sourceNo: `ORD-${YM}-00001`, amount: 1000, reason: 'dobel test', method: 'cash' });
check(r.s === 409, 'refund ganda ditolak');
r = await mcJ.post(`/refunds/${rf1.id}/decide`, { decision: 'approve' });
check(r.refund?.status === 'approved', 'MC setuju refund');
const o1s = await q1(`select o.status, (select status from shipments where source_id=o.id) ss, (select sum(reserved) from stock_levels) res from orders o where id=$1`, [o1.id]);
check(o1s.status === 'cancelled' && o1s.ss === 'cancelled', `order & pengiriman dibatalkan (${o1s.status}/${o1s.ss})`);
r = await ksrJ.post(`/refunds/${rf1.id}/pay`, { paidRef: 'TRF-RFD-1' });
check(r.refund?.status === 'paid', 'kasir membayar refund');
r = await ksrJ.get(`/vouchers/refund/${rf1.id}`);
check(r.doc?.title === 'BUKTI PENGEMBALIAN DANA', 'bukti refund');
});

test('REFUND AKAD (APP-3)', async () => {
r = await aoJ.post('/refunds', { sourceNo: `AKD-${YM}-00004`, amount: 100000, reason: 'Nasabah batal sebelum barang dikirim', method: 'cash' });
check(r.s === 201, `refund akad diajukan ${r.error ?? r.refund.refundNo}`);
const rf2 = r.refund;
r = await mcJ.post(`/refunds/${rf2.id}/decide`, { decision: 'approve' });
check(r.s === 403, 'MC tidak bisa menyetujui pembatalan akad');
r = await bm.post(`/refunds/${rf2.id}/decide`, { decision: 'approve' });
check(r.refund?.status === 'approved' && (await q1(`select status from credit_applications where contract_no='AKD-${YM}-00004'`)).status === 'cancelled', 'BM setuju, akad dibatalkan');
r = await ksrJ.post(`/refunds/${rf2.id}/pay`);
check(r.refund?.status === 'paid', 'refund tunai dibayar (shift)');
});

test('RETUR (ORD-3 selesai -> ganti)', async () => {
const o3 = await q1(`select id, branch_id from orders where order_no='ORD-${YM}-00003'`);
r = await ksrJ.post(`/orders/${o3.id}/pay`, { method: 'cash' });
const sh3 = await q1(`select id, from_branch_id from shipments where source_id=$1`, [o3.id]);
const op3 = sh3.from_branch_id === ho.id ? wh : baJ;
await op3.post(`/shipments/${sh3.id}/prepare-pickup`);
const code3 = (await q1(`select pickup_code from shipments where id=$1`, [sh3.id])).pickup_code;
await op3.post(`/shipments/${sh3.id}/deliver`, { podName: 'Bambang', pickupCode: code3 });
check((await q1(`select status from orders where id=$1`, [o3.id])).status === 'completed', 'ORD-3 selesai');
r = await baJ.get(`/aftersales/lookup?no=ORD-${YM}-00003`);
const it = r.source.items[0];
r = await baJ.post('/returns', { sourceNo: `ORD-${YM}-00003`, productId: it.productId, qty: 2, reason: 'damaged', description: 'Kaki sofa patah saat diterima', resolution: 'replace' });
check(r.s === 400, 'qty retur melebihi ditolak');
r = await baJ.post('/returns', { sourceNo: `ORD-${YM}-00003`, productId: it.productId, qty: 1, reason: 'damaged', description: 'Kaki sofa patah saat diterima', resolution: 'replace' });
check(r.s === 201, `retur diajukan ${r.return?.returnNo}`);
const rt = r.return;
r = await mcJ.post(`/returns/${rt.id}/decide`, { decision: 'approve' });
const stockBefore = await q1(`select on_hand, reserved from stock_levels where product_id=$1 and branch_id=$2`, [it.productId, o3.branch_id]);
r = await baJ.post(`/returns/${rt.id}/receive`, { condition: 'damaged', deliveryMode: 'pickup' });
check(r.return?.status === 'received' && r.return.replacementShipmentId, `retur diterima, pengganti dibuat (${r.error ?? ''})`);
const shR = await q1(`select id, from_branch_id, source_type from shipments where id=$1`, [r.return.replacementShipmentId]);
const opR = shR.from_branch_id === ho.id ? wh : baJ;
await opR.post(`/shipments/${shR.id}/prepare-pickup`);
const codeR = (await q1(`select pickup_code from shipments where id=$1`, [shR.id])).pickup_code;
r = await opR.post(`/shipments/${shR.id}/deliver`, { podName: 'Bambang', pickupCode: codeR });
check((await q1(`select status from product_returns where id=$1`, [rt.id])).status === 'completed', `retur selesai setelah pengganti diterima (${r.error ?? 'ok'}) dari ${shR.from_branch_id === ho.id ? 'HO' : 'cabang'}`);
});

test('RETUR repair (APP-5 lunas)', async () => {
r = await baJ.post('/returns', { sourceNo: `AKD-${YM}-00006`, productId: (await q1(`select product_id from credit_applications where id=$1`, [a5.id])).product_id, qty: 1, reason: 'defect', description: 'Tidak berfungsi setelah 2 minggu (garansi)', resolution: 'refund' });
check(r.s === 400, 'retur kredit dengan refund ditolak');
r = await baJ.post('/returns', { sourceNo: `AKD-${YM}-00006`, productId: (await q1(`select product_id from credit_applications where id=$1`, [a5.id])).product_id, qty: 1, reason: 'defect', description: 'Tidak berfungsi setelah 2 minggu (garansi)', resolution: 'repair' });
const rt2 = r.return;
await mcJ.post(`/returns/${rt2.id}/decide`, { decision: 'approve' });
r = await baJ.post(`/returns/${rt2.id}/receive`, { condition: 'damaged' });
r = await baJ.post(`/returns/${rt2.id}/complete`, { note: 'Diperbaiki service center resmi, diserahkan kembali' });
check(r.return?.status === 'completed', 'retur perbaikan selesai');
});

test('CLOSE SHIFT', async () => {
r = await ksrJ.get('/shifts/current');
const sum = r.summary;
console.log('   shift', r.shift.shiftNo, 'awal', r.shift.openingCash, 'masuk', sum.cashIn, 'keluar', sum.cashOut, 'sistem', sum.expectedCash, 'mutasi', sum.movements.length);
r = await ksrJ.post(`/shifts/${r.shift.id}/close`, { countedCash: sum.expectedCash - 50000, depositAmount: 100000 });
check(r.s === 400, 'selisih > toleransi tanpa catatan ditolak (atau setoran tanpa ref)');
const shiftId = (await ksrJ.get('/shifts/current')).shift.id;
r = await ksrJ.post(`/shifts/${shiftId}/close`, { countedCash: sum.expectedCash - 50000, depositAmount: sum.expectedCash - 550000, depositRef: 'SETOR-BSI-01', note: 'Kurang 50rb, sedang ditelusuri' });
check(r.shift?.status === 'closed' && Number(r.shift.variance) === -50000, `shift ditutup, selisih ${r.shift?.variance} ${r.error ?? ''}`);
r = await ksrJ.post(`/cashier/credits/${a5.id}/pay`, { amount: 1, method: 'cash' });
check(r.s === 409 || r.s === 400, `transaksi tunai setelah shift ditutup ditolak (${r.error})`);
r = await mcP.post(`/shifts/${shiftId}/verify`, {});
check(r.s === 403, 'MC cabang lain tidak bisa verifikasi');
r = await mcJ.post(`/shifts/${shiftId}/verify`, { note: 'Dicek' });
check(r.shift?.status === 'verified', 'MC verifikasi shift');
r = await ksrJ.get(`/payments?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })}`);
check(r.totals && r.outflows.length >= 2, `laporan kas: masuk ${r.totals.amount}, DP ${r.totals.downPayment}, ibra ${r.totals.ibra}, kas keluar ${r.totals.outflow}`);
});

