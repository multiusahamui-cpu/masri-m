import { afterAll, beforeAll, expect, test } from 'vitest';
import { login, pool, q1, startApp, startFakes } from './helpers.js';
import { syncJournals } from '../src/lib/accounting.js';

/** Akuntansi syariah: invarian jurnal, PSAK 102 Murabahah, dana kebajikan, jurnal manual & tutup periode. */
const check = (c: unknown, m: string) => expect(c, m).toBeTruthy();
let app: Awaited<ReturnType<typeof startApp>>, fakes: ReturnType<typeof startFakes>;
let acc: Awaited<ReturnType<typeof login>>;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

beforeAll(async () => { fakes = startFakes(); app = await startApp(); acc = await login('acc@masri-m.local'); });
afterAll(async () => { app.server.close(); fakes.server.close(); });

test('Posting otomatis lengkap, idempoten, dan setiap jurnal seimbang per kantor', async () => {
  await syncJournals({ retryErrors: true });
  const again = await syncJournals();
  check(again.posted === 0, 'posting ulang tidak membuat jurnal ganda');
  const err = await q1(`select count(*)::int n, string_agg(message, ' | ') m from posting_errors`);
  check(err.n === 0, `tidak ada error posting: ${err.m}`);
  const s = await acc.get('/accounting/summary');
  check(s.pending === 0, `semua transaksi terposting (sisa ${s.pending})`);
  const unbal = await q1(`select count(*)::int n from (select entry_id, branch_id from journal_lines group by 1, 2 having abs(sum(debit) - sum(credit)) > 0.005) x`);
  check(unbal.n === 0, 'setiap jurnal seimbang per kantor');
  const kinds = await q1(`select count(distinct source_type)::int n from journal_entries`);
  check(kinds.n >= 4, `jurnal dari ${kinds.n} jenis sumber`);
  const rak = await q1(`select coalesce(sum(debit - credit), 0)::float v from journal_lines where account_code = '1901'`);
  check(near(rak.v, 0), `RAK konsolidasi nol (${rak.v})`);
  const transit = await q1(`select coalesce(sum(qty_shipped - coalesce(qty_received, 0)), 0)::int n from stock_transfer_items i join stock_transfers t on t.id = i.transfer_id where t.status = 'shipped'`);
  const git = await q1(`select coalesce(sum(debit - credit), 0)::float v from journal_lines where account_code = '1302'`);
  check((transit.n > 0) === (git.v > 0.01), `persediaan dalam perjalanan ${git.v} (${transit.n} unit belum diterima)`);
  // Uang muka order tunai: nol bila barang sudah keluar, = total bila sudah dibayar tetapi belum dikirim
  const { rows: adv } = await pool.query(`
    select o.order_no, o.status, o.total::float total,
      coalesce((select sum(credit - debit) from journal_lines l where l.account_code = '2202' and l.sub_id = o.id), 0)::float adv,
      exists (select 1 from stock_movements m where m.ref_id = o.id::text and m.type = 'sale_out') shipped,
      coalesce((select sum(amount) from refunds r where r.source_id = o.id and r.status = 'paid'), 0)::float refunded
    from orders o where o.paid_at is not null`);
  for (const o of adv) check(near(o.adv, o.shipped ? 0 : o.total - o.refunded), `${o.order_no} (${o.status}): uang muka penjualan ${o.adv}`);
  const sales = await q1(`select count(*)::int n from journal_entries where source_type = 'order' and event = 'revenue'`);
  check(sales.n > 0, `${sales.n} pengakuan penjualan tunai saat barang keluar`);
});

test('Laporan: neraca saldo seimbang, neraca A = K + E, laba rugi konsisten', async () => {
  const tb = await acc.get('/accounting/trial-balance?from=2000-01-01');
  check(tb.balanced && near(tb.totals.debit, tb.totals.credit), `neraca saldo: debit ${tb.totals.debit} = kredit ${tb.totals.credit}`);
  const bs = await acc.get('/accounting/balance-sheet');
  check(bs.balanced, `neraca: aset ${bs.totalAssets.total} = kewajiban + ekuitas ${bs.totalLiabilitiesEquity.total}`);
  for (const b of bs.branches) check(near(bs.totalAssets.byBranch[b.id], bs.totalLiabilitiesEquity.byBranch[b.id]), `neraca ${b.code} seimbang`);
  const year = new Date().toISOString().slice(0, 4);
  const pl = await acc.get(`/accounting/income-statement?from=${year}-01-01`);
  const cy = bs.equity.flatMap((g: any) => g.rows).find((r: any) => r.name.startsWith('Laba tahun berjalan'));
  check(near(pl.netIncome.total, cy.total), `laba rugi ${pl.netIncome.total} = laba berjalan di neraca`);
  const margin = pl.income.flatMap((g: any) => g.rows).find((r: any) => r.code === '4201');
  check(margin?.total > 0, `pendapatan margin Murabahah ${margin?.total}`);
  const mcj = await login('mc.jkt@masri-m.local');
  const own = await mcj.get('/accounting/balance-sheet');
  check(own.branches.length === 1 && own.branches[0].code === 'JKT01' && own.balanced, 'Manager Cabang hanya melihat neraca cabangnya (seimbang dengan RAK)');
  const deny = await mcj.post('/accounting/journals', {});
  check(deny.s === 403, 'Manager Cabang tidak bisa membuat jurnal');
});

test('PSAK 102: buku pembantu piutang cocok dengan jadwal angsuran; margin habis saat lunas', async () => {
  const r = await acc.get('/accounting/reconciliation');
  check(r.issues === 0, `rekonsiliasi tanpa selisih: ${JSON.stringify(r.items.filter((i: any) => i.issue).slice(0, 3))}`);
  const active = r.items.filter((i: any) => i.status === 'active');
  check(active.length > 0 || r.items.some((i: any) => i.status === 'paid_off'), `ada pembiayaan berjalan/lunas (${active.length} aktif)`);
  for (const i of r.items.filter((x: any) => ['active', 'paid_off'].includes(x.status))) {
    const sale = await q1(`select meta from journal_entries where event = 'murabahah' and meta->>'creditId' = $1`, [i.id]);
    check(sale, `jurnal penjualan Murabahah ${i.contractNo}`);
    // margin diakui + margin ditangguhkan = total margin akad − ibra'
    const ibra = await q1(`select coalesce(sum(ibra_amount), 0)::float v from payments where kind = 'installment' and ref_id = $1 and status = 'paid'`, [i.id]);
    check(near(i.marginIncome + i.glDeferredMargin + ibra.v, sale.meta.margin), `${i.contractNo}: margin diakui ${i.marginIncome} + ditangguhkan ${i.glDeferredMargin} + ibra' ${ibra.v} = ${sale.meta.margin}`);
    if (i.status === 'paid_off') check(near(i.glDeferredMargin, 0) && near(i.glReceivable, 0), `${i.contractNo} lunas: piutang & margin ditangguhkan nol`);
  }
});

test("Dana kebajikan: ta'zir masuk kewajiban, penyaluran mengurangi saldo", async () => {
  const tz = await q1(`select coalesce(sum(tazir_amount), 0)::float v from payments where status = 'paid'`);
  let c = await acc.get('/accounting/charity?from=2000-01-01');
  check(near(c.totalIn, tz.v), `penerimaan dana kebajikan ${c.totalIn} = ta'zir dibayar ${tz.v}`);
  const ho = await q1(`select id from branches where type = 'head_office'`);
  const pl = await acc.get('/accounting/income-statement?from=2000-01-01');
  check(!pl.income.flatMap((g: any) => g.rows).some((r: any) => r.code === '2301'), "ta'zir tidak tercatat sebagai pendapatan");
  let r = await acc.post('/accounting/charity', { branchId: ho.id, date: new Date().toISOString().slice(0, 10), recipient: 'Panti Asuhan Al-Ikhlas', purpose: 'social', description: 'Santunan anak yatim', amount: c.closing + 1, method: 'cash' });
  check(r.s === 400, 'penyaluran melebihi saldo ditolak');
  if (c.closing > 0) {
    const amt = Math.min(c.closing, 10_000);
    r = await acc.post('/accounting/charity', { branchId: ho.id, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }), recipient: 'Panti Asuhan Al-Ikhlas', purpose: 'social', description: 'Santunan anak yatim', amount: amt, method: 'transfer', ref: 'TRF-001' });
    check(r.s === 201, `penyaluran ${amt} (${r.error ?? r.disbursement?.disbNo})`);
    const before = c.closing;
    c = await acc.get('/accounting/charity?from=2000-01-01');
    check(near(c.closing, before - amt) && c.disbursements.length >= 1, `saldo dana kebajikan ${before} → ${c.closing}`);
  }
});

test('Jurnal manual: validasi, pembalik, tutup periode', async () => {
  const ho = await q1(`select id from branches where type = 'head_office'`);
  const jkt = await q1(`select id from branches where code = 'JKT01'`);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  let r = await acc.post('/accounting/journals', { date: today, memo: 'Uji tidak seimbang', lines: [{ accountCode: '1102', branchId: ho.id, debit: 100, credit: 0 }, { accountCode: '3101', branchId: ho.id, debit: 0, credit: 90 }] });
  check(r.s === 400 && /tidak seimbang/.test(r.error), `jurnal tidak seimbang ditolak: ${r.error}`);
  r = await acc.post('/accounting/journals', { date: today, memo: 'Dropping kas Pusat ke cabang Jakarta', lines: [{ accountCode: '1101', branchId: jkt.id, debit: 5_000_000, credit: 0 }, { accountCode: '1102', branchId: ho.id, debit: 0, credit: 5_000_000 }] });
  check(r.s === 201 && r.entry.entryNo.startsWith('JM-'), `jurnal manual antar kantor ${r.entry?.entryNo}`);
  const d = await acc.get(`/accounting/journals/${r.entry.id}`);
  check(d.lines.filter((l: any) => l.accountCode === '1901').length === 2, 'RAK otomatis di kedua kantor');
  const rev = await acc.post(`/accounting/journals/${r.entry.id}/reverse`, { reason: 'Salah input nominal' });
  check(rev.s === 201 && rev.entry.entryNo.startsWith('JB-'), `jurnal pembalik ${rev.entry?.entryNo}`);
  const again = await acc.post(`/accounting/journals/${r.entry.id}/reverse`, { reason: 'Salah input nominal' });
  check(again.s === 409, 'tidak bisa dibalik dua kali');
  const auto = await q1(`select id from journal_entries where source_type = 'payment' limit 1`);
  r = await acc.post(`/accounting/journals/${auto.id}/reverse`, { reason: 'Coba balik otomatis' });
  check(r.s === 409, 'jurnal otomatis tidak bisa dibalik manual');
  // Tutup periode lalu (backdate satu jurnal ke bulan lalu)
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  const pDate = prev.toISOString().slice(0, 10), period = pDate.slice(0, 7);
  r = await acc.post('/accounting/journals', { date: pDate, memo: 'Koreksi bulan lalu', lines: [{ accountCode: '6199', branchId: ho.id, debit: 1000, credit: 0 }, { accountCode: '1102', branchId: ho.id, debit: 0, credit: 1000 }] });
  check(r.s === 201, 'jurnal bulan lalu sebelum ditutup');
  r = await acc.post(`/accounting/periods/${today.slice(0, 7)}/close`, {});
  check(r.s === 400, 'periode berjalan tidak bisa ditutup');
  r = await acc.post(`/accounting/periods/${period}/close`, { note: 'Tutup buku' });
  check(r.s === 200, `periode ${period} ditutup (${r.error ?? 'ok'})`);
  r = await acc.post('/accounting/journals', { date: pDate, memo: 'Koreksi terlambat', lines: [{ accountCode: '6199', branchId: ho.id, debit: 1000, credit: 0 }, { accountCode: '1102', branchId: ho.id, debit: 0, credit: 1000 }] });
  check(r.s === 409, 'jurnal ke periode tertutup ditolak');
  r = await acc.post(`/accounting/periods/${period}/reopen`, { reason: 'Uji buka kembali' });
  check(r.s === 200, 'periode dibuka kembali');
  const tb = await acc.get('/accounting/trial-balance?from=2000-01-01');
  check(tb.balanced, 'neraca saldo tetap seimbang');
  await pool.query('select 1');
});
