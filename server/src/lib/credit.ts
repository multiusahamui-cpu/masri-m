import { and, count, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  branches, creditApplications, creditEvents, creditHqVotes, creditSurveys, customers, installments, notifications,
  productPrices, products, stockLevels, users, countries, iqalahRequests, refunds, tazirCharges, type CreditApplication,
} from '../db/schema.js';
import { HttpError } from './http.js';
import { getConfig } from './config.js';
import { simulate } from './murabahah.js';
import { applyMovement, commitReservedOut, releaseStock, reserveStock, type Tx } from './stock.js';
import { createShipment, onShipmentDelivered, resolveOption, type DeliveryMode } from './shipping.js';
import { payments, shipments } from '../db/schema.js';
import { onDownPaymentPaid } from './payments.js';
import type { VaBank } from './gateways.js';
import type { AuthUser } from '../middleware/auth.js';
import { customerContact, links, money, notifyCustomer, payVars, when, type Template } from './notify.js';
import { branchCountry, e164, phoneMatch, validPhoneFor } from './region.js';

type Status = CreditApplication['status'];
export const OPEN_STATUSES: Status[] = ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted'];
export const KYC_ITEMS = ['ktp', 'selfie', 'kk', 'income_proof', 'address_proof'] as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function nextNo(tx: Tx | typeof db, prefix: string) {
  const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('credit_doc_seq')::text as seq`);
  const d = new Date();
  return `${prefix}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${seq.padStart(5, '0')}`;
}

export async function loadApp(id: string, tx: Tx | typeof db = db) {
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, id)).limit(1);
  if (!a) throw new HttpError(404, 'Pengajuan tidak ditemukan');
  return a;
}

async function event(tx: Tx | typeof db, a: CreditApplication, actor: AuthUser | null, type: string, message: string | null, toStatus?: Status) {
  if ((toStatus === 'rejected' || toStatus === 'cancelled') && a.promoCode && a.status !== 'active') {
    const { voidPromo } = await import('./promo.js');
    await voidPromo(tx, 'credit', a.id);
  }
  await tx.insert(creditEvents).values({
    applicationId: a.id, type, actorId: actor?.id ?? null, actorName: actor?.fullName ?? 'Nasabah (web)',
    actorRole: actor?.roleCode ?? 'customer', message, fromStatus: toStatus ? a.status : null, toStatus: toStatus ?? null,
  });
  const t = type === 'submitted' ? 'credit_submitted' : toStatus && ({ approved: 'credit_approved', rejected: 'credit_rejected', active: 'credit_active', paid_off: 'credit_paid_off', cancelled: 'credit_cancelled' } as Record<string, Template>)[toStatus];
  if (t) await notifyCredit(tx, a, t, message);
}

/** Kabari nasabah saat status pembiayaan berubah. */
async function notifyCredit(tx: Tx | typeof db, a0: CreditApplication, t: Template, reason: string | null) {
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, a0.id)).limit(1);
  const c = await customerContact(tx, a.customerId);
  const [prod] = await tx.select({ name: products.name }).from(products).where(eq(products.id, a.productId));
  const [br] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, a.branchId));
  const [first] = t === 'credit_active' ? await tx.select({ due: installments.dueDate }).from(installments).where(eq(installments.applicationId, a.id)).orderBy(installments.seq).limit(1) : [];
  const days = t === 'credit_approved' ? Number(await getConfig<number>('credit.approval_valid_days', await branchCountry(a.branchId))) || 14 : 0;
  await notifyCustomer(tx, c, t, {
    name: c.name, appNo: a.appNo, contractNo: a.contractNo ?? a.appNo, product: prod?.name, branch: br?.name, link: links.credit(a.appNo),
    salePrice: money(a.salePrice ?? 0, a.currency), monthly: money(a.monthly ?? 0, a.currency), tenor: a.tenor, dp: money(a.downPayment ?? 0, a.currency),
    validUntil: when(new Date(Date.now() + days * 86400_000)), firstDue: first?.due ?? '-', reason: t === 'credit_cancelled' ? reason : null,
  }, { type: 'credit', id: a.id, dedupe: `credit:${a.id}:${t}` });
}

async function notifyWhere(tx: Tx | typeof db, where: SQL, exceptId: string | null, title: string, body: string) {
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), where));
  const ids = rows.map((r) => r.id).filter((i) => i !== exceptId);
  if (ids.length) await tx.insert(notifications).values(ids.map((userId) => ({ userId, title, body })));
}
const roleAt = (role: string, branchId: string) => and(eq(users.roleCode, role), eq(users.branchId, branchId))!;

/**
 * Perbarui pengajuan dengan penguncian optimistis: hanya berhasil bila status di basis data masih sama dengan
 * status saat data dibaca. Mencegah proses ganda (klik dua kali, webhook bersamaan) — transaksi dibatalkan bila kalah.
 */
async function update(tx: Tx | typeof db, a: CreditApplication, patch: Partial<typeof creditApplications.$inferInsert>) {
  const [after] = await tx.update(creditApplications).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(creditApplications.id, a.id), eq(creditApplications.status, a.status))).returning();
  if (!after) throw new HttpError(409, `Pengajuan ${a.appNo} baru saja diubah oleh proses lain. Muat ulang halaman lalu coba lagi.`);
  return after;
}

function assertStatus(a: CreditApplication, allowed: Status[], action: string) {
  if (!allowed.includes(a.status)) throw new HttpError(409, `Pengajuan ${a.appNo} berstatus "${a.status}" tidak dapat ${action}`);
}

/** Ruang lingkup data per role. */
export function scopeFilter(user: AuthUser): SQL | undefined {
  switch (user.roleCode) {
    case 'biz-mgr': case 'super-admin': case 'support': return undefined;
    case 'branch-manager': return user.branch ? eq(creditApplications.branchId, user.branch.id) : sql`false`;
    case 'ao': return and(eq(creditApplications.aoId, user.id));
    case 'branch-admin': return user.branch
      ? and(eq(creditApplications.branchId, user.branch.id), inArray(creditApplications.status, ['approved', 'contracted', 'active', 'paid_off']))
      : sql`false`;
    default: return sql`false`;
  }
}

/** Muat pembiayaan & pastikan staf cabang hanya mengakses pembiayaan cabangnya sendiri (staf Pusat: semua). */
export async function loadAppInBranchScope(user: AuthUser, id: string) {
  const a = await loadApp(id);
  if (user.branch?.type === 'branch' && user.branch.id !== a.branchId) throw new HttpError(404, 'Pengajuan tidak ditemukan');
  return a;
}

export async function getAppForUser(user: AuthUser, id: string) {
  const scope = scopeFilter(user);
  const [a] = await db.select().from(creditApplications).where(scope ? and(eq(creditApplications.id, id), scope) : eq(creditApplications.id, id)).limit(1);
  if (!a) throw new HttpError(404, 'Pengajuan tidak ditemukan');
  return a;
}

async function creditContext(countryCode = 'ID') {
  const [c] = await db.select().from(countries).where(eq(countries.code, countryCode)).limit(1);
  const [margins, minDp, maxFin, limit, maxDsr] = await Promise.all([
    getConfig<Record<string, number>>('credit.margin_by_tenor', countryCode),
    getConfig<number>('credit.min_down_payment_pct', countryCode),
    getConfig<number>('credit.max_financing_amount', countryCode),
    getConfig<number>('credit.bizmgr_approval_limit', countryCode),
    getConfig<number>('credit.max_dsr_pct', countryCode),
  ]);
  return { currency: c?.currency ?? 'IDR', margins, minDp: Number(minDp), maxFin: Number(maxFin), limit: Number(limit), maxDsr: Number(maxDsr) };
}

/** Hitung syarat Murabahah untuk tenor & DP tertentu; validasi batas parameter. */
export async function computeTerms(cashPrice: number, tenor: number, dpPct: number, countryCode = 'ID') {
  const ctx = await creditContext(countryCode);
  if (!(String(tenor) in ctx.margins)) throw new HttpError(400, `Tenor ${tenor} bulan tidak tersedia. Pilihan: ${Object.keys(ctx.margins).join(', ')} bulan`);
  if (!Number.isFinite(dpPct) || dpPct < ctx.minDp) throw new HttpError(400, `Uang muka minimal ${ctx.minDp}%`);
  if (dpPct > 90) throw new HttpError(400, 'Uang muka maksimal 90% (sisanya dibiayai)');
  if (!(cashPrice > 0)) throw new HttpError(400, 'Harga barang tidak valid');
  const opt = simulate(cashPrice, { [tenor]: ctx.margins[String(tenor)] }, ctx.minDp, ctx.currency, dpPct)[0];
  if (!(opt.financed > 0) || !(opt.monthly > 0)) throw new HttpError(400, 'Pokok pembiayaan & angsuran harus lebih dari 0');
  // Angsuran terakhir (sisa pembulatan) tidak boleh negatif / nol
  if (opt.salePrice - opt.monthly * (tenor - 1) <= 0) throw new HttpError(400, 'Nilai pembiayaan terlalu kecil untuk tenor ini — pilih tenor lebih pendek');
  if (opt.financed > ctx.maxFin) throw new HttpError(400, `Pokok pembiayaan melebihi plafon maksimum ${ctx.maxFin.toLocaleString('id-ID')}`);
  return { ...opt, dpPct, currency: ctx.currency, requiresCommittee: opt.financed > ctx.limit, maxDsr: ctx.maxDsr };
}

// ---------------------------------------------------------------------------
// 1. Pengajuan (web publik atau dibantu staf cabang)
// ---------------------------------------------------------------------------
export interface SubmitInput {
  customer: {
    fullName: string; phone: string; email?: string | null; nik: string; birthDate: string; city: string; address: string;
    occupation: string; employer?: string | null; monthlyIncome: number; maritalStatus?: string | null; dependents?: number | null;
  };
  branchId: string; productId: string; qty: number; tenor: number; dpPct: number; purpose?: string | null;
  promoCode?: string | null; marketingOptIn?: boolean;
}

export async function submitApplication(actor: AuthUser | null, input: SubmitInput) {
  if (actor && !['ao', 'branch-manager', 'branch-admin'].includes(actor.roleCode)) throw new HttpError(403, 'Pengajuan dibantu oleh staf cabang');
  if (actor && actor.branch?.id !== input.branchId) throw new HttpError(403, 'Pengajuan hanya untuk cabang Anda');
  const [b] = await db.select().from(branches).where(eq(branches.id, input.branchId)).limit(1);
  if (!b || b.type !== 'branch' || !b.isActive) throw new HttpError(400, 'Pilih cabang terdekat yang melayani');
  const [p] = await db.select({ id: products.id, name: products.name, status: products.status, price: productPrices.cashPrice }).from(products)
    .innerJoin(productPrices, and(eq(productPrices.productId, products.id), eq(productPrices.countryCode, b.countryCode)))
    .where(eq(products.id, input.productId)).limit(1);
  if (!p || p.status !== 'active') throw new HttpError(400, 'Produk tidak tersedia');
  if (!validPhoneFor(e164(input.customer.phone, b.countryCode), b.countryCode)) throw new HttpError(400, 'Nomor HP tidak valid untuk negara cabang');
  const listPrice = p.price * input.qty;
  // Potongan promo mengurangi harga barang SEBELUM akad (harga pokok yang dibiayai ikut turun)
  const { evaluatePromo, redeemPromo, setMarketingOptIn } = await import('./promo.js');
  const { CURRENCY } = await import('./region.js');
  const promo = input.promoCode?.trim()
    ? await evaluatePromo(db, { code: input.promoCode, country: b.countryCode, currency: CURRENCY[b.countryCode] ?? 'IDR', phone: e164(input.customer.phone, b.countryCode), channel: 'credit', lines: [{ productId: p.id, qty: input.qty, unitPrice: p.price }] })
    : null;
  const cashPrice = round2(listPrice - (promo?.discount ?? 0));
  const terms = await computeTerms(cashPrice, input.tenor, input.dpPct, b.countryCode);

  return db.transaction(async (tx) => {
    // Cari nasabah berdasarkan NIK, lalu no. HP
    const c = input.customer;
    let [cust] = await tx.select().from(customers).where(eq(customers.nik, c.nik)).limit(1);
    const phoneE = e164(c.phone, b.countryCode);
    if (!cust) [cust] = await tx.select().from(customers).where(phoneMatch(customers.phone, phoneE, b.countryCode)).limit(1);
    const kyc = {
      fullName: c.fullName, phone: `+${phoneE}`, email: c.email ?? null, nik: c.nik, birthDate: c.birthDate, city: c.city, address: c.address,
      occupation: c.occupation, employer: c.employer ?? null, monthlyIncome: c.monthlyIncome, maritalStatus: c.maritalStatus ?? null,
      dependents: c.dependents ?? null,
    };
    if (cust) {
      // Keamanan: nomor HP adalah identitas login nasabah. Pengajuan publik (tanpa login) tidak boleh mengubah
      // identitas nasabah yang sudah ada — mencegah pengambilalihan akun dengan NIK / nomor HP orang lain.
      const samePhone = !!cust.phone && cust.phone.replace(/\D/g, '') === phoneE;
      const sameNik = !cust.nik || cust.nik === c.nik;
      if (!actor && (!samePhone || !sameNik)) {
        throw new HttpError(409, 'Data identitas tidak cocok dengan data nasabah terdaftar. Gunakan nomor HP yang terdaftar, atau hubungi cabang terdekat untuk pembaruan data.');
      }
      const identityChanged = !samePhone || !sameNik || cust.fullName !== c.fullName || (cust.birthDate ?? '') !== c.birthDate;
      const patch = actor
        // Staf cabang memverifikasi identitas langsung; perubahan identitas membuat KYC wajib diverifikasi ulang
        ? { ...kyc, branchId: cust.branchId ?? b.id, kycStatus: cust.kycStatus === 'verified' && !identityChanged ? 'verified' : 'submitted' }
        // Nasabah sendiri (nomor HP & NIK cocok): hanya data non-identitas yang diperbarui
        : { email: kyc.email ?? cust.email, city: kyc.city, address: kyc.address, occupation: kyc.occupation, employer: kyc.employer, monthlyIncome: kyc.monthlyIncome,
            maritalStatus: kyc.maritalStatus, dependents: kyc.dependents, nik: cust.nik ?? c.nik, ...(cust.kycStatus === 'verified' ? {} : { fullName: kyc.fullName, birthDate: kyc.birthDate, kycStatus: 'submitted' }) };
      [cust] = await tx.update(customers).set(patch).where(eq(customers.id, cust.id)).returning();
      const [{ n }] = await tx.select({ n: count() }).from(creditApplications)
        .where(and(eq(creditApplications.customerId, cust.id), eq(creditApplications.productId, p.id), inArray(creditApplications.status, OPEN_STATUSES)));
      if (n > 0) throw new HttpError(409, 'Nasabah masih memiliki pengajuan aktif untuk produk ini');
    } else {
      const { rows: [{ seq }] } = await tx.execute<{ seq: string }>(sql`select nextval('customer_no_seq')::text as seq`);
      [cust] = await tx.insert(customers).values({ ...kyc, branchId: b.id, kycStatus: 'submitted', customerNo: `C${b.code}-${seq.padStart(6, '0')}` }).returning();
    }

    const selfAssign = actor?.roleCode === 'ao';
    const appNo = await nextNo(tx, 'APP');
    const [a] = await tx.insert(creditApplications).values({
      appNo, channel: actor ? 'branch' : 'web', customerId: cust.id, branchId: b.id, productId: p.id, qty: input.qty,
      currency: terms.currency, cashPrice, listPrice, promoCode: promo?.promo.code ?? null, requestedTenor: input.tenor, requestedDpPct: input.dpPct, purpose: input.purpose ?? null,
      status: selfAssign ? 'assigned' : 'submitted',
      ...(selfAssign ? { aoId: actor!.id, assignedBy: actor!.id, assignedAt: new Date() } : {}),
    }).returning();
    if (promo) await redeemPromo(tx, { promoId: promo.promo.id, phone: `+${phoneE}`, sourceType: 'credit', sourceId: a.id, sourceNo: appNo, discount: promo.discount });
    if (input.marketingOptIn) await setMarketingOptIn(tx, cust.id, true, { phone: `+${phoneE}`, country: b.countryCode });
    await event(tx, a, actor, 'submitted', `${p.name} × ${input.qty}, tenor ${input.tenor} bln, DP ${input.dpPct}%${promo ? `; kode promo ${promo.promo.code} −${promo.discount.toLocaleString('id-ID')} (harga ${listPrice.toLocaleString('id-ID')} → ${cashPrice.toLocaleString('id-ID')})` : ''}`);
    await notifyWhere(tx, roleAt('branch-manager', b.id), actor?.id ?? null,
      selfAssign ? `Pengajuan baru ${appNo} (ditangani ${actor!.fullName})` : `Pengajuan kredit baru ${appNo} — tugaskan AO`,
      `${c.fullName} · ${p.name} · tenor ${input.tenor} bln`);
    return { application: a, customer: cust, terms };
  });
}

// ---------------------------------------------------------------------------
// 2. Penugasan AO oleh Manager Cabang
// ---------------------------------------------------------------------------
export async function assignAo(actor: AuthUser, id: string, aoId: string) {
  const a = await loadApp(id);
  if (actor.roleCode !== 'branch-manager' || actor.branch?.id !== a.branchId) throw new HttpError(403, 'Penugasan AO dilakukan Manager Cabang');
  assertStatus(a, ['submitted', 'assigned'], 'ditugaskan');
  const [ao] = await db.select().from(users).where(and(eq(users.id, aoId), eq(users.roleCode, 'ao'), eq(users.branchId, a.branchId), eq(users.status, 'active'))).limit(1);
  if (!ao) throw new HttpError(400, 'AO tidak ditemukan di cabang ini');
  return db.transaction(async (tx) => {
    const after = await update(tx, a, { aoId: ao.id, assignedBy: actor.id, assignedAt: new Date(), status: 'assigned' });
    await event(tx, a, actor, 'assigned', `Ditugaskan ke ${ao.fullName}`, 'assigned');
    await notifyWhere(tx, eq(users.id, ao.id), actor.id, `Tugas baru: ${a.appNo}`, 'Lakukan verifikasi KYC & survei lapangan.');
    return after;
  });
}

function assertAo(actor: AuthUser, a: CreditApplication) {
  if (actor.roleCode !== 'ao' || a.aoId !== actor.id) throw new HttpError(403, 'Hanya AO yang ditugaskan');
}

// ---------------------------------------------------------------------------
// 3. KYC & survei (AO)
// ---------------------------------------------------------------------------
export async function saveKyc(actor: AuthUser, id: string, checklist: Record<string, { ok: boolean; note?: string }>) {
  const a = await loadApp(id);
  assertAo(actor, a);
  assertStatus(a, ['assigned'], 'diverifikasi');
  const complete = KYC_ITEMS.every((k) => checklist[k]?.ok === true);
  return db.transaction(async (tx) => {
    const after = await update(tx, a, { kycChecklist: checklist, kycCompletedAt: complete ? new Date() : null });
    await tx.update(customers).set(complete ? { kycStatus: 'verified', kycVerifiedAt: new Date(), kycVerifiedBy: actor.id } : { kycStatus: 'submitted' })
      .where(eq(customers.id, a.customerId));
    await event(tx, a, actor, 'kyc', complete ? 'KYC lengkap & terverifikasi' : `KYC belum lengkap: ${KYC_ITEMS.filter((k) => !checklist[k]?.ok).join(', ')}`);
    return after;
  });
}

export interface SurveyInput {
  visitedAt: string; addressVerified: boolean; residenceStatus: string; lengthOfStayYears: number; incomeVerified: boolean;
  verifiedIncome: number; otherObligations: number; characterScore: number; photos: string[]; notes?: string | null;
}

export async function saveSurvey(actor: AuthUser, id: string, s: SurveyInput) {
  const a = await loadApp(id);
  assertAo(actor, a);
  assertStatus(a, ['assigned'], 'disurvei');
  return db.transaction(async (tx) => {
    const row = { ...s, visitedAt: new Date(s.visitedAt), surveyorId: actor.id, notes: s.notes ?? null, updatedAt: new Date() };
    await tx.insert(creditSurveys).values({ applicationId: a.id, ...row }).onConflictDoUpdate({ target: creditSurveys.applicationId, set: row });
    await event(tx, a, actor, 'survey', `Survei ${s.addressVerified ? 'alamat sesuai' : 'alamat TIDAK sesuai'}, penghasilan terverifikasi ${s.verifiedIncome.toLocaleString('id-ID')}`);
    return a;
  });
}

/** Rasio angsuran (+ cicilan lain) terhadap penghasilan terverifikasi. */
export function dsr(monthly: number, income: number, otherObligations = 0) {
  if (!income) return null;
  return Math.round(((monthly + otherObligations) / income) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// 4. Rekomendasi AO -> 5. Review Manager Cabang
// ---------------------------------------------------------------------------
export async function recommend(actor: AuthUser, id: string, r: { recommendation: 'approve' | 'reject'; tenor: number; dpPct: number; notes: string }) {
  const a = await loadApp(id);
  assertAo(actor, a);
  assertStatus(a, ['assigned'], 'direkomendasikan');
  if (!a.kycCompletedAt) throw new HttpError(409, 'Lengkapi verifikasi KYC terlebih dahulu');
  const [sv] = await db.select().from(creditSurveys).where(eq(creditSurveys.applicationId, a.id)).limit(1);
  if (!sv) throw new HttpError(409, 'Isi hasil survei lapangan terlebih dahulu');
  if (r.recommendation === 'approve') await computeTerms(a.cashPrice, r.tenor, r.dpPct, await branchCountry(a.branchId));
  return db.transaction(async (tx) => {
    const after = await update(tx, a, {
      aoRecommendation: r.recommendation, aoSuggestedTenor: r.tenor, aoSuggestedDpPct: r.dpPct, aoNotes: r.notes,
      aoRecommendedAt: new Date(), status: 'branch_review',
    });
    await event(tx, a, actor, 'ao_recommendation', `${r.recommendation === 'approve' ? 'Direkomendasikan DISETUJUI' : 'Direkomendasikan DITOLAK'} (tenor ${r.tenor} bln, DP ${r.dpPct}%): ${r.notes}`, 'branch_review');
    await notifyWhere(tx, roleAt('branch-manager', a.branchId), actor.id, `Rekomendasi AO untuk ${a.appNo}`, r.notes);
    return after;
  });
}

export async function branchReview(actor: AuthUser, id: string, decision: 'forward' | 'return' | 'reject', notes: string) {
  const a = await loadApp(id);
  if (actor.roleCode !== 'branch-manager' || actor.branch?.id !== a.branchId) throw new HttpError(403, 'Review dilakukan Manager Cabang');
  assertStatus(a, ['branch_review'], 'direview');
  const to: Status = decision === 'forward' ? 'hq_review' : decision === 'return' ? 'assigned' : 'rejected';
  return db.transaction(async (tx) => {
    const after = await update(tx, a, { mcId: actor.id, mcNotes: notes, mcReviewedAt: new Date(), status: to, ...(to === 'rejected' ? { closedReason: notes } : {}) });
    const label = { forward: 'Diteruskan ke Business Manager Pusat', return: 'Dikembalikan ke AO untuk dilengkapi', reject: 'Ditolak di tingkat cabang' }[decision];
    await event(tx, a, actor, `mc_${decision}`, `${label}: ${notes}`, to);
    if (decision === 'forward') await notifyWhere(tx, eq(users.roleCode, 'biz-mgr'), actor.id, `Approval kredit ${a.appNo} menunggu keputusan`, notes);
    if (a.aoId) await notifyWhere(tx, eq(users.id, a.aoId), actor.id, `${a.appNo}: ${label}`, notes);
    return after;
  });
}

// ---------------------------------------------------------------------------
// 6. Keputusan Business Manager Pusat (komite bila melebihi batas wewenang)
// ---------------------------------------------------------------------------
async function pickFulfillBranch(tx: Tx, a: CreditApplication) {
  const avail = async (branchId: string) => {
    const [l] = await tx.select().from(stockLevels).where(and(eq(stockLevels.productId, a.productId), eq(stockLevels.branchId, branchId))).limit(1);
    return l ? l.onHand - l.reserved : 0;
  };
  if ((await avail(a.branchId)) >= a.qty) return a.branchId;
  const [ho] = await tx.select().from(branches).where(eq(branches.type, 'head_office')).limit(1);
  // Gudang Pusat hanya melayani cabang di negara yang sama (tidak ada pengiriman lintas negara)
  if (ho && ho.countryCode === (await branchCountry(a.branchId)) && (await avail(ho.id)) >= a.qty) return ho.id;
  throw new HttpError(409, 'Stok produk tidak tersedia di cabang maupun Gudang Pusat. Minta Gudang Pusat menambah stok sebelum menyetujui.');
}

export async function hqDecide(actor: AuthUser, id: string, d: { decision: 'approve' | 'reject' | 'return'; notes: string; tenor?: number; dpPct?: number }) {
  if (actor.roleCode !== 'biz-mgr') throw new HttpError(403, 'Keputusan kredit oleh Business Manager Pusat');
  const a = await loadApp(id);
  assertStatus(a, ['hq_review'], 'diputuskan');

  if (d.decision !== 'approve') {
    const to: Status = d.decision === 'reject' ? 'rejected' : 'assigned';
    return db.transaction(async (tx) => {
      await tx.delete(creditHqVotes).where(eq(creditHqVotes.applicationId, a.id));
      const after = await update(tx, a, { decidedBy: actor.id, decisionNotes: d.notes, decidedAt: new Date(), status: to, ...(to === 'rejected' ? { closedReason: d.notes } : {}) });
      await event(tx, a, actor, d.decision === 'reject' ? 'hq_reject' : 'hq_return', d.notes, to);
      await notifyWhere(tx, or(roleAt('branch-manager', a.branchId), a.aoId ? eq(users.id, a.aoId) : sql`false`)!, actor.id,
        `${a.appNo} ${d.decision === 'reject' ? 'DITOLAK' : 'dikembalikan'} oleh Business Manager`, d.notes);
      return { application: after, committeePending: false };
    });
  }

  const tenor = d.tenor ?? a.tenor ?? a.aoSuggestedTenor ?? a.requestedTenor;
  const dpPct = d.dpPct ?? a.dpPct ?? a.aoSuggestedDpPct ?? a.requestedDpPct;
  const terms = await computeTerms(a.cashPrice, tenor, dpPct, await branchCountry(a.branchId));

  return db.transaction(async (tx) => {
    await tx.insert(creditHqVotes).values({ applicationId: a.id, userId: actor.id, decision: 'approve', notes: d.notes })
      .onConflictDoUpdate({ target: [creditHqVotes.applicationId, creditHqVotes.userId], set: { decision: 'approve', notes: d.notes, createdAt: new Date() } });
    const [{ n }] = await tx.select({ n: count() }).from(creditHqVotes).where(and(eq(creditHqVotes.applicationId, a.id), eq(creditHqVotes.decision, 'approve')));
    const termPatch = {
      tenor, dpPct, downPayment: terms.downPayment, financed: terms.financed, marginPct: terms.marginPct, marginAmount: terms.marginAmount,
      salePrice: terms.salePrice, monthly: terms.monthly, requiresCommittee: terms.requiresCommittee,
    };
    if (terms.requiresCommittee && n < 2) {
      const after = await update(tx, a, termPatch);
      await event(tx, a, actor, 'committee_vote', `Setuju (1 dari 2 suara komite — pembiayaan melebihi batas wewenang): ${d.notes}`);
      await notifyWhere(tx, eq(users.roleCode, 'biz-mgr'), actor.id, `${a.appNo} butuh suara komite kedua`, `Disetujui ${actor.fullName}; menunggu persetujuan Business Manager lain.`);
      return { application: after, committeePending: true };
    }
    const fulfillBranchId = await pickFulfillBranch(tx, a);
    await reserveStock(tx, a.productId, fulfillBranchId, a.qty, { refType: 'credit', refId: a.id, refNo: a.appNo }, actor.id);
    const after = await update(tx, a, { ...termPatch, fulfillBranchId, decidedBy: actor.id, decisionNotes: d.notes, decidedAt: new Date(), status: 'approved' });
    await event(tx, a, actor, 'hq_approve', `Disetujui: tenor ${tenor} bln, DP ${dpPct}%, angsuran ${terms.monthly.toLocaleString('id-ID')}/bln. ${d.notes}`, 'approved');
    await notifyWhere(tx, or(roleAt('branch-manager', a.branchId), a.aoId ? eq(users.id, a.aoId) : sql`false`)!, actor.id,
      `${a.appNo} DISETUJUI — jadwalkan akad`, `Angsuran ${terms.monthly.toLocaleString('id-ID')} × ${tenor} bln`);
    return { application: after, committeePending: false };
  });
}

// ---------------------------------------------------------------------------
// 7. Akad & uang muka -> 8. Serah terima & jadwal angsuran
// ---------------------------------------------------------------------------
export interface DeliveryChoice { mode: DeliveryMode; address: string; city: string; postalCode?: string | null; courierCode?: string | null; service?: string | null }

async function productLogistics(productId: string, qty: number) {
  const [p] = await db.select({ name: products.name, weightKg: products.weightKg, isBulky: products.isBulky, requiresInstallation: products.requiresInstallation })
    .from(products).where(eq(products.id, productId)).limit(1);
  return { name: p.name, weightKg: p.weightKg * qty, isBulky: p.isBulky, installCount: p.requiresInstallation ? qty : 0, needsInstallation: p.requiresInstallation };
}

/** Kuotasi pengiriman untuk pengajuan yang sudah disetujui (dipakai saat akad). */
export async function creditDeliveryQuote(a: CreditApplication, destCity: string, destPostalCode?: string | null) {
  if (!a.fulfillBranchId) throw new HttpError(409, 'Stok belum direservasi');
  const lg = await productLogistics(a.productId, a.qty);
  const { quoteOptions } = await import('./shipping.js');
  return quoteOptions({ fromBranchId: a.fulfillBranchId, destCity, destPostalCode, itemName: lg.name, weightKg: lg.weightKg, isBulky: lg.isBulky, installCount: lg.installCount, subtotal: a.cashPrice });
}

/**
 * Akad ditandatangani AO / Manager Cabang. Uang muka + ongkir TIDAK lagi diterima AO: sistem menerbitkan tagihan
 * yang dibayar di Kasir (tunai/transfer, tercatat di shift) atau online (VA/QRIS/FPX). Akad berlaku (status
 * "contracted") dan pengiriman dibuat setelah uang muka lunas.
 */
export type DpChannel = 'cashier' | 'va' | 'qris' | 'fpx';
export async function signContract(actor: AuthUser, id: string, p: { delivery: DeliveryChoice; dpChannel?: DpChannel; bank?: VaBank | null }) {
  const a = await loadApp(id);
  if (!['ao', 'branch-manager'].includes(actor.roleCode) || actor.branch?.id !== a.branchId) throw new HttpError(403, 'Akad dicatat AO / Manager Cabang');
  assertStatus(a, ['approved'], 'diakadkan');
  if (a.contractNo) throw new HttpError(409, `Akad ${a.contractNo} sudah ditandatangani — menunggu uang muka`);
  const lg = await productLogistics(a.productId, a.qty);
  const opt = await resolveOption({ fromBranchId: a.fulfillBranchId!, destCity: p.delivery.city, destPostalCode: p.delivery.postalCode, itemName: lg.name, weightKg: lg.weightKg, isBulky: lg.isBulky, installCount: lg.installCount, subtotal: a.cashPrice },
    p.delivery.mode, p.delivery.courierCode, p.delivery.service);
  if (p.delivery.mode !== 'pickup' && p.delivery.address.trim().length < 10) throw new HttpError(400, 'Isi alamat pengiriman lengkap');
  const due = round2((a.downPayment ?? 0) + opt.fee);
  return db.transaction(async (tx) => {
    const contractNo = await nextNo(tx, 'AKD');
    const after = await update(tx, a, {
      contractNo, contractSignedAt: new Date(), contractSignedBy: actor.id, shippingFee: opt.fee,
      deliveryPlan: { mode: p.delivery.mode, address: p.delivery.address, city: p.delivery.city, postalCode: p.delivery.postalCode ?? null, courierCode: opt.courierCode ?? null, service: opt.service ?? null, label: opt.label },
    });
    const pay = await issueDownPayment(tx, after, p.dpChannel ?? 'cashier', p.bank ?? null);
    await event(tx, a, actor, 'contract', `Akad ${contractNo} ditandatangani. Tagihan uang muka + ongkir ${due.toLocaleString('id-ID')} (${pay.channel === 'cashier' ? 'bayar di kasir cabang' : pay.method.toUpperCase()}) — akad berlaku setelah lunas. Pengiriman: ${opt.label}`);
    await notifyWhere(tx, roleAt('cashier', a.branchId), actor.id, `Uang muka ${contractNo} menunggu pembayaran`, `${due.toLocaleString('id-ID')} — terima di menu "Terima Uang Muka"`);
    const c = await customerContact(tx, a.customerId);
    await notifyCustomer(tx, c, 'dp_due', { name: c.name, contractNo, amount: money(due, a.currency), link: links.credit(a.appNo), expires: pay.expiresAt ? when(pay.expiresAt) : null, ...payVars(pay.channel === 'cashier' ? { method: 'cashier' } : pay) }, { type: 'payment', id: pay.id, dedupe: `dpdue:${pay.id}` });
    return { ...after, dpPayment: pay };
  });
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Terbitkan (ulang) tagihan uang muka + ongkir. Tagihan lama yang belum dibayar dibatalkan. */
async function issueDownPayment(tx: Tx, a: CreditApplication, channel: DpChannel, bank: VaBank | null) {
  if (!a.contractNo) throw new HttpError(409, 'Akad belum ditandatangani');
  if (a.dpPaidAt) throw new HttpError(409, 'Uang muka sudah dibayar');
  await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'down_payment'), eq(payments.refId, a.id), eq(payments.status, 'pending')));
  const amount = round2((a.downPayment ?? 0) + (a.shippingFee ?? 0));
  const { nextPaymentNo, getPaymentGateway } = await import('./payments.js');
  const paymentNo = await nextPaymentNo(tx);
  const days = Number(await getConfig<number>('credit.approval_valid_days', await branchCountry(a.branchId))) || 14;
  const validUntil = new Date((a.decidedAt ?? new Date()).getTime() + days * 86400_000);
  if (channel === 'cashier') {
    const [p] = await tx.insert(payments).values({ paymentNo, kind: 'down_payment', refId: a.id, refNo: a.contractNo, branchId: a.branchId, amount, method: 'cash', status: 'pending', channel: 'cashier',
      expiresAt: validUntil, note: `Uang muka ${Number(a.downPayment).toLocaleString('id-ID')} + ongkir ${Number(a.shippingFee ?? 0).toLocaleString('id-ID')}` }).returning();
    return p;
  }
  const cc = await branchCountry(a.branchId);
  const gw = getPaymentGateway(cc);
  if (!gw.methods.includes(channel)) throw new HttpError(400, `Metode ${channel.toUpperCase()} tidak tersedia di negara ini — bayar di kasir cabang`);
  const [cust] = await tx.select().from(customers).where(eq(customers.id, a.customerId)).limit(1);
  const expiresAt = new Date(Math.min(validUntil.getTime(), Date.now() + 48 * 3600_000));
  const charge = await gw.createCharge({ paymentNo, amount, method: channel, bank, customerName: cust.fullName, customerPhone: cust.phone ? e164(cust.phone, cc) : null, customerEmail: cust.email, expiresAt, currency: a.currency, returnUrl: links.credit(a.appNo) });
  const [p] = await tx.insert(payments).values({ paymentNo, kind: 'down_payment', refId: a.id, refNo: a.contractNo, branchId: a.branchId, amount, method: channel, status: 'pending', channel: 'gateway',
    vaNumber: charge.vaNumber, bank: charge.bank, qrString: charge.qrString, qrUrl: charge.qrUrl, payUrl: charge.payUrl ?? null, gatewayRef: charge.gatewayRef, expiresAt: charge.expiresAt,
    note: 'Uang muka + ongkir akad' }).returning();
  return p;
}

/** Terbitkan ulang tagihan uang muka (ganti metode / tagihan kedaluwarsa) — staf cabang atau nasabah sendiri. */
export async function reissueDownPayment(actor: AuthUser | null, id: string, channel: DpChannel, bank: VaBank | null) {
  const a = await loadApp(id);
  if (actor && !(['ao', 'branch-manager', 'cashier', 'branch-admin'].includes(actor.roleCode) && actor.branch?.id === a.branchId)) throw new HttpError(403, 'Bukan pembiayaan cabang Anda');
  assertStatus(a, ['approved'], 'dibayar uang mukanya');
  return db.transaction((tx) => issueDownPayment(tx, a, channel, bank));
}

/** Kasir menerima uang muka + ongkir (tunai masuk shift / transfer dengan referensi). */
export async function payDownPaymentAtCashier(actor: AuthUser, id: string, p: { method: 'cash' | 'transfer'; proofRef?: string | null }) {
  if (actor.roleCode !== 'cashier') throw new HttpError(403, 'Uang muka diterima Kasir');
  const a = await loadApp(id);
  if (actor.branch?.type === 'branch' && actor.branch.id !== a.branchId) throw new HttpError(403, 'Pembiayaan bukan milik cabang Anda');
  assertStatus(a, ['approved'], 'dibayar uang mukanya');
  if (!a.contractNo) throw new HttpError(409, 'Akad belum ditandatangani AO / Manager Cabang');
  if (p.method === 'transfer' && !p.proofRef) throw new HttpError(400, 'Isi nomor referensi transfer');
  const { cashShiftFor } = await import('./finance.js');
  const { nextPaymentNo, confirmPayment } = await import('./payments.js');
  return db.transaction(async (tx) => {
    // Kunci akad: uang muka tidak bisa diterima dua kali (klik ganda / dua kasir)
    const [cur] = await tx.select().from(creditApplications).where(eq(creditApplications.id, a.id)).for('update').limit(1);
    if (!cur || cur.status !== 'approved' || cur.dpPaidAt) throw new HttpError(409, 'Uang muka akad ini sudah diterima / akad ditutup');
    await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'down_payment'), eq(payments.refId, a.id), eq(payments.status, 'pending')));
    const shiftId = p.method === 'cash' ? await cashShiftFor(actor, tx) : null;
    const paymentNo = await nextPaymentNo(tx);
    await tx.insert(payments).values({ paymentNo, kind: 'down_payment', refId: a.id, refNo: a.contractNo!, branchId: a.branchId, amount: round2((a.downPayment ?? 0) + (a.shippingFee ?? 0)),
      method: p.method, status: 'pending', channel: 'cashier', proofRef: p.proofRef ?? null, shiftId, note: 'Uang muka + ongkir akad' });
    return confirmPayment(paymentNo, actor, undefined, tx);
  });
}

// Uang muka lunas -> akad berlaku, pengiriman dibuat dari rencana saat akad
onDownPaymentPaid(async (tx, p, actor) => {
  const [a] = await tx.select().from(creditApplications).where(eq(creditApplications.id, p.refId)).for('update').limit(1);
  if (!a || a.status !== 'approved' || a.dpPaidAt) return false;
  const plan = a.deliveryPlan;
  if (!plan) throw new HttpError(409, 'Rencana pengiriman akad tidak ditemukan');
  const [cust] = await tx.select().from(customers).where(eq(customers.id, a.customerId)).limit(1);
  const lg = await productLogistics(a.productId, a.qty);
  await update(tx, a, { dpPaidAmount: p.amount, dpPaidAt: p.paidAt ?? new Date(), dpMethod: p.method, dpRef: p.proofRef ?? p.gatewayRef ?? p.paymentNo, status: 'contracted' });
  await createShipment(tx, {
    sourceType: 'credit', sourceId: a.id, sourceNo: a.contractNo!, branchId: a.branchId, fromBranchId: a.fulfillBranchId!, mode: plan.mode as DeliveryMode,
    recipientName: cust.fullName, recipientPhone: cust.phone ?? '', address: plan.address, city: plan.city, postalCode: plan.postalCode,
    itemsSummary: `${lg.name} × ${a.qty}`, weightKg: lg.weightKg, isBulky: lg.isBulky, needsInstallation: lg.needsInstallation,
    shippingFee: a.shippingFee ?? 0, courierCode: plan.courierCode, courierService: plan.service,
  });
  await event(tx, a, actor, 'dp_paid', `Uang muka + ongkir ${p.amount.toLocaleString('id-ID')} diterima (${p.paymentNo}, ${p.method}). Akad berlaku — pengiriman dibuat (${plan.label}).`, 'contracted');
  await notifyWhere(tx, or(roleAt('branch-admin', a.branchId), roleAt('branch-manager', a.branchId), a.aoId ? eq(users.id, a.aoId) : sql`false`)!, actor?.id ?? null,
    `${a.contractNo} uang muka lunas — siapkan pengiriman`, plan.label);
});

function addMonths(d: Date, m: number) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + m, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Serah terima: stok keluar dari reservasi, jadwal angsuran dibuat, pembiayaan aktif. */
async function completeHandover(tx: Tx, a: CreditApplication, actor: AuthUser | null, method: string, note: string | null) {
  const startsOnHandover = await getConfig<boolean>('credit.installment_starts_on_handover', await branchCountry(a.branchId));
  await commitReservedOut(tx, a.productId, a.fulfillBranchId!, a.qty, { refType: 'credit', refId: a.id, refNo: a.contractNo ?? a.appNo }, actor?.id);
  const base = startsOnHandover ? new Date() : (a.contractSignedAt ?? new Date());
  const n = a.tenor!;
  const monthly = a.monthly!;
  const sale = a.salePrice!;
  const rows = Array.from({ length: n }, (_, i) => ({
    applicationId: a.id, seq: i + 1, dueDate: ymd(addMonths(base, i + 1)),
    amount: i === n - 1 ? Math.round((sale - monthly * (n - 1)) * 100) / 100 : monthly,
  }));
  await tx.insert(installments).values(rows);
  const after = await update(tx, a, { handoverAt: new Date(), handoverBy: actor?.id ?? null, handoverMethod: method, handoverNote: note, status: 'active' });
  await event(tx, a, actor, 'handover', `Barang diterima nasabah (${method}). Angsuran pertama jatuh tempo ${rows[0].dueDate}`, 'active');
  await notifyWhere(tx, or(roleAt('branch-manager', a.branchId), a.aoId ? eq(users.id, a.aoId) : sql`false`)!, actor?.id ?? null, `${a.appNo} aktif — barang diterima nasabah`, `Angsuran pertama ${rows[0].dueDate}`);
  return after;
}

// Pengiriman kredit selesai (POD / kode pickup) -> serah terima otomatis
onShipmentDelivered('credit', async (tx, s, actor) => {
  const a = await loadApp(s.sourceId, tx);
  if (a.status === 'contracted') await completeHandover(tx, a, actor, s.mode, s.podNote ?? `Diterima ${s.podName}`);
});

/** Serah terima manual (tanpa modul pengiriman) — hanya bila belum ada pengiriman tercatat. */
export async function handover(actor: AuthUser, id: string, p: { method: 'pickup' | 'internal' | 'partner'; note?: string | null }) {
  const a = await loadApp(id);
  if (actor.roleCode !== 'branch-admin' || actor.branch?.id !== a.branchId) throw new HttpError(403, 'Serah terima dicatat Admin Cabang');
  assertStatus(a, ['contracted'], 'diserahterimakan');
  const [sh] = await db.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.sourceType, 'credit'), eq(shipments.sourceId, a.id))).limit(1);
  if (sh) throw new HttpError(409, 'Pengajuan ini memiliki pengiriman — selesaikan melalui menu Pengiriman (bukti terima / kode pickup)');
  return db.transaction((tx) => completeHandover(tx, a, actor, p.method, p.note ?? null));
}

/** Pembatalan otomatis persetujuan yang tidak diakadkan dalam batas waktu. */
export async function expireStaleApprovals() {
  // Batas waktu mengikuti parameter negara cabang (Indonesia / Malaysia / Brunei bisa berbeda)
  const candidates = await db.select().from(creditApplications)
    .where(and(eq(creditApplications.status, 'approved'), sql`${creditApplications.decidedAt} < now() - interval '1 day'`));
  const daysOf = new Map<string, number>();
  const stale: typeof candidates = [];
  for (const a of candidates) {
    const cc = await branchCountry(a.branchId);
    if (!daysOf.has(cc)) daysOf.set(cc, Number(await getConfig<number>('credit.approval_valid_days', cc)) || 14);
    if (a.decidedAt && a.decidedAt.getTime() < Date.now() - daysOf.get(cc)! * 86400_000) stale.push(a);
  }
  for (const a of stale) {
    const days = daysOf.get(await branchCountry(a.branchId))!;
    // Bila uang muka baru saja dibayar (status berubah), lewati — jangan hentikan pemrosesan akad lain
    await db.transaction(async (tx) => {
      if (a.fulfillBranchId) await releaseStock(tx, a.productId, a.fulfillBranchId, a.qty, { refType: 'credit', refId: a.id, refNo: a.appNo });
      await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'down_payment'), eq(payments.refId, a.id), eq(payments.status, 'pending')));
      await update(tx, a, { status: 'cancelled', closedReason: `Kedaluwarsa: akad & uang muka tidak diselesaikan dalam ${days} hari` });
      await event(tx, a, null, 'cancelled', `Persetujuan kedaluwarsa (${days} hari tanpa akad); reservasi stok dilepas`, 'cancelled');
    }).catch((e) => { if (!(e instanceof HttpError && e.status === 409)) throw e; });
  }
  return stale.length;
}

export async function cancelApplication(actor: AuthUser, id: string, reason: string) {
  const a = await loadApp(id);
  const allowed = (actor.roleCode === 'branch-manager' && actor.branch?.id === a.branchId) || actor.roleCode === 'biz-mgr' || (actor.roleCode === 'ao' && a.aoId === actor.id);
  if (!allowed) throw new HttpError(403, 'Tidak berwenang membatalkan pengajuan ini');
  assertStatus(a, ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved'], 'dibatalkan');
  return db.transaction(async (tx) => {
    if (a.status === 'approved' && a.fulfillBranchId) await releaseStock(tx, a.productId, a.fulfillBranchId, a.qty, { refType: 'credit', refId: a.id, refNo: a.appNo }, actor.id);
    await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.kind, 'down_payment'), eq(payments.refId, a.id), eq(payments.status, 'pending')));
    const after = await update(tx, a, { status: 'cancelled', closedReason: reason });
    await event(tx, a, actor, 'cancelled', reason, 'cancelled');
    return after;
  });
}

// ---------------------------------------------------------------------------
// Iqalah: pembatalan akad atas kesepakatan setelah barang diterima nasabah
// ---------------------------------------------------------------------------
async function iqalahNo(tx: Tx | typeof db) { return nextNo(tx, 'IQL'); }

/** Total yang sudah dibayar nasabah atas harga barang: uang muka (tanpa ongkir) + angsuran. */
export async function paidTowardsGoods(a: CreditApplication, tx: Tx | typeof db = db) {
  const [{ v }] = await tx.select({ v: sql<number>`coalesce(sum(${installments.paidAmount}), 0)::float` }).from(installments).where(eq(installments.applicationId, a.id));
  return round2(Math.max(0, (a.dpPaidAmount ?? 0) - (a.shippingFee ?? 0)) + Number(v));
}

export async function requestIqalah(actor: AuthUser, id: string, p: { reason: string; proposedDepreciation?: number | null }) {
  const a = await loadApp(id);
  if (!(['branch-manager', 'branch-admin'].includes(actor.roleCode) && actor.branch?.id === a.branchId)) throw new HttpError(403, 'Iqalah diajukan Manager / Admin Cabang');
  assertStatus(a, ['active'], 'dibatalkan (iqalah)');
  const [open] = await db.select({ id: iqalahRequests.id }).from(iqalahRequests).where(and(eq(iqalahRequests.applicationId, a.id), inArray(iqalahRequests.status, ['requested', 'approved']))).limit(1);
  if (open) throw new HttpError(409, 'Masih ada pengajuan iqalah yang berjalan untuk akad ini');
  const paid = await paidTowardsGoods(a);
  const dep = round2(Math.min(paid, p.proposedDepreciation ?? 0));
  return db.transaction(async (tx) => {
    const [q] = await tx.insert(iqalahRequests).values({ iqalahNo: await iqalahNo(tx), applicationId: a.id, branchId: a.branchId, reason: p.reason, depreciation: dep, paidByCustomer: paid,
      refundAmount: round2(paid - dep), requestedBy: actor.id }).returning();
    await event(tx, a, actor, 'iqalah_requested', `Pengajuan iqalah ${q.iqalahNo}: ${p.reason}. Dana dibayar nasabah ${paid.toLocaleString('id-ID')}, usulan penurunan nilai ${dep.toLocaleString('id-ID')}`);
    await notifyWhere(tx, eq(users.roleCode, 'biz-mgr'), actor.id, `Iqalah ${q.iqalahNo} menunggu keputusan`, `${a.contractNo} — ${p.reason}`);
    return q;
  });
}

export async function decideIqalah(actor: AuthUser, iqId: string, p: { decision: 'approve' | 'reject'; depreciation?: number | null; note: string }) {
  if (actor.roleCode !== 'biz-mgr') throw new HttpError(403, 'Iqalah diputuskan Business Manager');
  const [q] = await db.select().from(iqalahRequests).where(eq(iqalahRequests.id, iqId)).limit(1);
  if (!q) throw new HttpError(404, 'Iqalah tidak ditemukan');
  if (q.status !== 'requested') throw new HttpError(409, 'Iqalah sudah diputuskan');
  const a = await loadApp(q.applicationId);
  return db.transaction(async (tx) => {
    if (p.decision === 'reject') {
      const [after] = await tx.update(iqalahRequests).set({ status: 'rejected', approvedBy: actor.id, approvedAt: new Date(), decisionNote: p.note, updatedAt: new Date() }).where(and(eq(iqalahRequests.id, q.id), eq(iqalahRequests.status, 'requested'))).returning();
      if (!after) throw new HttpError(409, 'Iqalah sudah diputuskan');
      await event(tx, a, actor, 'iqalah_rejected', `Iqalah ${q.iqalahNo} ditolak: ${p.note}`);
      return after;
    }
    assertStatus(a, ['active'], 'dibatalkan (iqalah)');
    const paid = await paidTowardsGoods(a, tx);
    const dep = round2(p.depreciation ?? q.depreciation);
    if (dep < 0 || dep > paid) throw new HttpError(400, `Penurunan nilai antara 0 dan ${paid.toLocaleString('id-ID')} (dana yang sudah dibayar nasabah)`);
    // Tagihan angsuran online yang belum dibayar ditutup agar tidak ada dana masuk setelah akad dibatalkan
    await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.refId, a.id), eq(payments.status, 'pending')));
    const [after] = await tx.update(iqalahRequests).set({ status: 'approved', depreciation: dep, paidByCustomer: paid, refundAmount: round2(paid - dep), approvedBy: actor.id, approvedAt: new Date(), decisionNote: p.note, updatedAt: new Date() })
      .where(and(eq(iqalahRequests.id, q.id), eq(iqalahRequests.status, 'requested'))).returning();
    if (!after) throw new HttpError(409, 'Iqalah sudah diputuskan');
    await event(tx, a, actor, 'iqalah_approved', `Iqalah ${q.iqalahNo} disetujui: penurunan nilai ${dep.toLocaleString('id-ID')}, dana dikembalikan ${(paid - dep).toLocaleString('id-ID')} setelah barang diterima kembali. ${p.note}`);
    await notifyWhere(tx, roleAt('branch-admin', a.branchId), actor.id, `Iqalah ${q.iqalahNo} disetujui — ambil barang dari nasabah`, a.contractNo ?? a.appNo);
    return after;
  });
}

/** Admin Cabang menerima barang kembali: akad batal, piutang dihapus, dana dikembalikan lewat Kasir. */
export async function receiveIqalah(actor: AuthUser, iqId: string, p: { condition: 'good' | 'damaged'; note?: string | null; refundMethod: 'cash' | 'transfer'; bankName?: string | null; accountNo?: string | null; accountName?: string | null }) {
  const [q] = await db.select().from(iqalahRequests).where(eq(iqalahRequests.id, iqId)).limit(1);
  if (!q) throw new HttpError(404, 'Iqalah tidak ditemukan');
  if (actor.roleCode !== 'branch-admin' || actor.branch?.id !== q.branchId) throw new HttpError(403, 'Barang diterima Admin Cabang');
  if (q.status !== 'approved') throw new HttpError(409, 'Iqalah belum disetujui atau sudah selesai');
  if (q.refundAmount > 0 && p.refundMethod === 'transfer' && !(p.bankName && p.accountNo && p.accountName)) throw new HttpError(400, 'Isi rekening tujuan pengembalian dana');
  const a = await loadApp(q.applicationId);
  assertStatus(a, ['active'], 'dibatalkan (iqalah)');
  const { financeNo, notifyRole } = await import('./finance.js');
  const { quarantineFromIqalah } = await import('./quarantine.js');
  const [sale] = await db.execute<{ meta: { cost: number } }>(sql`select meta from journal_entries where event = 'murabahah' and meta->>'creditId' = ${a.id} limit 1`).then((r) => r.rows);
  const cost = Number(sale?.meta?.cost ?? 0);
  const [cust] = await db.select().from(customers).where(eq(customers.id, a.customerId)).limit(1);
  return db.transaction(async (tx) => {
    // Kunci iqalah lebih dulu (cegah penerimaan ganda), lalu hitung ulang dana dari pembayaran terkini
    const [locked] = await tx.update(iqalahRequests).set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(iqalahRequests.id, q.id), eq(iqalahRequests.status, 'approved'))).returning();
    if (!locked) throw new HttpError(409, 'Iqalah sudah diselesaikan');
    const paidNow = await paidTowardsGoods(a, tx);
    if (Math.abs(paidNow - q.paidByCustomer) > 0.009) {
      q.paidByCustomer = paidNow;
      q.refundAmount = round2(Math.max(0, paidNow - q.depreciation));
      await tx.update(iqalahRequests).set({ paidByCustomer: paidNow, refundAmount: q.refundAmount }).where(eq(iqalahRequests.id, q.id));
    }
    const ref = { refType: 'iqalah', refId: q.id, refNo: q.iqalahNo };
    if (p.condition === 'good') await applyMovement(tx, { productId: a.productId, branchId: a.branchId, type: 'return_in', qty: a.qty, ...ref, note: `Barang kembali (iqalah ${a.contractNo})`, actorId: actor.id });
    else await quarantineFromIqalah(tx, { branchId: a.branchId, productId: a.productId, qty: a.qty, unitCost: round2((cost - q.depreciation) / a.qty), iqalahNo: q.iqalahNo, iqalahId: q.id, note: p.note?.trim() || `Barang iqalah ${a.contractNo} rusak`, actor });
    let refundId: string | null = null;
    if (q.refundAmount > 0) {
      const [rf] = await tx.insert(refunds).values({ refundNo: await financeNo(tx, 'RFD'), sourceType: 'iqalah', sourceId: q.id, sourceNo: q.iqalahNo, branchId: a.branchId, customerName: cust.fullName, customerPhone: cust.phone,
        amount: q.refundAmount, reason: `Iqalah akad ${a.contractNo}`, method: p.refundMethod, bankName: p.bankName ?? null, accountNo: p.accountNo ?? null, accountName: p.accountName ?? null,
        status: 'approved', requestedBy: actor.id, approvedBy: q.approvedBy, approvedAt: q.approvedAt }).returning();
      refundId = rf.id;
      await notifyRole(tx, 'cashier', a.branchId, `Pengembalian dana iqalah ${rf.refundNo} siap dibayarkan`, `${cust.fullName} · ${q.refundAmount.toLocaleString('id-ID')}`);
    }
    await tx.update(tazirCharges).set({ status: 'waived', waivedBy: actor.id, waiveReason: `Akad dibatalkan (iqalah ${q.iqalahNo})`, updatedAt: new Date() }).where(and(eq(tazirCharges.applicationId, a.id), eq(tazirCharges.status, 'unpaid')));
    const [after] = await tx.update(iqalahRequests).set({ status: 'completed', goodsCondition: p.condition, conditionNote: p.note ?? null, refundMethod: p.refundMethod, bankName: p.bankName ?? null, accountNo: p.accountNo ?? null,
      accountName: p.accountName ?? null, receivedBy: actor.id, receivedAt: new Date(), refundId, updatedAt: new Date() }).where(eq(iqalahRequests.id, q.id)).returning();
    await update(tx, a, { status: 'cancelled', closedReason: `Iqalah ${q.iqalahNo}: ${q.reason}` });
    await event(tx, a, actor, 'iqalah_completed', `Barang diterima kembali (${p.condition === 'good' ? 'kondisi baik, masuk stok' : 'rusak, masuk karantina'}). Akad dibatalkan; dana dikembalikan ${q.refundAmount.toLocaleString('id-ID')}.`, 'cancelled');
    return after;
  });
}
