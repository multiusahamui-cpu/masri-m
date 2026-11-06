import nodemailer, { type Transporter } from 'nodemailer';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customers, notificationOutbox } from '../db/schema.js';
import { getConfig } from './config.js';
import type { Tx } from './stock.js';
import { countryOfPhone, e164 } from './region.js';

/**
 * Notifikasi ke nasabah lewat WhatsApp & email memakai pola OUTBOX:
 * pesan disimpan dulu di tabel (dalam transaksi bisnis yang sama), lalu dikirim worker berkala dengan retry.
 * Transaksi tidak pernah gagal karena provider WhatsApp/email sedang bermasalah.
 *
 * Provider (env):
 *   WHATSAPP_PROVIDER = log (default, hanya dicatat di console) | fonnte (FONNTE_TOKEN)
 *   SMTP_URL          = smtp://user:pass@host:port  (kosong = email hanya dicatat). Lokal: Mailpit smtp://localhost:1025
 *   MAIL_FROM         = "Masri-M Syariah <no-reply@masri-m.co.id>"
 *   PUBLIC_WEB_URL    = alamat website untuk tautan di pesan
 */
type Db = Tx | typeof db;
export const webUrl = () => (process.env.PUBLIC_WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const LOCALE_OF: Record<string, string> = { IDR: 'id-ID', MYR: 'ms-MY', BND: 'ms-BN' };
const fmt = (v: number, cur = 'IDR') => new Intl.NumberFormat(LOCALE_OF[cur] ?? 'id-ID', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'IDR' ? 0 : 2 }).format(v);
const dt = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(d)) : '-');
const BANK: Record<string, string> = { bca: 'BCA', bni: 'BNI', bri: 'BRI', permata: 'Permata' };

// ---------------------------------------------------------------------------
// Template pesan: Bahasa Indonesia, Bahasa Melayu, English (singkat & sopan)
// ---------------------------------------------------------------------------
export type Template =
  | 'order_created' | 'payment_received' | 'shipment_scheduled' | 'shipment_in_transit' | 'pickup_ready' | 'shipment_delivered'
  | 'credit_submitted' | 'credit_approved' | 'credit_rejected' | 'credit_active' | 'credit_paid_off' | 'credit_cancelled'
  | 'installment_reminder' | 'installment_overdue' | 'refund_paid' | 'dp_due' | 'promo';
export type Lang = 'id' | 'ms' | 'en';

type Vars = Record<string, string | number | null | undefined>;
const SIGN: Record<Lang, string> = {
  id: '\n\nMasri-M Syariah — belanja elektronik & furniture tanpa riba.',
  ms: '\n\nMasri-M Syariah — beli elektronik & perabot tanpa riba.',
  en: '\n\nMasri-M Syariah — riba-free electronics & furniture.',
};
const HI: Record<Lang, (n: unknown) => string> = { id: (n) => `Assalamualaikum ${n},\n`, ms: (n) => `Assalamualaikum ${n},\n`, en: (n) => `Assalamualaikum ${n},\n` };

/** Kalimat cara bayar (VA / QRIS / FPX / kasir). */
function payText(l: Lang, v: Vars) {
  const bank = BANK[String(v.payBank ?? '')] ?? '';
  switch (v.payMethod) {
    case 'va': return { id: `Transfer ke Virtual Account ${bank}: ${v.payVa}`, ms: `Pindahan ke Virtual Account ${bank}: ${v.payVa}`, en: `Transfer to ${bank} Virtual Account: ${v.payVa}` }[l];
    case 'qris': return { id: 'Bayar dengan QRIS dari halaman lacak pesanan.', ms: 'Bayar dengan QRIS dari halaman jejak pesanan.', en: 'Pay with QRIS from the order tracking page.' }[l];
    case 'fpx': return { id: `Bayar dengan FPX: ${v.payUrl ?? v.link}`, ms: `Bayar dengan FPX: ${v.payUrl ?? v.link}`, en: `Pay with FPX: ${v.payUrl ?? v.link}` }[l];
    default: return { id: 'Bayar di kasir cabang dengan menyebutkan nomor pesanan.', ms: 'Bayar di kaunter cawangan dengan menyatakan nombor pesanan.', en: 'Pay at the branch counter quoting your order number.' }[l];
  }
}
/** Cara bayar uang muka akad. */
function dpText(l: Lang, v: Vars) {
  if (v.payMethod === 'cashier') return { id: `Bayar di kasir cabang (tunai / transfer) dengan menyebutkan nomor akad ${v.contractNo}.`, ms: `Bayar di kaunter cawangan (tunai / pindahan) dengan menyatakan nombor akad ${v.contractNo}.`, en: `Pay at the branch counter (cash / transfer) quoting contract number ${v.contractNo}.` }[l];
  return payText(l, v);
}
const PURPOSE: Record<string, Record<Lang, (r: unknown) => string>> = {
  order: { id: (r) => `pesanan ${r}`, ms: (r) => `pesanan ${r}`, en: (r) => `order ${r}` },
  down_payment: { id: (r) => `uang muka akad ${r}`, ms: (r) => `wang pendahuluan akad ${r}`, en: (r) => `the down payment for contract ${r}` },
  settlement: { id: (r) => `pelunasan akad ${r}`, ms: (r) => `penyelesaian akad ${r}`, en: (r) => `early settlement of contract ${r}` },
  installment: { id: (r) => `angsuran akad ${r}`, ms: (r) => `ansuran akad ${r}`, en: (r) => `the instalment for contract ${r}` },
};
const EXTRA: Record<string, Record<Lang, (v: Vars) => string>> = {
  order_preparing: { id: () => 'Pesanan Anda sedang kami siapkan untuk dikirim / diambil.', ms: () => 'Pesanan anda sedang disediakan untuk dihantar / diambil.', en: () => 'We are preparing your order for delivery / collection.' },
  outstanding: { id: (v) => `Sisa kewajiban: ${v.outstanding}.`, ms: (v) => `Baki tertunggak: ${v.outstanding}.`, en: (v) => `Outstanding balance: ${v.outstanding}.` },
  schedule_active: { id: () => 'Jadwal angsuran Anda kini aktif.', ms: () => 'Jadual ansuran anda kini aktif.', en: () => 'Your instalment schedule is now active.' },
};
const extraLine = (l: Lang, v: Vars) => (v.extraKey && EXTRA[String(v.extraKey)] ? `\n${EXTRA[String(v.extraKey)][l](v)}` : v.extra ? `\n${v.extra}` : '');
const purposeOf = (l: Lang, v: Vars) => (v.purposeKind && PURPOSE[String(v.purposeKind)] ? PURPOSE[String(v.purposeKind)][l](v.purposeRef) : String(v.purpose ?? ''));

type T = (v: Vars) => { subject: string; body: string };
const TEMPLATES: Record<Lang, Record<Template, T>> = {
  id: {
    order_created: (v) => ({ subject: `Pesanan ${v.orderNo} — menunggu pembayaran`, body: `${HI.id(v.name)}Terima kasih, pesanan ${v.orderNo} sudah kami terima.\n\n${payText('id', v)}\nTotal: ${v.total}\nBayar sebelum: ${v.expires}\n\nLacak pesanan: ${v.link}` }),
    payment_received: (v) => ({ subject: `Pembayaran ${v.paymentNo} diterima`, body: `${HI.id(v.name)}Pembayaran ${v.amount} untuk ${purposeOf('id', v)} telah kami terima (${v.paymentNo}).${extraLine('id', v)}\n\nKwitansi & status: ${v.link}` }),
    shipment_scheduled: (v) => ({ subject: `Jadwal pengiriman ${v.ref}`, body: `${HI.id(v.name)}Barang ${v.items} dijadwalkan diantar armada Masri-M pada ${v.date} (${v.slot}). Mohon pastikan ada penerima di alamat.\n\nLacak: ${v.link}` }),
    shipment_in_transit: (v) => ({ subject: `Pesanan ${v.ref} dalam pengiriman`, body: `${HI.id(v.name)}Barang ${v.items} sedang dikirim ${v.carrier}${v.trackingNo ? ` dengan nomor resi ${v.trackingNo}` : ''}.\n\nLacak: ${v.link}` }),
    pickup_ready: (v) => ({ subject: `Barang siap diambil — ${v.ref}`, body: `${HI.id(v.name)}Barang ${v.items} sudah siap diambil di ${v.location}.\nKODE PENGAMBILAN: *${v.code}* (berlaku s/d ${v.expires}).\nBawa kartu identitas asli & tunjukkan kode ini kepada petugas. Jangan bagikan kode kepada orang lain.\n\nLacak: ${v.link}` }),
    shipment_delivered: (v) => ({ subject: `Barang ${v.ref} telah diterima`, body: `${HI.id(v.name)}Barang ${v.items} telah diterima oleh ${v.receiver}. Semoga bermanfaat dan berkah.${extraLine('id', v)}\n\nJika ada kendala, hubungi kami: ${v.link}` }),
    credit_submitted: (v) => ({ subject: `Pengajuan ${v.appNo} diterima`, body: `${HI.id(v.name)}Pengajuan pembiayaan Murabahah ${v.appNo} untuk ${v.product} sudah kami terima. Petugas kami akan segera menghubungi untuk verifikasi.\n\nCek status: ${v.link}` }),
    dp_due: (v) => ({ subject: `Akad ${v.contractNo} — bayar uang muka`, body: `${HI.id(v.name)}Akad Murabahah ${v.contractNo} sudah ditandatangani.\nUang muka + ongkir yang perlu dibayar: ${v.amount}.\n${dpText('id', v)}${v.expires ? `\nBayar sebelum: ${v.expires}` : ''}\nAkad berlaku dan barang disiapkan setelah uang muka diterima.\n\nDetail: ${v.link}` }),
    promo: (v) => ({ subject: String(v.subject ?? 'Promo Masri-M'), body: `${HI.id(v.name)}${v.body}${v.link ? `\n\n${v.link}` : ''}\n\nTidak ingin menerima promo? Balas BERHENTI atau ubah di Akun Saya.` }),
    credit_approved: (v) => ({ subject: `Pengajuan ${v.appNo} disetujui`, body: `${HI.id(v.name)}Alhamdulillah, pengajuan ${v.appNo} (${v.product}) DISETUJUI.\nHarga jual Murabahah ${v.salePrice}, angsuran tetap ${v.monthly} × ${v.tenor} bulan, uang muka ${v.dp}.\nSilakan datang ke ${v.branch} untuk akad sebelum ${v.validUntil}.\n\nDetail: ${v.link}` }),
    credit_rejected: (v) => ({ subject: `Hasil pengajuan ${v.appNo}`, body: `${HI.id(v.name)}Mohon maaf, pengajuan ${v.appNo} belum dapat kami setujui saat ini. Anda tetap dapat membeli secara tunai atau mengajukan kembali di kemudian hari.\n\nInfo: ${v.link}` }),
    credit_active: (v) => ({ subject: `Pembiayaan ${v.contractNo} aktif`, body: `${HI.id(v.name)}Barang telah Anda terima dan pembiayaan ${v.contractNo} aktif.\nAngsuran pertama ${v.monthly} jatuh tempo ${v.firstDue}. Bayar dari Akun Saya / halaman status atau di kasir cabang.\n\nJadwal angsuran: ${v.link}` }),
    credit_paid_off: (v) => ({ subject: `Pembiayaan ${v.contractNo} LUNAS`, body: `${HI.id(v.name)}Alhamdulillah, pembiayaan ${v.contractNo} telah LUNAS. Terima kasih atas amanah Anda. Barakallahu fiikum.\n\nKwitansi: ${v.link}` }),
    credit_cancelled: (v) => ({ subject: `Pengajuan ${v.appNo} dibatalkan`, body: `${HI.id(v.name)}Pengajuan / akad ${v.appNo} dibatalkan. ${v.reason ?? ''}\n\nInfo: ${v.link}` }),
    installment_reminder: (v) => ({ subject: `Pengingat angsuran ${v.contractNo}`, body: `${HI.id(v.name)}Pengingat: angsuran ke-${v.seq} sebesar ${v.amount} jatuh tempo ${v.due}${v.today ? ' (HARI INI)' : ''}.\nBayar: ${v.link}` }),
    installment_overdue: (v) => ({ subject: `Angsuran ${v.contractNo} terlambat`, body: `${HI.id(v.name)}Angsuran ke-${v.seq} sebesar ${v.amount} (jatuh tempo ${v.due}) belum kami terima. Mohon segera dibayar. Bila sedang mengalami kesulitan, silakan hubungi cabang — kami siap mencari jalan keluar bersama.\n\nBayar: ${v.link}` }),
    refund_paid: (v) => ({ subject: `Pengembalian dana ${v.refundNo}`, body: `${HI.id(v.name)}Pengembalian dana ${v.amount} (${v.refundNo}) untuk ${v.ref} telah kami proses ${v.method}.\n\nInfo: ${v.link}` }),
  },
  ms: {
    order_created: (v) => ({ subject: `Pesanan ${v.orderNo} — menunggu bayaran`, body: `${HI.ms(v.name)}Terima kasih, pesanan ${v.orderNo} telah kami terima.\n\n${payText('ms', v)}\nJumlah: ${v.total}\nBayar sebelum: ${v.expires}\n\nJejak pesanan: ${v.link}` }),
    payment_received: (v) => ({ subject: `Bayaran ${v.paymentNo} diterima`, body: `${HI.ms(v.name)}Bayaran ${v.amount} untuk ${purposeOf('ms', v)} telah kami terima (${v.paymentNo}).${extraLine('ms', v)}\n\nResit & status: ${v.link}` }),
    shipment_scheduled: (v) => ({ subject: `Jadual penghantaran ${v.ref}`, body: `${HI.ms(v.name)}Barang ${v.items} dijadualkan dihantar oleh armada Masri-M pada ${v.date} (${v.slot}). Pastikan ada penerima di alamat.\n\nJejak: ${v.link}` }),
    shipment_in_transit: (v) => ({ subject: `Pesanan ${v.ref} dalam penghantaran`, body: `${HI.ms(v.name)}Barang ${v.items} sedang dihantar oleh ${v.carrier}${v.trackingNo ? ` dengan nombor penjejakan ${v.trackingNo}` : ''}.\n\nJejak: ${v.link}` }),
    pickup_ready: (v) => ({ subject: `Barang sedia diambil — ${v.ref}`, body: `${HI.ms(v.name)}Barang ${v.items} sedia untuk diambil di ${v.location}.\nKOD PENGAMBILAN: *${v.code}* (sah sehingga ${v.expires}).\nBawa kad pengenalan asal & tunjukkan kod ini kepada petugas. Jangan kongsi kod dengan orang lain.\n\nJejak: ${v.link}` }),
    shipment_delivered: (v) => ({ subject: `Barang ${v.ref} telah diterima`, body: `${HI.ms(v.name)}Barang ${v.items} telah diterima oleh ${v.receiver}. Semoga bermanfaat dan diberkati.${extraLine('ms', v)}\n\nJika ada masalah, hubungi kami: ${v.link}` }),
    credit_submitted: (v) => ({ subject: `Permohonan ${v.appNo} diterima`, body: `${HI.ms(v.name)}Permohonan pembiayaan Murabahah ${v.appNo} untuk ${v.product} telah kami terima. Pegawai kami akan menghubungi anda untuk pengesahan.\n\nSemak status: ${v.link}` }),
    dp_due: (v) => ({ subject: `Akad ${v.contractNo} — bayar wang pendahuluan`, body: `${HI.ms(v.name)}Akad Murabahah ${v.contractNo} telah ditandatangani.\nWang pendahuluan + kos penghantaran yang perlu dibayar: ${v.amount}.\n${dpText('ms', v)}${v.expires ? `\nBayar sebelum: ${v.expires}` : ''}\nAkad berkuat kuasa dan barang disediakan selepas wang pendahuluan diterima.\n\nButiran: ${v.link}` }),
    promo: (v) => ({ subject: String(v.subject ?? 'Promosi Masri-M'), body: `${HI.ms(v.name)}${v.body}${v.link ? `\n\n${v.link}` : ''}\n\nTidak mahu menerima promosi? Balas BERHENTI atau ubah di Akaun Saya.` }),
    credit_approved: (v) => ({ subject: `Permohonan ${v.appNo} diluluskan`, body: `${HI.ms(v.name)}Alhamdulillah, permohonan ${v.appNo} (${v.product}) DILULUSKAN.\nHarga jualan Murabahah ${v.salePrice}, ansuran tetap ${v.monthly} × ${v.tenor} bulan, wang pendahuluan ${v.dp}.\nSila hadir ke ${v.branch} untuk akad sebelum ${v.validUntil}.\n\nButiran: ${v.link}` }),
    credit_rejected: (v) => ({ subject: `Keputusan permohonan ${v.appNo}`, body: `${HI.ms(v.name)}Harap maaf, permohonan ${v.appNo} belum dapat diluluskan buat masa ini. Anda masih boleh membeli secara tunai atau memohon semula kemudian.\n\nMaklumat: ${v.link}` }),
    credit_active: (v) => ({ subject: `Pembiayaan ${v.contractNo} aktif`, body: `${HI.ms(v.name)}Barang telah anda terima dan pembiayaan ${v.contractNo} kini aktif.\nAnsuran pertama ${v.monthly} matang pada ${v.firstDue}. Bayar dari Akaun Saya / halaman status atau di kaunter cawangan.\n\nJadual ansuran: ${v.link}` }),
    credit_paid_off: (v) => ({ subject: `Pembiayaan ${v.contractNo} SELESAI`, body: `${HI.ms(v.name)}Alhamdulillah, pembiayaan ${v.contractNo} telah SELESAI dibayar. Terima kasih atas amanah anda. Barakallahu fiikum.\n\nResit: ${v.link}` }),
    credit_cancelled: (v) => ({ subject: `Permohonan ${v.appNo} dibatalkan`, body: `${HI.ms(v.name)}Permohonan / akad ${v.appNo} telah dibatalkan. ${v.reason ?? ''}\n\nMaklumat: ${v.link}` }),
    installment_reminder: (v) => ({ subject: `Peringatan ansuran ${v.contractNo}`, body: `${HI.ms(v.name)}Peringatan: ansuran ke-${v.seq} sebanyak ${v.amount} matang pada ${v.due}${v.today ? ' (HARI INI)' : ''}.\nBayar: ${v.link}` }),
    installment_overdue: (v) => ({ subject: `Ansuran ${v.contractNo} lewat`, body: `${HI.ms(v.name)}Ansuran ke-${v.seq} sebanyak ${v.amount} (matang ${v.due}) belum kami terima. Sila jelaskan segera. Jika anda menghadapi kesukaran, hubungi cawangan — kami sedia mencari jalan penyelesaian bersama.\n\nBayar: ${v.link}` }),
    refund_paid: (v) => ({ subject: `Bayaran balik ${v.refundNo}`, body: `${HI.ms(v.name)}Bayaran balik ${v.amount} (${v.refundNo}) untuk ${v.ref} telah kami proses ${v.method}.\n\nMaklumat: ${v.link}` }),
  },
  en: {
    order_created: (v) => ({ subject: `Order ${v.orderNo} — awaiting payment`, body: `${HI.en(v.name)}Thank you, we have received order ${v.orderNo}.\n\n${payText('en', v)}\nTotal: ${v.total}\nPay before: ${v.expires}\n\nTrack your order: ${v.link}` }),
    payment_received: (v) => ({ subject: `Payment ${v.paymentNo} received`, body: `${HI.en(v.name)}We have received your payment of ${v.amount} for ${purposeOf('en', v)} (${v.paymentNo}).${extraLine('en', v)}\n\nReceipt & status: ${v.link}` }),
    shipment_scheduled: (v) => ({ subject: `Delivery schedule ${v.ref}`, body: `${HI.en(v.name)}Your ${v.items} is scheduled for delivery by the Masri-M fleet on ${v.date} (${v.slot}). Please make sure someone is at the address.\n\nTrack: ${v.link}` }),
    shipment_in_transit: (v) => ({ subject: `Order ${v.ref} is on its way`, body: `${HI.en(v.name)}Your ${v.items} is being delivered by ${v.carrier}${v.trackingNo ? ` (tracking no. ${v.trackingNo})` : ''}.\n\nTrack: ${v.link}` }),
    pickup_ready: (v) => ({ subject: `Ready for collection — ${v.ref}`, body: `${HI.en(v.name)}Your ${v.items} is ready for collection at ${v.location}.\nCOLLECTION CODE: *${v.code}* (valid until ${v.expires}).\nBring your original ID and show this code to our staff. Do not share the code with anyone.\n\nTrack: ${v.link}` }),
    shipment_delivered: (v) => ({ subject: `${v.ref} delivered`, body: `${HI.en(v.name)}Your ${v.items} has been received by ${v.receiver}. May it bring you benefit and barakah.${extraLine('en', v)}\n\nIf anything is wrong, contact us: ${v.link}` }),
    credit_submitted: (v) => ({ subject: `Application ${v.appNo} received`, body: `${HI.en(v.name)}We have received your Murabahah financing application ${v.appNo} for ${v.product}. Our officer will contact you shortly for verification.\n\nCheck status: ${v.link}` }),
    dp_due: (v) => ({ subject: `Contract ${v.contractNo} — down payment due`, body: `${HI.en(v.name)}Murabahah contract ${v.contractNo} has been signed.\nDown payment + delivery fee due: ${v.amount}.\n${dpText('en', v)}${v.expires ? `\nPay before: ${v.expires}` : ''}\nThe contract takes effect and your goods are prepared once the down payment is received.\n\nDetails: ${v.link}` }),
    promo: (v) => ({ subject: String(v.subject ?? 'Masri-M offer'), body: `${HI.en(v.name)}${v.body}${v.link ? `\n\n${v.link}` : ''}\n\nDon't want offers? Reply STOP or change it in My Account.` }),
    credit_approved: (v) => ({ subject: `Application ${v.appNo} approved`, body: `${HI.en(v.name)}Alhamdulillah, application ${v.appNo} (${v.product}) has been APPROVED.\nMurabahah sale price ${v.salePrice}, fixed instalment ${v.monthly} × ${v.tenor} months, down payment ${v.dp}.\nPlease visit ${v.branch} to sign the contract before ${v.validUntil}.\n\nDetails: ${v.link}` }),
    credit_rejected: (v) => ({ subject: `Application ${v.appNo} result`, body: `${HI.en(v.name)}We are sorry, application ${v.appNo} cannot be approved at this time. You can still buy with cash or apply again later.\n\nInfo: ${v.link}` }),
    credit_active: (v) => ({ subject: `Financing ${v.contractNo} is active`, body: `${HI.en(v.name)}You have received the goods and financing ${v.contractNo} is now active.\nYour first instalment of ${v.monthly} is due on ${v.firstDue}. Pay from My Account / the status page or at the branch counter.\n\nInstalment schedule: ${v.link}` }),
    credit_paid_off: (v) => ({ subject: `Financing ${v.contractNo} PAID OFF`, body: `${HI.en(v.name)}Alhamdulillah, financing ${v.contractNo} is fully PAID OFF. Thank you for your trust. Barakallahu fiikum.\n\nReceipt: ${v.link}` }),
    credit_cancelled: (v) => ({ subject: `Application ${v.appNo} cancelled`, body: `${HI.en(v.name)}Application / contract ${v.appNo} has been cancelled. ${v.reason ?? ''}\n\nInfo: ${v.link}` }),
    installment_reminder: (v) => ({ subject: `Instalment reminder ${v.contractNo}`, body: `${HI.en(v.name)}Reminder: instalment #${v.seq} of ${v.amount} is due on ${v.due}${v.today ? ' (TODAY)' : ''}.\nPay: ${v.link}` }),
    installment_overdue: (v) => ({ subject: `Instalment ${v.contractNo} overdue`, body: `${HI.en(v.name)}We have not yet received instalment #${v.seq} of ${v.amount} (due ${v.due}). Please pay as soon as possible. If you are facing difficulties, contact your branch — we are ready to find a solution together.\n\nPay: ${v.link}` }),
    refund_paid: (v) => ({ subject: `Refund ${v.refundNo}`, body: `${HI.en(v.name)}Your refund of ${v.amount} (${v.refundNo}) for ${v.ref} has been processed ${v.method}.\n\nInfo: ${v.link}` }),
  },
};

export function render(t: Template, v: Vars, lang: Lang = 'id') {
  const r = (TEMPLATES[lang] ?? TEMPLATES.id)[t](v);
  return { subject: r.subject, body: r.body + SIGN[lang] };
}

/** Bahasa pesan: pilihan nasabah, selain itu mengikuti negara nomor HP (MY/BN → Melayu). */
export function langFor(phone: string | null | undefined, preferred?: string | null): Lang {
  if (preferred === 'id' || preferred === 'ms' || preferred === 'en') return preferred;
  const c = phone ? countryOfPhone(e164(phone, 'ID')) : null;
  return c === 'MY' || c === 'BN' ? 'ms' : 'id';
}

/** Antrekan pesan ke nasabah (WhatsApp dan/atau email). Aman dipanggil di dalam transaksi. */
export async function notifyCustomer(tx: Db, to: { phone?: string | null; email?: string | null; lang?: string | null }, t: Template, v: Vars, ref: { type: string; id: string; dedupe?: string }) {
  const { subject, body } = render(t, v, langFor(to.phone, to.lang));
  const rows: (typeof notificationOutbox.$inferInsert)[] = [];
  if (to.phone) rows.push({ channel: 'whatsapp', recipient: to.phone, template: t, subject, body, refType: ref.type, refId: ref.id, dedupeKey: ref.dedupe ? `${ref.dedupe}:wa` : null });
  if (to.email) rows.push({ channel: 'email', recipient: to.email, template: t, subject, body, refType: ref.type, refId: ref.id, dedupeKey: ref.dedupe ? `${ref.dedupe}:email` : null });
  if (rows.length) await tx.insert(notificationOutbox).values(rows).onConflictDoNothing();
}

export async function customerContact(tx: Db, customerId: string) {
  const [c] = await tx.select({ name: customers.fullName, phone: customers.phone, email: customers.email, lang: customers.lang }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return c ?? { name: 'Nasabah', phone: null, email: null, lang: null };
}

export const links = {
  order: (orderNo: string, phone?: string | null) => `${webUrl()}/?lacak=${encodeURIComponent(orderNo)}${phone ? `&hp=${encodeURIComponent(phone)}` : ''}`,
  credit: (appNo: string) => `${webUrl()}/?pengajuan=${encodeURIComponent(appNo)}`,
};
export const money = fmt;
export const when = dt;
/** Variabel cara bayar untuk template (teks disusun sesuai bahasa penerima). */
export const payVars = (p: { method: string; bank?: string | null; vaNumber?: string | null; payUrl?: string | null }) =>
  ({ payMethod: p.method, payBank: p.bank ?? null, payVa: p.vaNumber ?? null, payUrl: p.payUrl ?? null });

// ---------------------------------------------------------------------------
// Pengiriman (worker)
// ---------------------------------------------------------------------------
interface Sender { name: string; send(to: string, subject: string, body: string): Promise<void> }

const normPhone = (p: string) => e164(p, 'ID');

class LogSender implements Sender {
  constructor(public name: string) {}
  async send(to: string, subject: string, body: string) { console.log(`[notif:${this.name}] → ${to} | ${subject}\n${body.split('\n').slice(0, 3).join(' / ')}…`); }
}

class FonnteSender implements Sender {
  name = 'fonnte';
  constructor(private token: string, private base = process.env.FONNTE_BASE_URL || 'https://api.fonnte.com') {}
  async send(to: string, _subject: string, body: string) {
    const r = await fetch(`${this.base}/send`, { method: 'POST', headers: { authorization: this.token }, body: new URLSearchParams({ target: normPhone(to), message: body, countryCode: '0' }) });
    const j = (await r.json().catch(() => ({}))) as { status?: boolean; reason?: string };
    if (!r.ok || j.status !== true) throw new Error(`Fonnte: ${j.reason ?? `HTTP ${r.status}`}`);
  }
}

class SmtpSender implements Sender {
  name = 'smtp';
  private t: Transporter;
  constructor(url: string) { this.t = nodemailer.createTransport(url); }
  async send(to: string, subject: string, body: string) {
    await this.t.sendMail({ from: process.env.MAIL_FROM || 'Masri-M Syariah <no-reply@masri-m.local>', to, subject, text: body });
  }
}

let senders: { whatsapp: Sender; email: Sender } | null = null;
function getSenders() {
  if (senders) return senders;
  const wa = (process.env.WHATSAPP_PROVIDER ?? 'log').toLowerCase();
  senders = {
    whatsapp: wa === 'fonnte' && process.env.FONNTE_TOKEN ? new FonnteSender(process.env.FONNTE_TOKEN) : new LogSender('whatsapp-log'),
    email: process.env.SMTP_URL ? new SmtpSender(process.env.SMTP_URL) : new LogSender('email-log'),
  };
  return senders;
}
/** Kirim langsung tanpa outbox (dipakai skrip uji integrasi). */
export const sendDirect = (channel: 'whatsapp' | 'email', to: string, subject: string, body: string) => getSenders()[channel].send(to, subject, body);
export const notifyProviders = () => ({ whatsapp: getSenders().whatsapp.name, email: getSenders().email.name });

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/** Kirim pesan yang menunggu. Dipanggil berkala; aman dijalankan paralel (SKIP LOCKED). */
export async function processOutbox(limit = 30) {
  const [waOn, mailOn] = await Promise.all([getConfig<boolean>('notify.whatsapp_enabled').catch(() => true), getConfig<boolean>('notify.email_enabled').catch(() => true)]);
  let sent = 0, failed = 0;
  await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: number; channel: string; recipient: string; subject: string | null; body: string; attempts: number }>(sql`
      select id, channel, recipient, subject, body, attempts from notification_outbox
      where status = 'pending' and next_attempt_at <= now() order by id limit ${limit} for update skip locked`);
    for (const m of rows) {
      const enabled = m.channel === 'whatsapp' ? waOn !== false : mailOn !== false;
      if (!enabled) { await tx.update(notificationOutbox).set({ status: 'skipped', lastError: 'Kanal dinonaktifkan di Parameter Bisnis' }).where(eq(notificationOutbox.id, m.id)); continue; }
      const s = m.channel === 'whatsapp' ? getSenders().whatsapp : getSenders().email;
      try {
        await s.send(m.recipient, m.subject ?? '', m.body);
        await tx.update(notificationOutbox).set({ status: 'sent', sentAt: new Date(), provider: s.name, attempts: m.attempts + 1, lastError: null }).where(eq(notificationOutbox.id, m.id));
        sent++;
      } catch (e) {
        const attempts = m.attempts + 1;
        const giveUp = attempts >= BACKOFF_MIN.length;
        await tx.update(notificationOutbox).set({ attempts, provider: s.name, lastError: String((e as Error).message).slice(0, 500), status: giveUp ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)] * 60_000) }).where(eq(notificationOutbox.id, m.id));
        failed++;
      }
    }
  });
  return { sent, failed };
}

/** Pengingat angsuran: H-n, hari H, dan H+1 (sekali per angsuran per jenis, berkat dedupe key). */
export async function queueInstallmentReminders() {
  const days = Number(await getConfig<number>('notify.reminder_days_before').catch(() => 3)) || 3;
  const { rows } = await db.execute<{ inst_id: string; seq: number; due_date: string; amount: number; paid: number; contract_no: string; app_no: string; currency: string; customer_id: string; kind: string }>(sql`
    with t as (select (now() at time zone 'Asia/Jakarta')::date d)
    select i.id inst_id, i.seq, i.due_date, i.amount::float amount, i.paid_amount::float paid, a.contract_no, a.app_no, a.currency, a.customer_id,
      case when i.due_date::date = t.d + ${days}::int then 'before' when i.due_date::date = t.d then 'today' else 'overdue' end kind
    from installments i join credit_applications a on a.id = i.application_id, t
    where a.status = 'active' and i.status <> 'paid'
      and (i.due_date::date = t.d + ${days}::int or i.due_date::date = t.d or i.due_date::date = t.d - 1)`);
  let n = 0;
  for (const r of rows) {
    const c = await customerContact(db, r.customer_id);
    const v = { name: c.name, seq: r.seq, amount: fmt(r.amount - r.paid, r.currency), due: r.due_date, contractNo: r.contract_no ?? r.app_no, link: links.credit(r.app_no), today: r.kind === 'today' ? 1 : null };
    await notifyCustomer(db, c, r.kind === 'overdue' ? 'installment_overdue' : 'installment_reminder', v, { type: 'installment', id: r.inst_id, dedupe: `rem:${r.inst_id}:${r.kind}` });
    n++;
  }
  return n;
}

export async function outboxStats() {
  const rows = await db.select({ status: notificationOutbox.status, channel: notificationOutbox.channel, n: sql<number>`count(*)::int` }).from(notificationOutbox)
    .where(sql`${notificationOutbox.createdAt} > now() - interval '7 days'`).groupBy(notificationOutbox.status, notificationOutbox.channel);
  const recent = await db.select().from(notificationOutbox).orderBy(sql`${notificationOutbox.id} desc`).limit(50);
  return { providers: notifyProviders(), last7d: rows, recent };
}

/** Kirim ulang pesan gagal (Super Admin). */
export async function retryFailed(ids: number[]) {
  if (!ids.length) return 0;
  const r = await db.update(notificationOutbox).set({ status: 'pending', attempts: 0, nextAttemptAt: new Date() })
    .where(and(inArray(notificationOutbox.id, ids), inArray(notificationOutbox.status, ['failed', 'skipped']))).returning({ id: notificationOutbox.id });
  return r.length;
}
