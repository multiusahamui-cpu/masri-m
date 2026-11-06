import { HttpError } from './http.js';

/**
 * Abstraksi kurir mitra. Pilih lewat env SHIPPING_PROVIDER:
 *   mock     — tarif simulasi (default, pengembangan)
 *   biteship — agregator Biteship (JNE, J&T, TIKI, SiCepat, AnterAja, Pos, Ninja, Lalamove, Deliveree): ongkir, booking resi, webhook status
 * EasyParcel (Malaysia) dll. cukup mengimplementasikan interface yang sama.
 */
export interface Place { city: string; postalCode?: string | null }
export interface QuoteInput { origin: Place; dest: Place; weightKg: number; isBulky: boolean; couriers: string[]; value: number; itemName: string }
export interface CourierQuote { courierCode: string; courierName: string; service: string; serviceName: string; etd: string; price: number }
export interface Contact { name: string; phone: string; address: string; city: string; postalCode?: string | null }
export interface BookInput { courierCode: string; service: string; shipmentNo: string; origin: Contact; dest: Contact; weightKg: number; value: number; itemsSummary: string; note?: string | null }
export interface BookResult { trackingNo: string | null; externalRef: string | null; price?: number | null; status?: string | null }
/** Status normal dari kurir: in_transit (diproses/diantar), delivered, failed (batal/ditolak/retur). */
export interface CourierUpdate { externalRef: string; trackingNo?: string | null; status: 'in_transit' | 'delivered' | 'failed'; courierStatus: string; note?: string | null }

export interface CourierProvider {
  name: string;
  quote(input: QuoteInput): Promise<CourierQuote[]>;
  book(input: BookInput): Promise<BookResult>;
  /** Ambil status terbaru langsung dari provider (dipakai saat webhook masuk). */
  fetchUpdate?(externalRef: string): Promise<CourierUpdate>;
}

export const COURIER_NAMES: Record<string, string> = {
  jne: 'JNE', jnt: 'J&T Express', tiki: 'TIKI', sicepat: 'SiCepat', anteraja: 'AnterAja', pos: 'Pos Indonesia',
  ninja: 'Ninja Xpress', lalamove: 'Lalamove', deliveree: 'Deliveree',
  poslaju: 'Pos Laju', citylink: 'City-Link Express', ninjavan: 'Ninja Van', dhl: 'DHL eCommerce', gdex: 'GDEX', skynet: 'SkyNet',
};

// Tarif simulasi per kg (dalam kota, antar kota) — hanya untuk pengembangan.
const MOCK: Record<string, { reg: [number, number]; express?: [number, number]; cargo?: [number, number]; prefix: string }> = {
  jne: { reg: [9000, 22000], express: [18000, 38000], cargo: [6000, 12000], prefix: 'JNE' },
  jnt: { reg: [8500, 21000], express: [17000, 35000], cargo: [5500, 11500], prefix: 'JT' },
  tiki: { reg: [9500, 23000], express: [19000, 40000], prefix: 'TIKI' },
  sicepat: { reg: [8000, 20000], express: [16000, 33000], cargo: [5000, 11000], prefix: 'SCP' },
  anteraja: { reg: [8000, 20500], express: [16500, 34000], prefix: 'AA' },
  pos: { reg: [7500, 19000], cargo: [5000, 10000], prefix: 'POS' },
  // Malaysia (MYR)
  poslaju: { reg: [6, 9], express: [10, 15], cargo: [4, 7], prefix: 'ER' },
  citylink: { reg: [6.5, 9.5], cargo: [4.5, 7.5], prefix: 'CL' },
  ninjavan: { reg: [5.5, 8.5], prefix: 'NVMY' },
  dhl: { reg: [6, 9], express: [11, 16], prefix: 'DHLMY' },
};

/** Kota dianggap sama bila salah satu memuat yang lain (mis. "Jakarta" vs "Jakarta Timur"). */
export function sameArea(a: string, b: string) {
  const n = (x: string) => x.toLowerCase().replace(/\b(kota|kabupaten|kab\.?)\s+/g, '').replace(/\s+/g, ' ').trim();
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

export class MockCourierProvider implements CourierProvider {
  name = 'mock';
  async quote(i: QuoteInput): Promise<CourierQuote[]> {
    const w = Math.max(1, Math.ceil(i.weightKg));
    const local = sameArea(i.origin.city, i.dest.city);
    const out: CourierQuote[] = [];
    for (const code of i.couriers) {
      const t = MOCK[code];
      if (!t) continue;
      const pick = (r: [number, number]) => r[local ? 0 : 1] * w;
      const q = (service: string, etd: string, price: number) => out.push({ courierCode: code, courierName: COURIER_NAMES[code] ?? code, service, serviceName: service, etd, price });
      if (i.isBulky) { if (t.cargo) q('Kargo', local ? '1-2 hari' : '3-6 hari', Math.max(pick(t.cargo), t.reg[0] > 100 ? 60000 : 40)); continue; }
      q('Reguler', local ? '1 hari' : '2-4 hari', pick(t.reg));
      if (t.express) q('Express', local ? 'Hari ini' : '1-2 hari', pick(t.express));
    }
    return out.sort((a, b) => a.price - b.price);
  }
  async book(i: BookInput): Promise<BookResult> {
    const p = MOCK[i.courierCode]?.prefix ?? i.courierCode.toUpperCase();
    return { trackingNo: `${p}${Date.now().toString().slice(-10)}`, externalRef: null };
  }
}

/** Biteship — https://biteship.com/en/docs/api (rates: POST /v1/rates/couriers, order: POST /v1/orders, GET /v1/orders/:id). */
export class BiteshipProvider implements CourierProvider {
  name = 'biteship';
  constructor(private apiKey: string, private baseUrl: string) {}
  private async call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const r = await fetch(`${this.baseUrl}${path}`, { method, headers: { authorization: this.apiKey, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok || j.success === false) {
      console.error(`[biteship] ${method} ${path} -> ${r.status} ${j.error ?? j.message ?? ''}`);
      throw new HttpError(502, `Kurir mitra (Biteship): ${j.error ?? j.message ?? `HTTP ${r.status}`}`);
    }
    return j;
  }
  async quote(i: QuoteInput): Promise<CourierQuote[]> {
    if (!i.origin.postalCode || !i.dest.postalCode || !i.couriers.length) return []; // Biteship butuh kode pos asal & tujuan
    const grams = Math.max(1000, Math.round(i.weightKg * 1000));
    const j = await this.call('POST', '/v1/rates/couriers', {
      origin_postal_code: Number(i.origin.postalCode), destination_postal_code: Number(i.dest.postalCode), couriers: i.couriers.join(','),
      items: [{ name: i.itemName.slice(0, 100), value: Math.round(i.value), weight: grams, quantity: 1 }],
    });
    const list = (j.pricing ?? []) as Record<string, any>[];
    return list
      .filter((p) => !i.isBulky || /cargo|kargo|trucking|jtr|gokil/i.test(`${p.courier_service_code} ${p.courier_service_name}`) || ['deliveree', 'lalamove'].includes(p.courier_code))
      .map((p) => ({
        courierCode: String(p.courier_code), courierName: String(p.courier_name ?? COURIER_NAMES[p.courier_code] ?? p.courier_code),
        service: String(p.courier_service_code), serviceName: String(p.courier_service_name ?? p.courier_service_code),
        etd: p.shipment_duration_range ? `${p.shipment_duration_range} ${p.shipment_duration_unit === 'hours' ? 'jam' : 'hari'}` : String(p.duration ?? '-'),
        price: Number(p.price),
      }))
      .sort((a, b) => a.price - b.price);
  }
  async book(i: BookInput): Promise<BookResult> {
    if (!i.origin.postalCode || !i.dest.postalCode) throw new HttpError(400, 'Kode pos asal & tujuan wajib untuk kurir mitra');
    const j = await this.call('POST', '/v1/orders', {
      shipper_contact_name: i.origin.name, shipper_contact_phone: i.origin.phone, shipper_organization: 'Masri-M Syariah',
      origin_contact_name: i.origin.name, origin_contact_phone: i.origin.phone, origin_address: i.origin.address, origin_postal_code: Number(i.origin.postalCode),
      destination_contact_name: i.dest.name, destination_contact_phone: i.dest.phone, destination_address: i.dest.address, destination_postal_code: Number(i.dest.postalCode),
      courier_company: i.courierCode, courier_type: i.service, delivery_type: 'now', reference_id: i.shipmentNo, order_note: i.note ?? undefined,
      items: [{ name: i.itemsSummary.slice(0, 100), value: Math.round(i.value), weight: Math.max(1000, Math.round(i.weightKg * 1000)), quantity: 1 }],
    });
    return { trackingNo: j.courier?.waybill_id ?? null, externalRef: j.id ?? null, price: j.price ?? null, status: j.status ?? null };
  }
  async fetchUpdate(externalRef: string): Promise<CourierUpdate> {
    const j = await this.call('GET', `/v1/orders/${encodeURIComponent(externalRef)}`);
    const st = String(j.status ?? '').toLowerCase();
    const status: CourierUpdate['status'] = st === 'delivered' ? 'delivered'
      : ['cancelled', 'rejected', 'courier_not_found', 'returned', 'disposed'].includes(st) ? 'failed' : 'in_transit';
    return { externalRef, trackingNo: j.courier?.waybill_id ?? null, status, courierStatus: st, note: j.note ?? null };
  }
}

// ---------------------------------------------------------------------------
// EasyParcel (Malaysia): Pos Laju, J&T, City-Link, Ninja Van, DHL, GDEX, dll.
// ---------------------------------------------------------------------------
/** Kode negeri EasyParcel dari poskod Malaysia. */
export function myState(postcode: string | null | undefined) {
  const n = Number(String(postcode ?? '').slice(0, 5));
  if (!n) return null;
  const R: [number, number, string][] = [
    [1000, 2999, 'pls'], [5000, 9999, 'kdh'], [10000, 14999, 'png'], [15000, 18999, 'ktn'], [20000, 24999, 'trg'], [25000, 28999, 'phg'],
    [30000, 36999, 'prk'], [39000, 39999, 'phg'], [40000, 48999, 'sgr'], [49000, 49999, 'phg'], [50000, 61999, 'kul'], [62000, 62999, 'pjy'],
    [63000, 68999, 'sgr'], [69000, 69999, 'phg'], [70000, 73999, 'nsn'], [75000, 78999, 'mlk'], [79000, 86999, 'jhr'], [87000, 87999, 'lbn'],
    [88000, 91999, 'sbh'], [93000, 98999, 'srw'],
  ];
  return R.find(([a, b]) => n >= a && n <= b)?.[2] ?? null;
}
const EP_CODE = (name: string) => {
  const n = name.toLowerCase();
  return n.includes('pos') ? 'poslaju' : n.includes('j&t') || n.includes('jnt') ? 'jnt' : n.includes('city') ? 'citylink' : n.includes('ninja') ? 'ninjavan'
    : n.includes('dhl') ? 'dhl' : n.includes('gdex') ? 'gdex' : n.includes('skynet') ? 'skynet' : n.replace(/[^a-z0-9]/g, '');
};

/** EasyParcel API (individual) — https://developers.easyparcel.com : EPRateCheckingBulk, EPSubmitOrderBulk, EPPayOrderBulk, EPTrackingBulk. */
export class EasyParcelProvider implements CourierProvider {
  name = 'easyparcel';
  constructor(private apiKey: string, private baseUrl: string) {}
  private async call(action: string, bulk: Record<string, string | number>[]) {
    const form = new URLSearchParams({ api: this.apiKey });
    bulk.forEach((row, i) => Object.entries(row).forEach(([k, v]) => form.append(`bulk[${i}][${k}]`, String(v))));
    const r = await fetch(`${this.baseUrl}/?ac=${action}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok || j.api_status !== 'Success') {
      console.error(`[easyparcel] ${action} -> ${r.status} ${j.error_remark ?? ''}`);
      throw new HttpError(502, `Kurir mitra (EasyParcel): ${j.error_remark || `HTTP ${r.status}`}`);
    }
    const res0 = (j.result ?? [])[0] ?? {};
    if (res0.status && res0.status !== 'Success') throw new HttpError(502, `Kurir mitra (EasyParcel): ${res0.remarks ?? res0.status}`);
    return res0 as Record<string, any>;
  }
  async quote(i: QuoteInput): Promise<CourierQuote[]> {
    if (!i.origin.postalCode || !i.dest.postalCode) return [];
    const r = await this.call('EPRateCheckingBulk', [{
      pick_code: i.origin.postalCode, pick_state: myState(i.origin.postalCode) ?? '', pick_country: 'MY',
      send_code: i.dest.postalCode, send_state: myState(i.dest.postalCode) ?? '', send_country: 'MY', weight: Math.max(1, Math.ceil(i.weightKg)),
    }]);
    return ((r.rates ?? []) as Record<string, any>[])
      .map((x) => ({ courierCode: EP_CODE(String(x.courier_name ?? '')), courierName: String(x.courier_name), service: String(x.service_id), serviceName: String(x.service_name ?? x.courier_name),
        etd: String(x.delivery ?? '-'), price: Number(x.price ?? x.shipment_price ?? 0) }))
      .filter((q) => !i.couriers.length || i.couriers.includes(q.courierCode))
      .sort((a, b) => a.price - b.price);
  }
  async book(i: BookInput): Promise<BookResult> {
    if (!i.origin.postalCode || !i.dest.postalCode) throw new HttpError(400, 'Poskod asal & tujuan wajib untuk kurir mitra');
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
    const order = await this.call('EPSubmitOrderBulk', [{
      weight: Math.max(1, Math.ceil(i.weightKg)), content: i.itemsSummary.slice(0, 35), value: Math.round(i.value), service_id: i.service,
      pick_name: i.origin.name, pick_contact: i.origin.phone, pick_addr1: i.origin.address.slice(0, 35), pick_city: i.origin.city, pick_state: myState(i.origin.postalCode) ?? '', pick_code: i.origin.postalCode, pick_country: 'MY',
      send_name: i.dest.name, send_contact: i.dest.phone, send_addr1: i.dest.address.slice(0, 35), send_addr2: i.dest.address.slice(35, 70), send_city: i.dest.city, send_state: myState(i.dest.postalCode) ?? '', send_code: i.dest.postalCode, send_country: 'MY',
      collect_date: today, sms: 1, reference: i.shipmentNo,
    }]);
    const orderNo = String(order.order_number ?? '');
    const paid = await this.call('EPPayOrderBulk', [{ order_no: orderNo }]);
    const parcel = ((paid.parcel ?? []) as Record<string, any>[])[0] ?? {};
    return { trackingNo: parcel.awb ?? null, externalRef: parcel.awb ?? orderNo, price: Number(order.price ?? 0) || null, status: paid.messagenow ?? 'confirmed' };
  }
  async fetchUpdate(externalRef: string): Promise<CourierUpdate> {
    const r = await this.call('EPTrackingBulk', [{ awb_no: externalRef }]);
    const st = String(r.latest_status ?? r.status_list?.[0]?.status ?? '').toLowerCase();
    const status: CourierUpdate['status'] = /deliver|success/.test(st) ? 'delivered' : /return|fail|cancel/.test(st) ? 'failed' : 'in_transit';
    return { externalRef, trackingNo: r.awb ?? externalRef, status, courierStatus: st || 'in_transit', note: r.latest_update ?? null };
  }
}

/** Negara tanpa agregator kurir (mis. Brunei): hanya armada internal & ambil sendiri. */
class NoCourierProvider implements CourierProvider {
  name = 'none';
  async quote(): Promise<CourierQuote[]> { return []; }
  async book(): Promise<BookResult> { throw new HttpError(400, 'Kurir mitra belum tersedia di negara ini'); }
}

const providers = new Map<string, CourierProvider>();
/** Provider per negara: ID → SHIPPING_PROVIDER (biteship), MY → SHIPPING_PROVIDER_MY (easyparcel), BN → tanpa kurir mitra. */
export function getCourierProvider(country = 'ID'): CourierProvider {
  const hit = providers.get(country);
  if (hit) return hit;
  let p: CourierProvider;
  if (country === 'MY') {
    const name = (process.env.SHIPPING_PROVIDER_MY ?? 'mock').toLowerCase();
    if (name === 'easyparcel') {
      const key = process.env.EASYPARCEL_API_KEY;
      if (!key) throw new Error('SHIPPING_PROVIDER_MY=easyparcel tetapi EASYPARCEL_API_KEY kosong');
      const prod = process.env.EASYPARCEL_IS_PRODUCTION === 'true';
      p = new EasyParcelProvider(key, (process.env.EASYPARCEL_BASE_URL || (prod ? 'https://connect.easyparcel.my' : 'http://demo.connect.easyparcel.my')).replace(/\/$/, ''));
    } else p = name === 'none' ? new NoCourierProvider() : new MockCourierProvider();
  } else if (country === 'BN') {
    p = new NoCourierProvider();
  } else if ((process.env.SHIPPING_PROVIDER ?? 'mock').toLowerCase() === 'biteship') {
    const key = process.env.BITESHIP_API_KEY;
    if (!key) throw new Error('SHIPPING_PROVIDER=biteship tetapi BITESHIP_API_KEY kosong');
    p = new BiteshipProvider(key, (process.env.BITESHIP_BASE_URL || 'https://api.biteship.com').replace(/\/$/, ''));
  } else p = new MockCourierProvider();
  providers.set(country, p);
  return p;
}

/** Label status kurir (Biteship) dalam bahasa Indonesia. */
export const COURIER_STATUS_LABEL: Record<string, string> = {
  confirmed: 'Pesanan kurir dikonfirmasi', allocated: 'Kurir ditugaskan', picking_up: 'Kurir menuju lokasi penjemputan', picked: 'Paket diambil kurir',
  dropping_off: 'Paket dalam pengantaran', return_in_transit: 'Paket dalam perjalanan kembali', on_hold: 'Pengiriman ditahan', delivered: 'Paket diterima',
  rejected: 'Ditolak kurir', courier_not_found: 'Kurir tidak ditemukan', returned: 'Paket dikembalikan', cancelled: 'Dibatalkan', disposed: 'Paket dimusnahkan',
};
