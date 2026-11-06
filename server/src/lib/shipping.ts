import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { customerContact, links, notifyCustomer, webUrl, when, type Template } from './notify.js';
import { db } from '../db/client.js';
import { branches, creditApplications, notifications, orders, productReturns, shipmentEvents, shipments, users, type Shipment } from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import { COURIER_NAMES, COURIER_STATUS_LABEL, getCourierProvider, sameArea, type CourierUpdate } from './couriers.js';
import type { Tx } from './stock.js';
import type { AuthUser } from '../middleware/auth.js';
import { branchCountry } from './region.js';

export type DeliveryMode = 'internal' | 'partner' | 'pickup';
export interface DeliveryOption { mode: DeliveryMode; label: string; courierCode?: string; service?: string; etd: string; fee: number; note?: string }

/** Pilihan pengiriman untuk tujuan & barang tertentu (dipakai checkout & akad kredit). */
export async function quoteOptions(p: { fromBranchId: string; destCity: string; destPostalCode?: string | null; weightKg: number; isBulky: boolean; installCount: number; subtotal: number; itemName?: string }) {
  const [from] = await db.select().from(branches).where(eq(branches.id, p.fromBranchId)).limit(1);
  if (!from) throw new HttpError(400, 'Lokasi asal tidak ditemukan');
  const [flat, freeMin, couriers, pickupEnabled, installFee] = await Promise.all([
    getConfig<number>('shipping.internal_flat_fee', from.countryCode), getConfig<number>('shipping.free_shipping_min_order', from.countryCode),
    getConfig<string[]>('shipping.partner_couriers', from.countryCode), getConfig<boolean>('shipping.pickup_enabled', from.countryCode), getConfig<number>('shipping.installation_fee', from.countryCode),
  ]);
  const install = Number(installFee) * p.installCount;
  const opts: DeliveryOption[] = [];
  const sameCity = sameArea(p.destCity, from.city);
  if (sameCity) {
    const free = Number(freeMin) > 0 && p.subtotal >= Number(freeMin);
    opts.push({ mode: 'internal', label: 'Armada Masri-M', etd: 'Sesuai jadwal (1-2 hari)', fee: (free ? 0 : Number(flat)) + install,
      note: [free ? 'Gratis ongkir' : null, install ? 'termasuk pemasangan' : null, p.isBulky ? 'cocok untuk barang besar' : null].filter(Boolean).join(', ') || undefined });
  }
  const provider = getCourierProvider(from.countryCode);
  let courierNote: string | null = null;
  const quotes = await provider.quote({ origin: { city: from.city, postalCode: from.postalCode }, dest: { city: p.destCity, postalCode: p.destPostalCode },
    weightKg: p.weightKg, isBulky: p.isBulky, couriers: couriers ?? [], value: p.subtotal, itemName: p.itemName ?? 'Elektronik / furniture' })
    .catch((e) => { courierNote = e instanceof HttpError ? e.message : 'Ongkir kurir mitra belum tersedia'; return []; });
  if (!['mock', 'none'].includes(provider.name) && !p.destPostalCode) courierNote = 'Isi kode pos untuk melihat ongkir kurir mitra';
  for (const q of quotes) opts.push({ mode: 'partner', label: q.serviceName.toLowerCase().startsWith(q.courierName.toLowerCase()) ? q.serviceName : `${q.courierName} ${q.serviceName}`, courierCode: q.courierCode, service: q.service, etd: q.etd, fee: q.price });
  if (pickupEnabled) opts.push({ mode: 'pickup', label: `Ambil sendiri di ${from.name}`, etd: 'Setelah barang disiapkan', fee: 0, note: from.address || from.city });
  return { from: { id: from.id, name: from.name, city: from.city }, options: opts, courierNote };
}

/** Validasi pilihan klien terhadap kuotasi server (agar ongkir tidak bisa dimanipulasi). */
export async function resolveOption(p: Parameters<typeof quoteOptions>[0], mode: DeliveryMode, courierCode?: string | null, service?: string | null) {
  const { options } = await quoteOptions(p);
  const opt = options.find((o) => o.mode === mode && (mode !== 'partner' || (o.courierCode === courierCode && o.service === service)));
  if (!opt) throw new HttpError(400, 'Pilihan pengiriman tidak tersedia untuk alamat ini');
  return opt;
}

async function nextNo(tx: Tx | typeof db) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('stock_doc_seq')::text as seq`);
  const d = new Date();
  return `SHP-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
}

async function ev(tx: Tx | typeof db, shipmentId: string, status: string, message: string | null, actor?: AuthUser | null) {
  await tx.insert(shipmentEvents).values({ shipmentId, status, message, actorName: actor?.fullName ?? 'Sistem' });
}

async function notifyOps(tx: Tx | typeof db, s: Pick<Shipment, 'fromBranchId' | 'shipmentNo' | 'mode' | 'recipientName'>, title: string, body: string) {
  const [b] = await tx.select({ type: branches.type }).from(branches).where(eq(branches.id, s.fromBranchId)).limit(1);
  const role = b?.type === 'head_office' ? 'warehouse' : 'branch-admin';
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), eq(users.roleCode, role), eq(users.branchId, s.fromBranchId)));
  if (rows.length) await tx.insert(notifications).values(rows.map((r) => ({ userId: r.id, title, body })));
}

export interface NewShipment {
  sourceType: 'credit' | 'order' | 'return'; sourceId: string; sourceNo: string; branchId: string; fromBranchId: string; mode: DeliveryMode;
  recipientName: string; recipientPhone: string; address: string; city: string; postalCode?: string | null; itemsSummary: string; weightKg: number; isBulky: boolean;
  needsInstallation: boolean; shippingFee: number; courierCode?: string | null; courierService?: string | null;
}

export async function createShipment(tx: Tx, n: NewShipment) {
  const shipmentNo = await nextNo(tx);
  const [s] = await tx.insert(shipments).values({ ...n, shipmentNo, courierCode: n.courierCode ?? null, courierService: n.courierService ?? null }).returning();
  await ev(tx, s.id, 'pending', `Pengiriman dibuat (${modeLabel(s)})`);
  await notifyOps(tx, s, `Pengiriman baru ${shipmentNo} (${modeLabel(s)})`, `${n.sourceNo} · ${n.recipientName} · ${n.itemsSummary}`);
  return s;
}

export const modeLabel = (s: Pick<Shipment, 'mode' | 'courierCode' | 'courierService'>) =>
  s.mode === 'internal' ? 'Armada Masri-M' : s.mode === 'pickup' ? 'Ambil sendiri' : `${COURIER_NAMES[s.courierCode ?? ''] ?? s.courierCode} ${s.courierService ?? ''}`.trim();

// ---------------------------------------------------------------------------
// Hak akses: lokasi stok asal (Gudang Pusat -> warehouse, cabang -> Admin Cabang); driver untuk tugasnya
// ---------------------------------------------------------------------------
export function canOperate(user: AuthUser, s: Shipment) {
  if (user.roleCode === 'warehouse' && user.branch?.type === 'head_office' && user.branch.id === s.fromBranchId) return true;
  if (user.roleCode === 'branch-admin' && user.branch?.id === s.fromBranchId) return true;
  return false;
}
function assertOperate(user: AuthUser, s: Shipment) {
  if (!canOperate(user, s)) throw new HttpError(403, 'Pengiriman ini diproses oleh lokasi stok asal');
}
function assertStatus(s: Shipment, allowed: Shipment['status'][], action: string) {
  if (!allowed.includes(s.status)) throw new HttpError(409, `Pengiriman ${s.shipmentNo} berstatus "${s.status}" tidak dapat ${action}`);
}

export async function loadShipment(id: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, id)).limit(1);
  if (!s) throw new HttpError(404, 'Pengiriman tidak ditemukan');
  return s;
}

/** Simpan perubahan pengiriman dengan penguncian optimistis pada status (mencegah serah terima / proses ganda). */
async function save(tx: Tx | typeof db, s: Shipment, patch: Partial<typeof shipments.$inferInsert>) {
  const [after] = await tx.update(shipments).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(shipments.id, s.id), eq(shipments.status, s.status))).returning();
  if (!after) throw new HttpError(409, `Pengiriman ${s.shipmentNo} baru saja diubah oleh proses lain. Muat ulang lalu coba lagi.`);
  return after;
}

/** Armada internal: tugaskan driver & jadwal. */
export async function scheduleInternal(actor: AuthUser, id: string, p: { driverId: string; date: string; slot: string; vehicleRef?: string | null }) {
  const s = await loadShipment(id);
  assertOperate(actor, s);
  if (s.mode !== 'internal') throw new HttpError(400, 'Bukan pengiriman armada internal');
  assertStatus(s, ['pending', 'scheduled', 'failed'], 'dijadwalkan');
  const [drv] = await db.select().from(users).where(and(eq(users.id, p.driverId), eq(users.roleCode, 'delivery'), eq(users.status, 'active'))).limit(1);
  if (!drv) throw new HttpError(400, 'Driver tidak ditemukan');
  // Driver harus dari kantor pengirim barang (atau kantor tujuan) — bukan cabang / negara lain
  if (drv.branchId !== s.fromBranchId && drv.branchId !== s.branchId) throw new HttpError(400, 'Driver bukan dari kantor pengirim / tujuan pengiriman ini');
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'scheduled', driverId: drv.id, scheduledDate: p.date, scheduledSlot: p.slot, vehicleRef: p.vehicleRef ?? null, failReason: null });
    await ev(tx, s.id, 'scheduled', `Dijadwalkan ${p.date} (${p.slot}) · driver ${drv.fullName}${p.vehicleRef ? ` · ${p.vehicleRef}` : ''}`, actor);
    await tx.insert(notifications).values({ userId: drv.id, title: `Tugas antar ${s.shipmentNo} — ${p.date} ${p.slot}`, body: `${s.recipientName} · ${s.address}, ${s.city}` });
    await notifyShipment(tx, after, 'shipment_scheduled', { date: p.date, slot: p.slot }, `${p.date}:${p.slot}`);
    return after;
  });
}

/** Kurir mitra: booking ke agregator & dapatkan nomor resi. */
export async function bookPartner(actor: AuthUser, id: string) {
  const s = await loadShipment(id);
  assertOperate(actor, s);
  if (s.mode !== 'partner') throw new HttpError(400, 'Bukan pengiriman kurir mitra');
  assertStatus(s, ['pending', 'failed'], 'dipesan ke kurir');
  const [from] = await db.select().from(branches).where(eq(branches.id, s.fromBranchId)).limit(1);
  const r = await getCourierProvider(from.countryCode).book({
    courierCode: s.courierCode!, service: s.courierService ?? 'Reguler', shipmentNo: s.shipmentNo,
    origin: { name: `Masri-M ${from.name}`, phone: from.phone ?? '', address: from.address, city: from.city, postalCode: from.postalCode },
    dest: { name: s.recipientName, phone: s.recipientPhone, address: s.address, city: s.city, postalCode: s.postalCode },
    weightKg: s.weightKg, value: await declaredValue(s), itemsSummary: s.itemsSummary,
  });
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'in_transit', trackingNo: r.trackingNo, externalRef: r.externalRef, courierStatus: r.status ?? null, failReason: null });
    await ev(tx, s.id, 'in_transit', `Diserahkan ke ${modeLabel(s)}${r.trackingNo ? ` · resi ${r.trackingNo}` : ' · resi menyusul dari kurir'}`, actor);
    await notifyShipment(tx, after, 'shipment_in_transit', { carrier: modeLabel(s), trackingNo: r.trackingNo }, 'book');
    return after;
  });
}

/** Ambil sendiri: barang disiapkan, kode pengambilan diterbitkan. */
export async function preparePickup(actor: AuthUser, id: string) {
  const s = await loadShipment(id);
  assertOperate(actor, s);
  if (s.mode !== 'pickup') throw new HttpError(400, 'Bukan pengambilan sendiri');
  assertStatus(s, ['pending'], 'disiapkan');
  const days = Number(await getConfig<number>('shipping.pickup_hold_days', await branchCountry(s.fromBranchId))) || 7;
  const code = String(crypto.randomInt(100000, 1000000));
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'ready_pickup', pickupCode: code, pickupExpiresAt: new Date(Date.now() + days * 86400_000) });
    await ev(tx, s.id, 'ready_pickup', `Barang siap diambil. Berlaku ${days} hari. Kode diberikan kepada nasabah.`, actor);
    const [from] = await tx.select({ name: branches.name, address: branches.address }).from(branches).where(eq(branches.id, s.fromBranchId));
    await notifyShipment(tx, after, 'pickup_ready', { code, expires: when(after.pickupExpiresAt), location: `${from.name}${from.address ? ` (${from.address})` : ''}` }, code);
    return after;
  });
}

/** Driver berangkat. */
export async function dispatch(actor: AuthUser, id: string) {
  const s = await loadShipment(id);
  if (!(actor.roleCode === 'delivery' && s.driverId === actor.id) && !canOperate(actor, s)) throw new HttpError(403, 'Bukan tugas Anda');
  assertStatus(s, ['scheduled'], 'diberangkatkan');
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'in_transit' });
    await ev(tx, s.id, 'in_transit', 'Barang dalam perjalanan bersama driver', actor);
    return after;
  });
}

export type CompletionHook = (tx: Tx, s: Shipment, actor: AuthUser | null) => Promise<void>;
const hooks: Partial<Record<'credit' | 'order' | 'return', CompletionHook>> = {};
export const onShipmentDelivered = (type: 'credit' | 'order' | 'return', fn: CompletionHook) => { hooks[type] = fn; };

/** Batalkan pengiriman yang belum berangkat untuk sebuah order / akad (pembatalan + refund). */
export async function cancelShipmentsFor(tx: Tx, sourceType: 'credit' | 'order', sourceId: string, reason: string, actor: AuthUser) {
  const list = await tx.select().from(shipments).where(and(eq(shipments.sourceType, sourceType), eq(shipments.sourceId, sourceId))).for('update');
  if (list.some((s) => s.status === 'in_transit' || s.status === 'delivered')) throw new HttpError(409, 'Barang sudah dalam perjalanan / diterima — gunakan proses retur');
  for (const s of list.filter((x) => x.status !== 'cancelled')) {
    await tx.update(shipments).set({ status: 'cancelled', failReason: reason, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    await ev(tx, s.id, 'cancelled', `Dibatalkan: ${reason}`, actor);
    await notifyOps(tx, s, `Pengiriman ${s.shipmentNo} DIBATALKAN`, reason);
  }
}

/** Status pengiriman terakhir untuk validasi pembatalan. */
export async function shipmentStateFor(sourceType: 'credit' | 'order', sourceId: string) {
  const list = await db.select({ status: shipments.status }).from(shipments).where(and(eq(shipments.sourceType, sourceType), eq(shipments.sourceId, sourceId)));
  return { dispatched: list.some((s) => s.status === 'in_transit' || s.status === 'delivered'), count: list.length };
}

/** Bukti terima (POD). Untuk ambil sendiri wajib kode pengambilan yang cocok. */
export async function deliver(actor: AuthUser | null, id: string, p: { podName: string; podNote?: string | null; podPhotoUrl?: string | null; pickupCode?: string | null }) {
  const s = await loadShipment(id);
  if (actor) {
    const isDriver = actor.roleCode === 'delivery' && s.driverId === actor.id;
    if (!isDriver && !canOperate(actor, s)) throw new HttpError(403, 'Bukan tugas Anda');
  }
  if (s.mode === 'pickup') {
    assertStatus(s, ['ready_pickup'], 'diserahkan');
    if (!p.pickupCode || p.pickupCode.trim() !== s.pickupCode) throw new HttpError(400, 'Kode pengambilan tidak cocok');
    if (s.pickupExpiresAt && s.pickupExpiresAt < new Date()) throw new HttpError(409, 'Kode pengambilan sudah kedaluwarsa, siapkan ulang');
  } else {
    assertStatus(s, ['in_transit'], 'diselesaikan');
  }
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'delivered', podName: p.podName, podNote: p.podNote ?? null, podPhotoUrl: p.podPhotoUrl ?? null, deliveredAt: new Date(), deliveredBy: actor?.id ?? null });
    await ev(tx, s.id, 'delivered', `Diterima oleh ${p.podName}${p.podNote ? ` — ${p.podNote}` : ''}`, actor);
    await hooks[s.sourceType as 'credit' | 'order']?.(tx, after, actor);
    await notifyShipment(tx, after, 'shipment_delivered', { receiver: p.podName, extraKey: s.sourceType === 'credit' ? 'schedule_active' : null }, 'done');
    return after;
  });
}

export async function failDelivery(actor: AuthUser, id: string, reason: string) {
  const s = await loadShipment(id);
  const isDriver = actor.roleCode === 'delivery' && s.driverId === actor.id;
  if (!isDriver && !canOperate(actor, s)) throw new HttpError(403, 'Bukan tugas Anda');
  assertStatus(s, ['scheduled', 'in_transit'], 'digagalkan');
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { status: 'failed', failReason: reason });
    await ev(tx, s.id, 'failed', `Gagal antar: ${reason}`, actor);
    await notifyOps(tx, s, `Pengiriman ${s.shipmentNo} GAGAL`, reason);
    return after;
  });
}

/** Ganti mode (mis. gagal antar -> ambil sendiri). Ongkir tidak dikembalikan otomatis. */
export async function changeMode(actor: AuthUser, id: string, mode: DeliveryMode) {
  const s = await loadShipment(id);
  assertOperate(actor, s);
  assertStatus(s, ['pending', 'failed'], 'diubah');
  if (mode === 'partner') throw new HttpError(400, 'Ubah ke kurir mitra memerlukan kuotasi ulang — buat pengiriman baru');
  return db.transaction(async (tx) => {
    const after = await save(tx, s, { mode, status: 'pending', driverId: null, scheduledDate: null, scheduledSlot: null, failReason: null });
    await ev(tx, s.id, 'pending', `Mode diubah menjadi ${mode === 'pickup' ? 'ambil sendiri' : 'armada internal'}`, actor);
    return after;
  });
}

/** Nilai barang untuk asuransi / deklarasi kurir. */
async function declaredValue(s: Shipment) {
  if (s.sourceType === 'order') return (await db.select({ v: orders.subtotal }).from(orders).where(eq(orders.id, s.sourceId)))[0]?.v ?? 0;
  if (s.sourceType === 'credit') return (await db.select({ v: creditApplications.cashPrice }).from(creditApplications).where(eq(creditApplications.id, s.sourceId)))[0]?.v ?? 0;
  const [r] = await db.select({ p: productReturns.unitPrice, q: productReturns.qty }).from(productReturns).where(eq(productReturns.id, s.sourceId));
  return r ? r.p * r.q : 0;
}

/** Terapkan status dari kurir mitra (webhook Biteship) ke pengiriman. Idempoten. */
export async function applyCourierUpdate(u: CourierUpdate) {
  try { return await applyCourierUpdateOnce(u); } catch (e) {
    // Webhook berulang / bersamaan: perubahan sudah diterapkan proses lain -> anggap selesai
    if (e instanceof HttpError && e.status === 409) return { ok: true, duplicate: true };
    throw e;
  }
}
async function applyCourierUpdateOnce(u: CourierUpdate) {
  const [s] = await db.select().from(shipments).where(eq(shipments.externalRef, u.externalRef)).limit(1);
  if (!s) return { ok: false, reason: 'unknown_shipment' };
  if (u.trackingNo && u.trackingNo !== s.trackingNo) {
    await save(db, s, { trackingNo: u.trackingNo });
    await ev(db, s.id, 'in_transit', `Nomor resi: ${u.trackingNo}`);
  }
  if (u.courierStatus !== s.courierStatus) {
    await save(db, s, { courierStatus: u.courierStatus });
    if (u.status === 'in_transit') await ev(db, s.id, 'in_transit', COURIER_STATUS_LABEL[u.courierStatus] ?? `Status kurir: ${u.courierStatus}`);
  }
  if (u.status === 'delivered' && s.status === 'in_transit') {
    await deliver(null, s.id, { podName: s.recipientName, podNote: `${COURIER_STATUS_LABEL.delivered} (${modeLabel(s)}${s.trackingNo ? `, resi ${s.trackingNo}` : ''})` });
  } else if (u.status === 'failed' && s.status === 'in_transit') {
    const reason = `${COURIER_STATUS_LABEL[u.courierStatus] ?? u.courierStatus}${u.note ? `: ${u.note}` : ''}`;
    await db.transaction(async (tx) => {
      await save(tx, s, { status: 'failed', failReason: reason });
      await ev(tx, s.id, 'failed', `Kurir: ${reason}`);
      await notifyOps(tx, s, `Pengiriman ${s.shipmentNo} GAGAL di kurir`, reason);
    });
  }
  return { ok: true };
}

/** Kabari nasabah tentang pengiriman (WhatsApp / email) lewat outbox. */
async function notifyShipment(tx: Tx, s: Shipment, t: Template, extra: Record<string, string | number | null | undefined>, dedupe: string) {
  let email: string | null = null, link = webUrl();
  if (s.sourceType === 'order') {
    const [o] = await tx.select({ customerId: orders.customerId, no: orders.orderNo }).from(orders).where(eq(orders.id, s.sourceId)).limit(1);
    if (o) { email = (await customerContact(tx, o.customerId)).email; link = links.order(o.no); }
  } else if (s.sourceType === 'credit') {
    const [a] = await tx.select({ customerId: creditApplications.customerId, appNo: creditApplications.appNo }).from(creditApplications).where(eq(creditApplications.id, s.sourceId)).limit(1);
    if (a) { email = (await customerContact(tx, a.customerId)).email; link = links.credit(a.appNo); }
  }
  await notifyCustomer(tx, { phone: s.recipientPhone || null, email }, t, { name: s.recipientName, items: s.itemsSummary, ref: s.sourceNo, link, ...extra },
    { type: 'shipment', id: s.id, dedupe: `ship:${s.id}:${t}:${dedupe}` });
}

/** Agregator tanpa webhook (EasyParcel): tanyakan status resi yang masih berjalan secara berkala. */
export async function pollCourierUpdates(limit = 50) {
  const rows = await db.select({ ref: shipments.externalRef, country: branches.countryCode }).from(shipments)
    .innerJoin(branches, eq(branches.id, shipments.fromBranchId))
    .where(and(eq(shipments.mode, 'partner'), eq(shipments.status, 'in_transit'), sql`${shipments.externalRef} is not null`)).limit(limit);
  let changed = 0;
  for (const r of rows) {
    const p = getCourierProvider(r.country);
    if (p.name !== 'easyparcel' || !p.fetchUpdate) continue;
    try {
      const u = await p.fetchUpdate(r.ref!);
      const res = await applyCourierUpdate(u) as { changed?: boolean } | undefined;
      if (res?.changed) changed++;
    } catch (e) { console.error(`[kurir] gagal cek ${r.ref}:`, (e as Error).message); }
  }
  return changed;
}
