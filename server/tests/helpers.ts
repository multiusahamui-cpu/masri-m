import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { loadAuthUser, type AuthUser } from '../src/middleware/auth.js';
import { openShift, openShiftOf } from '../src/lib/finance.js';
import { assignAo, branchReview, hqDecide, payDownPaymentAtCashier, recommend, saveKyc, saveSurvey, signContract, submitApplication } from '../src/lib/credit.js';
import { deliver, preparePickup } from '../src/lib/shipping.js';

export const P = 'DemoMasri2026';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q1 = async <T = any>(s: string, p: unknown[] = []) => (await pool.query(s, p)).rows[0] as T;

let base = '';
export async function startApp() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return { server, base };
}
export const api = () => base;

export type Res = { s: number } & Record<string, any>;
export async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { s: r.status, ...((await r.json().catch(() => ({}))) as object) };
}
export const pub = (method: string, path: string, body?: unknown) => call(method, base + path, body);

export async function login(email: string) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: P }) });
  if (!r.ok) throw new Error(`login ${email} gagal: ${r.status}`);
  const ck = r.headers.get('set-cookie')!.split(';')[0];
  return { get: (p: string) => call('GET', base + p, undefined, { cookie: ck }), post: (p: string, b?: unknown) => call('POST', base + p, b ?? {}, { cookie: ck }), cookie: ck };
}

/** Server tiruan Midtrans + Biteship + Fonnte (dokumentasi resmi masing-masing). */
export function startFakes(port = 18788) {
  const tx: Record<string, any> = {}, ships: Record<string, any> = {}, wa: any[] = [], bills: Record<string, any> = {}, epOrders: Record<string, any> = {}, epAwb: Record<string, string> = {};
  let n = 0;
  const send = (res: http.ServerResponse, code: number, j: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let body: any = {}; try { body = b ? JSON.parse(b) : {}; } catch { /* form */ }
      const u = req.url!; let m: RegExpMatchArray | null;
      if (u === '/v2/charge') {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('SB-Mid-server-TEST:').toString('base64')) return send(res, 401, { status_code: '401', status_message: 'Unauthorized' });
        const id = body.transaction_details.order_id;
        const t = tx[id] = { transaction_id: `mt-${++n}`, order_id: id, gross_amount: `${body.transaction_details.gross_amount}.00`, transaction_status: 'pending', fraud_status: 'accept', body };
        const base = { status_code: '201', transaction_id: t.transaction_id, order_id: id, gross_amount: t.gross_amount, transaction_status: 'pending' };
        if (body.payment_type === 'qris') return send(res, 200, { ...base, qr_string: `00020101021226QRIS${id}`, actions: [{ name: 'generate-qr-code', method: 'GET', url: `http://fake/qr/${id}` }] });
        if (body.bank_transfer.bank === 'permata') return send(res, 200, { ...base, permata_va_number: '8562' + String(Date.now()).slice(-8) });
        return send(res, 200, { ...base, va_numbers: [{ bank: body.bank_transfer.bank, va_number: '12345' + String(Date.now()).slice(-8) }] });
      }
      if ((m = u.match(/^\/v2\/([^/]+)\/status$/))) { const t = tx[decodeURIComponent(m[1])]; return t ? send(res, 200, { status_code: '200', ...t }) : send(res, 404, { status_code: '404' }); }
      if (u === '/v1/rates/couriers') {
        if (req.headers.authorization !== 'biteship_test.KEY') return send(res, 401, { success: false, error: 'auth' });
        return send(res, 200, { success: true, pricing: [
          { courier_code: 'jne', courier_name: 'JNE', courier_service_code: 'reg', courier_service_name: 'Reguler', price: 24000, shipment_duration_range: '2 - 3', shipment_duration_unit: 'days' },
          { courier_code: 'sicepat', courier_name: 'SiCepat', courier_service_code: 'best', courier_service_name: 'Besok Sampai', price: 31000, shipment_duration_range: '1', shipment_duration_unit: 'days' },
        ] });
      }
      if (u === '/v1/orders' && req.method === 'POST') { const id = `bs-${++n}`; ships[id] = { id, status: 'confirmed', courier: { waybill_id: null }, body }; return send(res, 200, { success: true, id, status: 'confirmed', courier: { waybill_id: null, tracking_id: 't' } }); }
      if ((m = u.match(/^\/v1\/orders\/([^/]+)$/))) { const s = ships[m[1]]; return s ? send(res, 200, { success: true, ...s }) : send(res, 404, { success: false, error: 'not found' }); }
      // Billplz (Malaysia)
      if (u === '/api/v3/bills' && req.method === 'POST') {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('BPKEY:').toString('base64')) return send(res, 401, { error: { type: 'Unauthorized', message: ['Invalid API key'] } });
        const f = Object.fromEntries(new URLSearchParams(b));
        const id = `bp${++n}`;
        bills[id] = { id, collection_id: f.collection_id, paid: false, state: 'due', amount: Number(f.amount), paid_amount: 0, reference_1: f.reference_1, url: `http://fake/bills/${id}`, form: f };
        return send(res, 200, bills[id]);
      }
      if ((m = u.match(/^\/api\/v3\/bills\/([^/]+)$/))) { const x = bills[m[1]]; return x ? send(res, 200, x) : send(res, 404, { error: { message: ['not found'] } }); }
      // EasyParcel (Malaysia)
      if (u.startsWith('/?ac=')) {
        const f = Object.fromEntries(new URLSearchParams(b));
        if (f.api !== 'EPKEY') return send(res, 200, { api_status: 'Error', error_remark: 'Unauthorized user' });
        const ac = u.slice(5);
        if (ac === 'EPRateCheckingBulk') return send(res, 200, { api_status: 'Success', result: [{ status: 'Success', rates: [
          { service_id: 'EP-CS0E', service_name: 'Pos Laju Next Day', courier_id: 'EP-CR0E', courier_name: 'Pos Laju', price: '12.50', delivery: '1-2 working day(s)' },
          { service_id: 'EP-CS0B', service_name: 'J&T Express', courier_id: 'EP-CR0B', courier_name: 'J&T Express', price: '9.80', delivery: '2-3 working day(s)' },
          { service_id: 'EP-CS0X', service_name: 'Xpress Lain', courier_id: 'EP-CR0X', courier_name: 'Xpress Lain', price: '5.00', delivery: '3 day(s)' },
        ], pick: f['bulk[0][pick_state]'], send: f['bulk[0][send_state]'] }] });
        if (ac === 'EPSubmitOrderBulk') { const no = `EI-${++n}`; epOrders[no] = { form: f }; return send(res, 200, { api_status: 'Success', result: [{ status: 'Success', order_number: no, price: '12.50' }] }); }
        if (ac === 'EPPayOrderBulk') { const awb = `ER${++n}MY`; epAwb[awb] = 'Shipment Picked Up'; return send(res, 200, { api_status: 'Success', result: [{ orderno: f['bulk[0][order_no]'], messagenow: 'Fully Paid', parcel: [{ parcelno: 'P1', awb, tracking_url: `http://fake/t/${awb}` }] }] }); }
        if (ac === 'EPTrackingBulk') { const awb = f['bulk[0][awb_no]']; return send(res, 200, { api_status: 'Success', result: [{ status: 'Success', awb, latest_status: epAwb[awb] ?? 'Unknown' }] }); }
      }
      if (u === '/send') { const f = Object.fromEntries(new URLSearchParams(b)); wa.push(f); return send(res, 200, req.headers.authorization === 'FONNTE-TOKEN' ? { status: true, target: [f.target] } : { status: false, reason: 'token invalid' }); }
      send(res, 404, { error: 'no route ' + u });
    });
  }).listen(port);
  return {
    server, tx, ships, wa, bills, epOrders, epAwb,
    payBill: (id: string) => { bills[id].paid = true; bills[id].state = 'paid'; bills[id].paid_amount = bills[id].amount; },
    settle: (orderId: string, status = 'settlement') => { tx[orderId].transaction_status = status; },
    courier: (id: string, status: string) => { ships[id].status = status; if (status !== 'confirmed') ships[id].courier.waybill_id = `WB${id}`; },
  };
}

export const user = async (email: string) => loadAuthUser((await q1(`select id from users where email=$1`, [email])).id) as Promise<AuthUser>;
/** Pastikan kasir punya shift terbuka (tes lain bisa sudah menutupnya). */
export async function ensureShift(email: string) { const k = await user(email); if (!(await openShiftOf(k.id))) await openShift(k, 500_000); }
/** Pembiayaan baru sampai aktif (barang diserahkan) lewat alur resmi. */
export async function activeCredit(code: 'jkt' | 'bdg' | 'pyk', sku: string, who: { phone: string; nik: string; name: string }) {
  const br = await q1(`select id, city from branches where code=$1`, [`${code.toUpperCase()}01`]);
  const p = await q1(`select id from products where sku=$1`, [sku]);
  const [ao, mc, bmU, ba] = await Promise.all([`ao.${code}`, `mc.${code}`, 'bm', `admin.${code}`].map((e) => user(`${e}@masri-m.local`)));
  const { application: a } = await submitApplication(null, { customer: { fullName: who.name, phone: who.phone, email: null, nik: who.nik, birthDate: '1989-03-03', city: br.city,
    address: 'Jl. Uji 1', occupation: 'Wiraswasta', employer: null, monthlyIncome: 20_000_000, maritalStatus: 'married', dependents: 1 }, branchId: br.id, productId: p.id, qty: 1, tenor: 12, dpPct: 20, purpose: 'Rumah tangga' });
  await assignAo(mc, a.id, ao.id);
  await saveKyc(ao, a.id, Object.fromEntries(['ktp', 'selfie', 'kk', 'income_proof', 'address_proof'].map((k) => [k, { ok: true }])));
  await saveSurvey(ao, a.id, { visitedAt: new Date().toISOString(), addressVerified: true, residenceStatus: 'own', lengthOfStayYears: 5, incomeVerified: true, verifiedIncome: 20_000_000, otherObligations: 0, characterScore: 4, photos: [], notes: 'Survei uji' });
  await recommend(ao, a.id, { recommendation: 'approve', tenor: 12, dpPct: 20, notes: 'Layak' });
  await branchReview(mc, a.id, 'forward', 'Layak');
  await hqDecide(bmU, a.id, { decision: 'approve', notes: 'Setuju' });
  await signContract(ao, a.id, { dpChannel: 'cashier', delivery: { mode: 'pickup', address: '', city: br.city } });
  await ensureShift(`ksr.${code}@masri-m.local`);
  await payDownPaymentAtCashier(await user(`ksr.${code}@masri-m.local`), a.id, { method: 'cash', proofRef: null });
  const sh = await q1(`select id, from_branch_id from shipments where source_id=$1`, [a.id]);
  const op = sh.from_branch_id === br.id ? ba : await user('wh@masri-m.local');
  const ready = await preparePickup(op, sh.id);
  await deliver(op, sh.id, { podName: who.name, podNote: 'uji', pickupCode: ready.pickupCode });
  return q1(`select a.id, a.app_no, a.contract_no, a.product_id, a.branch_id, a.status, a.monthly::float monthly from credit_applications a where a.id=$1`, [a.id]);
}
