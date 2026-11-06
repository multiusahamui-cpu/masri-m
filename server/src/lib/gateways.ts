import crypto from 'node:crypto';
import { HttpError } from './http.js';

/**
 * Gerbang pembayaran. Pilih lewat env PAYMENT_PROVIDER:
 *   mock     — pengembangan lokal (default), dibayar lewat tombol "Simulasi pembayaran"
 *   midtrans — Midtrans Core API (VA BCA/BNI/BRI/Permata, QRIS) + webhook bertanda tangan SHA512
 * Provider lain (Xendit, Bayarind) cukup mengimplementasikan interface yang sama.
 */
export type VaBank = 'bca' | 'bni' | 'bri' | 'permata';
export const VA_BANKS: Record<VaBank, string> = { bca: 'BCA', bni: 'BNI', bri: 'BRI', permata: 'Permata' };

export type PayMethod = 'va' | 'qris' | 'fpx';
export interface ChargeInput { paymentNo: string; amount: number; method: PayMethod; bank?: VaBank | null; customerName: string; customerPhone?: string | null; customerEmail?: string | null; expiresAt?: Date | null; returnUrl?: string | null; currency?: string }
export interface ChargeResult { vaNumber: string | null; bank: string | null; qrString: string | null; qrUrl: string | null; payUrl?: string | null; gatewayRef: string; expiresAt: Date }
export type GatewayStatus = 'paid' | 'pending' | 'expired' | 'failed';
export interface GatewayNotification { paymentNo: string; status: GatewayStatus; amount: number; gatewayRef: string; raw: unknown }

export interface PaymentGateway {
  name: string;
  /** Metode yang didukung gateway ini (ditampilkan di checkout). */
  methods: PayMethod[];
  createCharge(p: ChargeInput): Promise<ChargeResult>;
  /** Validasi & terjemahkan notifikasi webhook. Melempar 401 bila tanda tangan tidak valid. */
  parseNotification?(body: unknown): Promise<GatewayNotification>;
}

const defaultExpiry = (p: ChargeInput) => p.expiresAt ?? new Date(Date.now() + 24 * 3600_000);

class MockGateway implements PaymentGateway {
  name = 'mock';
  constructor(public methods: PayMethod[] = ['va', 'qris']) {}
  async createCharge(p: ChargeInput): Promise<ChargeResult> {
    if (p.method === 'fpx') return { vaNumber: null, bank: null, qrString: null, qrUrl: null, payUrl: null, gatewayRef: `MOCK-${p.paymentNo}`, expiresAt: defaultExpiry(p) };
    const digits = crypto.randomInt(10 ** 9, 10 ** 10 - 1).toString();
    const bank = p.method === 'va' ? (p.bank ?? 'bca') : null;
    return {
      vaNumber: p.method === 'va' ? `8808${digits}` : null, bank,
      qrString: p.method === 'qris' ? `00020101021226610016ID.CO.MASRIM.WWW0118MOCK${p.paymentNo}5204599953033605802ID5909MASRI-M6007JAKARTA6304ABCD` : null,
      qrUrl: null, gatewayRef: `MOCK-${p.paymentNo}`, expiresAt: defaultExpiry(p),
    };
  }
}

/** Midtrans Core API — https://docs.midtrans.com (charge: POST /v2/charge, status: GET /v2/{order_id}/status). */
class MidtransGateway implements PaymentGateway {
  name = 'midtrans';
  methods: PayMethod[] = ['va', 'qris'];
  constructor(private serverKey: string, private baseUrl: string, private verifyStatus: boolean) {}
  private headers() {
    return { accept: 'application/json', 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}` };
  }
  private async call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const r = await fetch(`${this.baseUrl}${path}`, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    const code = Number(j.status_code ?? r.status);
    if (!r.ok || code >= 300) {
      console.error(`[midtrans] ${method} ${path} -> ${r.status} ${j.status_code ?? ''} ${j.status_message ?? ''}`);
      throw new HttpError(502, `Gagal membuat tagihan di Midtrans: ${j.status_message ?? `HTTP ${r.status}`}`);
    }
    return j;
  }
  async createCharge(p: ChargeInput): Promise<ChargeResult> {
    const exp = defaultExpiry(p);
    const minutes = Math.max(15, Math.floor((exp.getTime() - Date.now()) / 60_000));
    const orderTime = new Date(Date.now() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) + ' +0700'; // WIB
    const base = {
      transaction_details: { order_id: p.paymentNo, gross_amount: Math.round(p.amount) },
      customer_details: { first_name: p.customerName.slice(0, 50), phone: p.customerPhone ?? undefined },
      custom_expiry: { order_time: orderTime, expiry_duration: minutes, unit: 'minute' },
    };
    let body: Record<string, unknown>;
    if (p.method === 'qris') body = { ...base, payment_type: 'qris' };
    else if ((p.bank ?? 'bca') === 'permata') body = { ...base, payment_type: 'bank_transfer', bank_transfer: { bank: 'permata' } };
    else body = { ...base, payment_type: 'bank_transfer', bank_transfer: { bank: p.bank ?? 'bca' } };
    const j = await this.call('POST', '/v2/charge', body);
    const va = j.permata_va_number ?? j.va_numbers?.[0]?.va_number ?? null;
    const qrAction = (j.actions as { name: string; url: string }[] | undefined)?.find((a) => a.name === 'generate-qr-code');
    return {
      vaNumber: p.method === 'va' ? va : null, bank: p.method === 'va' ? (p.bank ?? 'bca') : null,
      qrString: j.qr_string ?? null, qrUrl: qrAction?.url ?? null, gatewayRef: String(j.transaction_id ?? p.paymentNo),
      expiresAt: j.expiry_time ? new Date(String(j.expiry_time).replace(' ', 'T') + '+07:00') : exp,
    };
  }
  async parseNotification(raw: unknown): Promise<GatewayNotification> {
    const b = raw as Record<string, string>;
    if (!b?.order_id || !b.status_code || !b.gross_amount || !b.signature_key) throw new HttpError(400, 'Notifikasi tidak lengkap');
    const expected = crypto.createHash('sha512').update(`${b.order_id}${b.status_code}${b.gross_amount}${this.serverKey}`).digest('hex');
    const a = Buffer.from(expected), s = Buffer.from(String(b.signature_key));
    if (a.length !== s.length || !crypto.timingSafeEqual(a, s)) throw new HttpError(401, 'Tanda tangan notifikasi tidak valid');
    // Lapis kedua: tanyakan status langsung ke Midtrans (notifikasi bisa diputar ulang)
    const st = this.verifyStatus ? await this.call('GET', `/v2/${encodeURIComponent(b.order_id)}/status`) : b;
    const ts = String(st.transaction_status), fraud = String(st.fraud_status ?? 'accept');
    const status: GatewayStatus = (ts === 'settlement' || (ts === 'capture' && fraud === 'accept')) ? 'paid'
      : ts === 'expire' ? 'expired' : ['cancel', 'deny', 'failure'].includes(ts) ? 'failed' : 'pending';
    return { paymentNo: String(b.order_id), status, amount: Number(st.gross_amount ?? b.gross_amount), gatewayRef: String(st.transaction_id ?? b.transaction_id ?? ''), raw };
  }
}

/**
 * Billplz (Malaysia) — https://www.billplz.com/api (v3). Satu tagihan (bill) → halaman bayar FPX / kartu / e-wallet.
 * Callback: POST form-urlencoded bertanda tangan X-Signature (HMAC-SHA256), lalu status dicek ulang lewat GET /api/v3/bills/:id.
 */
export class BillplzGateway implements PaymentGateway {
  name = 'billplz';
  methods: PayMethod[] = ['fpx'];
  constructor(private apiKey: string, private collectionId: string, private signatureKey: string, private baseUrl: string, private callbackUrl: string) {}
  private async call(method: 'GET' | 'POST', path: string, form?: Record<string, string>) {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method, headers: { authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`, accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok || j.error) {
      const msg = Array.isArray(j.error?.message) ? j.error.message.join(', ') : j.error?.message ?? `HTTP ${r.status}`;
      console.error(`[billplz] ${method} ${path} -> ${r.status} ${msg}`);
      throw new HttpError(502, `Gagal membuat tagihan Billplz: ${msg}`);
    }
    return j;
  }
  async createCharge(p: ChargeInput): Promise<ChargeResult> {
    const form: Record<string, string> = {
      collection_id: this.collectionId, name: p.customerName.slice(0, 255), amount: String(Math.round(p.amount * 100)), // sen
      description: `Masri-M ${p.paymentNo}`.slice(0, 200), callback_url: this.callbackUrl, reference_1_label: 'Payment No', reference_1: p.paymentNo,
    };
    if (p.customerEmail) form.email = p.customerEmail;
    if (p.customerPhone) form.mobile = `+${p.customerPhone.replace(/[^0-9]/g, '')}`;
    if (!form.email && !form.mobile) form.email = 'nasabah@masri-m.local';
    if (p.returnUrl) form.redirect_url = p.returnUrl;
    const j = await this.call('POST', '/api/v3/bills', form);
    return { vaNumber: null, bank: null, qrString: null, qrUrl: null, payUrl: String(j.url), gatewayRef: String(j.id), expiresAt: defaultExpiry(p) };
  }
  /** Tanda tangan Billplz: pasangan key+value diurutkan, digabung "|" lalu HMAC-SHA256. */
  static sign(body: Record<string, string>, key: string) {
    const src = Object.keys(body).filter((k) => k !== 'x_signature').map((k) => `${k}${body[k] ?? ''}`).sort().join('|');
    return crypto.createHmac('sha256', key).update(src).digest('hex');
  }
  async parseNotification(raw: unknown): Promise<GatewayNotification> {
    const b = raw as Record<string, string>;
    if (!b?.id || !b.x_signature) throw new HttpError(400, 'Notifikasi tidak lengkap');
    const expected = Buffer.from(BillplzGateway.sign(b, this.signatureKey)), got = Buffer.from(String(b.x_signature));
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) throw new HttpError(401, 'Tanda tangan notifikasi tidak valid');
    const bill = await this.call('GET', `/api/v3/bills/${encodeURIComponent(b.id)}`);
    const paid = bill.paid === true || bill.state === 'paid';
    return { paymentNo: String(bill.reference_1 ?? ''), status: paid ? 'paid' : bill.state === 'deleted' ? 'failed' : 'pending', amount: Number(bill.paid_amount ?? bill.amount ?? 0) / 100, gatewayRef: String(bill.id), raw };
  }
}

/** Negara tanpa gateway online (mis. Brunei tahap awal): bayar di cabang / transfer bank diverifikasi kasir. */
class NoGateway implements PaymentGateway {
  name = 'none';
  methods: PayMethod[] = [];
  async createCharge(): Promise<ChargeResult> { throw new HttpError(400, 'Pembayaran online belum tersedia di negara ini — pilih bayar di cabang / transfer bank'); }
}

const gws = new Map<string, PaymentGateway>();
/** Gateway per negara: ID → PAYMENT_PROVIDER, MY → PAYMENT_PROVIDER_MY, BN → PAYMENT_PROVIDER_BN (default: tanpa gateway). */
export function getPaymentGateway(country = 'ID'): PaymentGateway {
  const hit = gws.get(country);
  if (hit) return hit;
  let g: PaymentGateway;
  if (country === 'MY') {
    const provider = (process.env.PAYMENT_PROVIDER_MY ?? 'mock').toLowerCase();
    if (provider === 'billplz') {
      const key = process.env.BILLPLZ_API_KEY, col = process.env.BILLPLZ_COLLECTION_ID, sig = process.env.BILLPLZ_X_SIGNATURE;
      if (!key || !col || !sig) throw new Error('PAYMENT_PROVIDER_MY=billplz tetapi BILLPLZ_API_KEY / BILLPLZ_COLLECTION_ID / BILLPLZ_X_SIGNATURE kosong');
      const prod = process.env.BILLPLZ_IS_PRODUCTION === 'true';
      const base = process.env.BILLPLZ_BASE_URL || (prod ? 'https://www.billplz.com' : 'https://www.billplz-sandbox.com');
      const api = (process.env.API_PUBLIC_URL || process.env.PUBLIC_WEB_URL || 'http://localhost:4000').replace(/\/$/, '');
      g = new BillplzGateway(key, col, sig, base.replace(/\/$/, ''), `${api}/api/webhooks/billplz`);
    } else g = provider === 'none' ? new NoGateway() : new MockGateway(['fpx']);
  } else if (country === 'BN') {
    g = (process.env.PAYMENT_PROVIDER_BN ?? 'none').toLowerCase() === 'mock' ? new MockGateway(['fpx']) : new NoGateway();
  } else {
    const provider = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
    if (provider === 'midtrans') {
      const key = process.env.MIDTRANS_SERVER_KEY;
      if (!key) throw new Error('PAYMENT_PROVIDER=midtrans tetapi MIDTRANS_SERVER_KEY kosong');
      const prod = process.env.MIDTRANS_IS_PRODUCTION === 'true';
      const base = process.env.MIDTRANS_BASE_URL || (prod ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
      g = new MidtransGateway(key, base.replace(/\/$/, ''), process.env.MIDTRANS_VERIFY_STATUS !== 'false');
    } else g = new MockGateway();
  }
  gws.set(country, g);
  return g;
}
export const paymentProviderName = (country = 'ID') => getPaymentGateway(country).name;
