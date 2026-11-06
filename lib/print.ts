// Cetak kwitansi & bukti kas keluar di browser (Cetak / Simpan sebagai PDF).
import { api, ApiError } from './api';

export interface PrintDoc {
  kind: 'receipt' | 'expense' | 'refund';
  title: string; number: string; date: string | null; currency: string; status: string;
  company: string; branch: { name: string; address: string | null; phone: string | null };
  party: { label: string; name: string; phone?: string | null };
  lines: { label: string; amount: number; note?: string }[];
  total: number; totalLabel: string;
  extras: { label: string; value: string }[];
  officer: string | null; notes: string[];
}

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function words(n: number): string {
  n = Math.floor(n);
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`;
  if (n < 200) return `seratus ${words(n - 100)}`;
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`;
  if (n < 2000) return `seribu ${words(n - 1000)}`;
  if (n < 1e6) return `${words(Math.floor(n / 1000))} ribu ${words(n % 1000)}`;
  if (n < 1e9) return `${words(Math.floor(n / 1e6))} juta ${words(n % 1e6)}`;
  if (n < 1e12) return `${words(Math.floor(n / 1e9))} miliar ${words(n % 1e9)}`;
  return `${words(Math.floor(n / 1e12))} triliun ${words(n % 1e12)}`;
}
/** Terbilang (bahasa Indonesia), mis. 1.250.000 -> "Satu juta dua ratus lima puluh ribu rupiah". */
export function terbilang(v: number, currency = 'IDR') {
  const unit = currency === 'IDR' ? 'rupiah' : currency === 'MYR' ? 'ringgit' : currency === 'BND' ? 'dolar Brunei' : currency;
  const t = (Math.abs(v) < 1 ? 'nol' : words(Math.abs(v))).replace(/\s+/g, ' ').trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} ${unit}`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderDoc(d: PrintDoc) {
  const money = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: d.currency, maximumFractionDigits: d.currency === 'IDR' ? 0 : 2 }).format(v);
  const date = d.date ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(d.date)) : '-';
  const signLeft = d.kind === 'receipt' ? 'Penyetor' : 'Penerima';
  const signRight = d.kind === 'receipt' ? 'Petugas' : 'Kasir / Admin Cabang';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(d.title)} ${esc(d.number)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
  .doc{max-width:720px;margin:0 auto;border:1px solid #cbd5e1;border-radius:10px;padding:28px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #047857;padding-bottom:14px;margin-bottom:18px}
  .co{font-size:20px;font-weight:800;color:#047857}.sub{color:#475569;font-size:12px;margin-top:2px}
  .title{text-align:right}.title h1{margin:0;font-size:20px;letter-spacing:2px}.no{font-family:ui-monospace,monospace;color:#334155;margin-top:4px}
  .badge{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:11px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px}.k{color:#64748b;font-size:11px;text-transform:uppercase}.v{font-weight:600}
  table{width:100%;border-collapse:collapse;margin:8px 0}th,td{padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;color:#64748b}td.r,th.r{text-align:right;white-space:nowrap}.neg{color:#b91c1c}
  .total td{font-weight:800;font-size:15px;border-top:2px solid #0f172a;border-bottom:none}
  .terbilang{background:#f1f5f9;border-radius:6px;padding:8px 10px;font-style:italic;margin:6px 0 14px}
  .notes{color:#475569;font-size:11px;margin:4px 0}.sign{display:flex;justify-content:space-between;margin-top:36px;text-align:center}
  .sign>div{width:40%}.line{margin-top:56px;border-top:1px solid #0f172a;padding-top:4px}
  .foot{margin-top:18px;color:#94a3b8;font-size:10px;text-align:center}
  @media print{body{padding:0}.doc{border:none}.noprint{display:none}}
</style></head><body>
<div class="doc">
  <div class="head">
    <div><div class="co">${esc(d.company)}</div><div class="sub">${esc(d.branch.name)}${d.branch.address ? ` · ${esc(d.branch.address)}` : ''}${d.branch.phone ? ` · ${esc(d.branch.phone)}` : ''}</div></div>
    <div class="title"><h1>${esc(d.title)}</h1><div class="no">${esc(d.number)}</div><span class="badge">${esc(d.status)}</span></div>
  </div>
  <div class="grid">
    <div><div class="k">${esc(d.party.label)}</div><div class="v">${esc(d.party.name)}${d.party.phone ? ` · ${esc(d.party.phone)}` : ''}</div></div>
    <div><div class="k">Tanggal</div><div class="v">${esc(date)}</div></div>
    ${d.extras.map((x) => `<div><div class="k">${esc(x.label)}</div><div class="v">${esc(x.value)}</div></div>`).join('')}
  </div>
  <table><thead><tr><th>Uraian</th><th class="r">Jumlah</th></tr></thead><tbody>
    ${d.lines.map((l) => `<tr><td>${esc(l.label)}${l.note ? `<div class="notes">${esc(l.note)}</div>` : ''}</td><td class="r ${l.amount < 0 ? 'neg' : ''}">${money(l.amount)}</td></tr>`).join('')}
    <tr class="total"><td>${esc(d.totalLabel)}</td><td class="r">${money(d.total)}</td></tr>
  </tbody></table>
  <div class="terbilang">Terbilang: ${esc(terbilang(d.total, d.currency))}</div>
  ${d.notes.map((n) => `<p class="notes">• ${esc(n)}</p>`).join('')}
  <div class="sign"><div><div>${signLeft}</div><div class="line">${d.kind === 'receipt' ? esc(d.party.name) : esc(d.party.name)}</div></div>
    <div><div>${signRight}</div><div class="line">${esc(d.officer ?? '')}</div></div></div>
  <div class="foot">Dicetak dari sistem Masri-M. Pembayaran elektronik (VA/QRIS) sah tanpa tanda tangan; transaksi di kasir sah setelah ditandatangani petugas. Simpan sebagai bukti transaksi.</div>
</div>
<p class="noprint" style="text-align:center;margin-top:16px"><button id="masri-print" style="padding:8px 18px;background:#047857;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer">Cetak / Simpan PDF</button></p>

</body></html>`;
}

/**
 * Jendela cetak mewarisi Content-Security-Policy aplikasi (tanpa skrip inline), jadi tombol & cetak otomatis
 * dipasang dari jendela induk, bukan lewat <script> / onclick di dalam dokumen.
 */
function armPrint(w: Window) {
  w.document.getElementById('masri-print')?.addEventListener('click', () => w.print());
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* jendela ditutup */ } }, 300);
}

/** Buka jendela cetak lalu isi dengan dokumen dari API. Jendela dibuka dulu (sinkron) agar tidak diblokir popup blocker. */
export async function printFrom(path: string) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:24px">Menyiapkan dokumen…</p>');
  try {
    const { doc } = await api.get<{ doc: PrintDoc }>(path);
    if (!w) throw new ApiError(0, 'Popup diblokir browser — izinkan popup untuk mencetak');
    w.document.open(); w.document.write(renderDoc(doc)); w.document.close(); armPrint(w);
  } catch (e) {
    if (w) { w.document.open(); w.document.write(`<p style="font-family:sans-serif;padding:24px;color:#b91c1c">${esc((e as Error).message)}</p>`); w.document.close(); }
    else throw e;
  }
}
export const printReceipt = (paymentNo: string, phone?: string) => printFrom(phone ? `/public/receipts/${paymentNo}?phone=${encodeURIComponent(phone)}` : `/receipts/${paymentNo}`);
export const printVoucher = (type: 'expense' | 'refund', id: string) => printFrom(`/vouchers/${type}/${id}`);

// ---------------------------------------------------------------------------
// Akad Murabahah
// ---------------------------------------------------------------------------
export interface ContractDoc {
  company: string; branch: { name: string; address: string | null; city: string }; contractNo: string; appNo: string; signedAt: string | null; currency: string; status: string;
  customer: { name: string; nik: string; address: string; phone: string | null };
  item: { name: string; brand: string; qty: number; warrantyMonths: number | null };
  terms: { cashPrice: number; downPayment: number; financed: number; marginPct: number; marginAmount: number; salePrice: number; tenor: number; monthly: number; shippingFee: number; tazir: number; graceDays: number; ibraPct: number };
  schedule: { seq: number; dueDate: string; amount: number; status: string }[];
  clauses: string[];
  lang?: 'id' | 'ms' | 'en';
}

const CL = {
  id: { title: 'AKAD JUAL BELI MURABAHAH', no: 'No.', app: 'Pengajuan', on: (d: string, b: string) => `Pada tanggal <b>${d}</b> di ${b}, yang bertanda tangan di bawah ini:`, seller: 'Penjual', rep: 'diwakili',
    buyer: 'Pembeli', idNo: 'No. identitas', addr: 'Alamat', phone: 'No. HP', agree: 'sepakat mengadakan akad jual beli Murabahah atas barang berikut:', item: 'Barang', warranty: 'Garansi produsen', months: 'bulan',
    price: 'Harga & cara pembayaran', cash: 'Harga beli / harga tunai (pokok)', dp: 'Uang muka (urbun)', fin: 'Sisa pokok yang dibiayai', margin: (p: number) => `Keuntungan (margin) ${p}% — disepakati di awal`,
    sale: 'HARGA JUAL MURABAHAH (sisa yang diangsur)', tenor: 'Jangka waktu', monthly: 'Angsuran tetap per bulan', ship: 'Ongkos kirim (dibayar saat akad)', terms: 'Ketentuan',
    sched: 'Lampiran: jadwal angsuran', n: 'Ke', due: 'Jatuh tempo', inst: 'Angsuran', noSched: 'Jadwal angsuran diterbitkan setelah barang diterima Pembeli.',
    close: 'Demikian akad ini dibuat dengan penuh kesadaran dan kerelaan (<i>an-taradhin</i>) kedua belah pihak.', print: 'Cetak / Simpan PDF', locale: 'id-ID' },
  ms: { title: 'AKAD JUAL BELI MURABAHAH', no: 'No.', app: 'Permohonan', on: (d: string, b: string) => `Pada <b>${d}</b> di ${b}, pihak-pihak yang menandatangani di bawah:`, seller: 'Penjual', rep: 'diwakili oleh',
    buyer: 'Pembeli', idNo: 'No. pengenalan', addr: 'Alamat', phone: 'No. telefon', agree: 'bersetuju memeterai akad jual beli Murabahah bagi barang berikut:', item: 'Barang', warranty: 'Waranti pengeluar', months: 'bulan',
    price: 'Harga & cara bayaran', cash: 'Harga tunai (kos)', dp: 'Wang pendahuluan (urbun)', fin: 'Baki yang dibiayai', margin: (p: number) => `Keuntungan (margin) ${p}% — dipersetujui dari awal`,
    sale: 'HARGA JUALAN MURABAHAH (baki yang diansur)', tenor: 'Tempoh', monthly: 'Ansuran tetap sebulan', ship: 'Kos penghantaran (dibayar semasa akad)', terms: 'Syarat-syarat',
    sched: 'Lampiran: jadual ansuran', n: 'Ke', due: 'Tarikh matang', inst: 'Ansuran', noSched: 'Jadual ansuran dikeluarkan selepas barang diterima Pembeli.',
    close: 'Akad ini dimeterai dengan penuh kesedaran dan kerelaan (<i>an-taradhin</i>) kedua-dua pihak.', print: 'Cetak / Simpan PDF', locale: 'ms-MY' },
  en: { title: 'MURABAHAH SALE CONTRACT', no: 'No.', app: 'Application', on: (d: string, b: string) => `On <b>${d}</b> at ${b}, the undersigned parties:`, seller: 'Seller', rep: 'represented by',
    buyer: 'Buyer', idNo: 'ID number', addr: 'Address', phone: 'Mobile', agree: 'agree to enter into a Murabahah sale contract for the following goods:', item: 'Goods', warranty: 'Manufacturer warranty', months: 'months',
    price: 'Price & payment', cash: 'Cash price (cost)', dp: 'Down payment (urbun)', fin: 'Amount financed', margin: (p: number) => `Profit margin ${p}% — agreed upfront`,
    sale: 'MURABAHAH SALE PRICE (balance by instalments)', tenor: 'Tenure', monthly: 'Fixed monthly instalment', ship: 'Delivery fee (paid at signing)', terms: 'Terms',
    sched: 'Appendix: instalment schedule', n: '#', due: 'Due date', inst: 'Instalment', noSched: 'The instalment schedule is issued after the Buyer receives the goods.',
    close: 'This contract is made with full awareness and mutual consent (<i>an-taradhin</i>) of both parties.', print: 'Print / Save PDF', locale: 'en-GB' },
};

export function renderContract(d: ContractDoc) {
  const L = CL[d.lang ?? 'id'] ?? CL.id;
  const m = (v: number) => new Intl.NumberFormat(L.locale, { style: 'currency', currency: d.currency, maximumFractionDigits: d.currency === 'IDR' ? 0 : 2 }).format(v ?? 0);
  const date = d.signedAt ? new Intl.DateTimeFormat(L.locale, { dateStyle: 'long' }).format(new Date(d.signedAt)) : '-';
  const t = d.terms;
  const row = (k: string, v: string, strong = false) => `<tr><td>${esc(k)}</td><td class="r${strong ? ' b' : ''}">${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="${d.lang ?? 'id'}"><head><meta charset="utf-8"><title>${L.title} ${esc(d.contractNo)}</title><style>
  body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:0;padding:32px;font-size:13px;line-height:1.55}
  .doc{max-width:760px;margin:0 auto}h1{text-align:center;font-size:18px;letter-spacing:1px;margin:0}h2{font-size:14px;margin:18px 0 6px}
  .c{text-align:center}.muted{color:#555}.b{font-weight:bold}table{width:100%;border-collapse:collapse;margin:6px 0}td,th{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}
  td.r{text-align:right;white-space:nowrap}.grid td:first-child{width:38%;color:#444}ol{padding-left:20px}li{margin-bottom:6px}
  .sched{font-size:11px}.sched td,.sched th{padding:2px 4px}.sign{display:flex;justify-content:space-between;margin-top:40px;text-align:center}.sign>div{width:42%}.line{margin-top:70px;border-top:1px solid #111;padding-top:4px}
  .bis{text-align:center;font-size:15px;margin-bottom:6px}@media print{body{padding:0}.noprint{display:none}}
</style></head><body><div class="doc">
  <p class="bis">بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</p>
  <h1>${L.title}</h1>
  <p class="c muted">${L.no} ${esc(d.contractNo)} · ${L.app} ${esc(d.appNo)}</p>
  <p>${L.on(esc(date), esc(d.branch.name))}</p>
  <table class="grid">
    ${row(L.seller, `${d.company}, ${L.rep} ${d.branch.name}${d.branch.address ? `, ${d.branch.address}` : ''}`)}
    ${row(L.buyer, d.customer.name)}${row(L.idNo, d.customer.nik)}${row(L.addr, d.customer.address)}${row(L.phone, d.customer.phone ?? '-')}
  </table>
  <p>${L.agree}</p>
  <table class="grid">${row(L.item, `${d.item.name} (${d.item.brand}) × ${d.item.qty}`)}${row(L.warranty, d.item.warrantyMonths ? `${d.item.warrantyMonths} ${L.months}` : '-')}</table>
  <h2>${L.price}</h2>
  <table class="grid">
    ${row(L.cash, m(t.cashPrice))}${row(L.dp, m(t.downPayment))}${row(L.fin, m(t.financed))}
    ${row(L.margin(t.marginPct), m(t.marginAmount))}${row(L.sale, m(t.salePrice), true)}
    ${row(L.tenor, `${t.tenor} ${L.months}`)}${row(L.monthly, m(t.monthly), true)}${t.shippingFee ? row(L.ship, m(t.shippingFee)) : ''}
  </table>
  <h2>${L.terms}</h2>
  <ol>${d.clauses.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  ${d.schedule.length ? `<h2>${L.sched}</h2><table class="sched"><tr><th>${L.n}</th><th>${L.due}</th><th class="r">${L.inst}</th><th>${L.n}</th><th>${L.due}</th><th class="r">${L.inst}</th></tr>
    ${Array.from({ length: Math.ceil(d.schedule.length / 2) }, (_, i) => { const a = d.schedule[i], b = d.schedule[i + Math.ceil(d.schedule.length / 2)];
      return `<tr><td>${a.seq}</td><td>${esc(a.dueDate)}</td><td class="r">${m(a.amount)}</td>${b ? `<td>${b.seq}</td><td>${esc(b.dueDate)}</td><td class="r">${m(b.amount)}</td>` : '<td></td><td></td><td></td>'}</tr>`; }).join('')}</table>`
    : `<p class="muted">${L.noSched}</p>`}
  <p>${L.close}</p>
  <div class="sign"><div>${L.seller}<div class="line">${esc(d.company)}</div></div><div>${L.buyer}<div class="line">${esc(d.customer.name)}</div></div></div>
</div>
<p class="noprint" style="text-align:center;margin-top:16px"><button id="masri-print" style="padding:8px 18px;background:#047857;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer">${L.print}</button></p>
</body></html>`;
}

export async function printContract(path: string) {
  const w = window.open('', '_blank', 'width=860,height=900');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:24px">Menyiapkan akad…</p>');
  try {
    const { doc } = await api.get<{ doc: ContractDoc }>(path);
    if (!w) throw new ApiError(0, 'Popup diblokir browser — izinkan popup untuk mencetak');
    w.document.open(); w.document.write(renderContract(doc)); w.document.close(); armPrint(w);
  } catch (e) {
    if (w) { w.document.open(); w.document.write(`<p style="font-family:sans-serif;padding:24px;color:#b91c1c">${esc((e as Error).message)}</p>`); w.document.close(); }
    else throw e;
  }
}
