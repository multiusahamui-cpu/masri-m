import React, { useEffect, useState } from 'react';
import { BarChart3, Ticket, Image as ImageIcon, Star, Megaphone, Plus, Pencil, Send, Ban, Users, ArrowUp, ArrowDown, X, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { AuthUser } from '../../types';
import { Card, ErrorBox, Spinner, Modal, PageHeader, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { BannerPreview } from '../HomeBanners';
import { Chip, CountrySelect, Empty, Flash, Pill, Stat, Th, errMsg, money, tbody, thead, today, useLoad } from '../common/kit';

type L3 = Partial<Record<'id' | 'ms' | 'en', string>>;
interface Promo {
  id: string; code: string; countryCode: string; name: string; description: string; type: 'percent' | 'amount'; value: number; maxDiscount: number | null; minPurchase: number;
  appliesTo: 'cash' | 'credit' | 'both'; categoryIds: string[]; productIds: string[]; quota: number | null; perCustomer: number; startsAt: string; endsAt: string; isActive: boolean; used: number; discountTotal: number;
}
interface Banner { id: string; countryCode: string; title: L3; subtitle: L3; imageUrl: string | null; theme: string; linkType: string; linkValue: string | null; sortOrder: number; startsAt: string; endsAt: string; isActive: boolean }
interface Campaign {
  id: string; name: string; countryCode: string; channel: 'whatsapp' | 'email' | 'both'; segment: { type: string; branchId?: string | null; sinceDays?: number | null }; subject: string; body: L3;
  promoId: string | null; promoCode: string | null; link: string | null; status: string; scheduledAt: string | null; sentAt: string | null; recipients: number; skipped: number; sent: number; failed: number; redemptions: number;
}
interface Report {
  currency: string; from: string; to: string; optIn: { opted: number; total: number };
  promos: { id: string; code: string; name: string; uses: number; orders: number; credits: number; discount: number; order_revenue: number; credit_value: number; converted_credits: number }[];
  campaigns: { id: string; name: string; sent_at: string | null; recipients: number; delivered: number; failed: number; redemptions: number; revenue: number }[];
}
interface Product { id: string; sku: string; name: string; cashPrice: number }

export const MARKETING_MENUS = ['report', 'promos', 'banners', 'featured', 'campaigns'] as const;
let mktCountry = 'ID';
const d10 = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');
const plus = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const LANGS: ['id' | 'ms' | 'en', string][] = [['id', 'Indonesia'], ['ms', 'Melayu'], ['en', 'English']];

/** Modul Marketing: laporan efektivitas, kode promo, banner beranda, produk unggulan, kampanye WA/email ke nasabah yang setuju. */
export const MarketingModule: React.FC<{ menu: string; currentUser: AuthUser }> = ({ menu, currentUser }) => {
  const [country, setCountry] = useState(mktCountry);
  const readOnly = currentUser.roleCode !== 'marketing';
  const pick = <CountrySelect value={country} onChange={(v) => { mktCountry = v; setCountry(v); }} />;
  if (menu === 'promos') return <Promos country={country} pick={pick} readOnly={readOnly} />;
  if (menu === 'banners') return <Banners country={country} pick={pick} readOnly={readOnly} />;
  if (menu === 'featured') return <Featured country={country} pick={pick} readOnly={readOnly} />;
  if (menu === 'campaigns') return <Campaigns country={country} pick={pick} readOnly={readOnly} />;
  return <ReportView country={country} pick={pick} />;
};

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------
const ReportView: React.FC<{ country: string; pick: React.ReactNode }> = ({ country, pick }) => {
  const [from, setFrom] = useState(plus(-30));
  const [to, setTo] = useState(today());
  const { data, error } = useLoad<Report>(`/marketing/report?country=${country}&from=${from}&to=${to}`);
  const tot = data?.promos.reduce((t, p) => ({ uses: t.uses + p.uses, discount: t.discount + p.discount, revenue: t.revenue + p.order_revenue + p.credit_value }), { uses: 0, discount: 0, revenue: 0 });
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<BarChart3 className="w-6 h-6" />} title="Efektivitas Promosi" subtitle="Pemakaian kode promo, nilai potongan, penjualan yang dihasilkan, dan hasil kampanye WhatsApp / email."
        actions={<>{pick}<input type="date" className={`${inputCls.replace("w-full", "")} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className={`${inputCls.replace("w-full", "")} w-40`} value={to} onChange={(e) => setTo(e.target.value)} /></>} />
      <ErrorBox message={error} />
      {!data ? <Spinner /> : <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Pemakaian kode promo" value={tot!.uses} />
          <Stat label="Total potongan diberikan" value={money(tot!.discount, country)} />
          <Stat label="Penjualan dengan promo" value={money(tot!.revenue, country)} hint="tunai dibayar + pembiayaan berakad" />
          <Stat label="Nasabah setuju terima promo" value={`${data.optIn.opted} / ${data.optIn.total}`} hint={data.optIn.total ? `${Math.round((data.optIn.opted / data.optIn.total) * 100)}% dari nasabah` : undefined} />
        </div>
        <Card className="overflow-x-auto">
          <h3 className="px-4 pt-4 font-semibold">Per kode promo</h3>
          <table className="w-full text-sm mt-2">
            <thead className={thead}><tr><Th>Kode</Th><Th right>Dipakai</Th><Th right>Tunai</Th><Th right>Pembiayaan</Th><Th right>Jadi akad</Th><Th right>Potongan</Th><Th right>Penjualan</Th><Th right>Rasio</Th></tr></thead>
            <tbody className={tbody}>
              {data.promos.length === 0 && <Empty cols={8}>Belum ada kode promo.</Empty>}
              {data.promos.map((p) => {
                const rev = p.order_revenue + p.credit_value;
                return <tr key={p.id}><td className="px-4 py-2"><span className="font-mono font-semibold">{p.code}</span><span className="block text-xs text-slate-500">{p.name}</span></td>
                  <td className="px-4 py-2 text-right">{p.uses}</td><td className="px-4 py-2 text-right">{p.orders}</td><td className="px-4 py-2 text-right">{p.credits}</td><td className="px-4 py-2 text-right">{p.converted_credits}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{money(p.discount, country)}</td><td className="px-4 py-2 text-right whitespace-nowrap">{money(rev, country)}</td>
                  <td className="px-4 py-2 text-right text-xs text-slate-500" title="Penjualan per 1 satuan potongan">{p.discount > 0 ? `${(rev / p.discount).toFixed(1)}×` : '—'}</td></tr>;
              })}
            </tbody>
          </table>
        </Card>
        <Card className="overflow-x-auto">
          <h3 className="px-4 pt-4 font-semibold">Kampanye terkirim</h3>
          <table className="w-full text-sm mt-2">
            <thead className={thead}><tr><Th>Kampanye</Th><Th right>Penerima</Th><Th right>Terkirim</Th><Th right>Gagal</Th><Th right>Pakai kode (≤14 hari)</Th><Th right>Konversi</Th><Th right>Penjualan tunai</Th></tr></thead>
            <tbody className={tbody}>
              {data.campaigns.length === 0 && <Empty cols={7}>Belum ada kampanye terkirim pada periode ini.</Empty>}
              {data.campaigns.map((c) => <tr key={c.id}><td className="px-4 py-2">{c.name}<span className="block text-xs text-slate-500">{formatDateTime(c.sent_at)}</span></td>
                <td className="px-4 py-2 text-right">{c.recipients}</td><td className="px-4 py-2 text-right">{c.delivered}</td><td className={`px-4 py-2 text-right ${c.failed ? 'text-red-600' : ''}`}>{c.failed}</td>
                <td className="px-4 py-2 text-right">{c.redemptions}</td><td className="px-4 py-2 text-right">{c.recipients ? `${((c.redemptions / c.recipients) * 100).toFixed(1)}%` : '—'}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{money(c.revenue, country)}</td></tr>)}
            </tbody>
          </table>
        </Card>
      </>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Kode promo
// ---------------------------------------------------------------------------
const PROMO_STATE = (p: Promo): string => !p.isActive ? 'off' : new Date(p.endsAt) < new Date() ? 'ended' : new Date(p.startsAt) > new Date() ? 'soon' : p.quota != null && p.used >= p.quota ? 'quota' : 'live';
const PROMO_PILL: Record<string, [string, string]> = { live: ['Berjalan', 'green'], soon: ['Terjadwal', 'blue'], ended: ['Berakhir', 'slate'], off: ['Nonaktif', 'slate'], quota: ['Kuota habis', 'amber'] };
const APPLIES: Record<string, string> = { cash: 'Belanja tunai', credit: 'Pembiayaan', both: 'Tunai & pembiayaan' };

const Promos: React.FC<{ country: string; pick: React.ReactNode; readOnly: boolean }> = ({ country, pick, readOnly }) => {
  const { data, error, setError, reload } = useLoad<{ promos: Promo[] }>(`/marketing/promos?country=${country}`);
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Ticket className="w-6 h-6" />} title="Kode Promo & Voucher"
        subtitle="Potongan harga barang (bukan potongan margin): dihitung sebelum akad sehingga harga jual murabahah tetap pasti. Dipakai di checkout tunai dan pengajuan pembiayaan."
        actions={<>{pick}{!readOnly && <button className={btnPrimary} onClick={() => setEdit({ countryCode: country })}><Plus className="w-4 h-4" />Kode promo</button>}</>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>Kode</Th><Th>Potongan</Th><Th>Berlaku untuk</Th><Th>Periode</Th><Th right>Dipakai</Th><Th right>Total potongan</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.promos.length === 0 && <Empty cols={8}>Belum ada kode promo.</Empty>}
              {data.promos.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3"><span className="font-mono font-bold">{p.code}</span><span className="block text-xs text-slate-500">{p.name}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap">{p.type === 'percent' ? `${p.value}%` : money(p.value, country)}{p.maxDiscount ? <span className="block text-xs text-slate-500">maks. {money(p.maxDiscount, country)}</span> : null}{p.minPurchase > 0 && <span className="block text-xs text-slate-500">min. {money(p.minPurchase, country)}</span>}</td>
                  <td className="px-4 py-3 text-xs">{APPLIES[p.appliesTo]}{(p.productIds.length > 0 || p.categoryIds.length > 0) && <span className="block text-slate-500">{p.productIds.length ? `${p.productIds.length} produk` : `${p.categoryIds.length} kategori`}</span>}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{d10(p.startsAt)} – {d10(p.endsAt)}</td>
                  <td className="px-4 py-3 text-right">{p.used}{p.quota != null && <span className="text-slate-500"> / {p.quota}</span>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(p.discountTotal, country)}</td>
                  <td className="px-4 py-3"><Pill map={PROMO_PILL} s={PROMO_STATE(p)} /></td>
                  <td className="px-4 py-3 text-right">{!readOnly && <button className="text-masri-primary" aria-label="Ubah" onClick={() => setEdit(p)}><Pencil className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <PromoForm init={edit} country={country} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
};

const useProducts = (country: string) => useLoad<{ products: Product[] }>(`/catalog/products?country=${country}&pageSize=60`);

const PromoForm: React.FC<{ init: Partial<Promo>; country: string; onClose: () => void; onDone: () => void }> = ({ init, country, onClose, onDone }) => {
  const { data: cats } = useLoad<{ categories: { id: string; name: string }[] }>('/catalog/categories');
  const { data: prods } = useProducts(country);
  const [f, setF] = useState({
    code: init.code ?? '', name: init.name ?? '', description: init.description ?? '', type: init.type ?? 'percent', value: String(init.value ?? ''), maxDiscount: init.maxDiscount ? String(init.maxDiscount) : '',
    minPurchase: String(init.minPurchase ?? 0), appliesTo: init.appliesTo ?? 'both', categoryIds: init.categoryIds ?? [], productIds: init.productIds ?? [], quota: init.quota ? String(init.quota) : '',
    perCustomer: String(init.perCustomer ?? 1), startsAt: d10(init.startsAt) || today(), endsAt: d10(init.endsAt) || plus(30), isActive: init.isActive ?? true,
  });
  const [scope, setScope] = useState<'all' | 'cat' | 'prod'>(f.productIds.length ? 'prod' : f.categoryIds.length ? 'cat' : 'all');
  const [err, setErr] = useState<string | null>(null);
  const used = (init.used ?? 0) > 0;
  const toggle = (k: 'categoryIds' | 'productIds', id: string) => setF((p) => ({ ...p, [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] }));
  const save = async () => {
    const body = { code: f.code, countryCode: country, name: f.name, description: f.description, type: f.type, value: Number(f.value), maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : null, minPurchase: Number(f.minPurchase) || 0,
      appliesTo: f.appliesTo, categoryIds: scope === 'cat' ? f.categoryIds : [], productIds: scope === 'prod' ? f.productIds : [], quota: f.quota ? Number(f.quota) : null, perCustomer: Number(f.perCustomer) || 1,
      startsAt: f.startsAt, endsAt: f.endsAt, isActive: f.isActive };
    try { if (init.id) await api.put(`/marketing/promos/${init.id}`, body); else await api.post('/marketing/promos', body); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={init.id ? `Ubah promo ${init.code}` : 'Kode promo baru'} onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox message={err} />
        {used && <p className="text-xs text-amber-600">Promo sudah dipakai {init.used}× — kode, jenis & nilai potongan dikunci. Buat kode baru bila ingin mengubah besaran potongan.</p>}
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className={labelCls}>Kode</label><input className={`${inputCls} font-mono uppercase`} disabled={used} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} placeholder="HEMAT10" /></div>
          <div className="md:col-span-2"><label className={labelCls}>Nama promo</label><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="md:col-span-3"><label className={labelCls}>Keterangan (tampil ke nasabah)</label><input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div><label className={labelCls}>Jenis potongan</label><select className={inputCls} disabled={used} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'percent' })}><option value="percent">Persen</option><option value="amount">Nominal tetap</option></select></div>
          <div><label className={labelCls}>{f.type === 'percent' ? 'Persen (%)' : 'Nominal'}</label><input type="number" disabled={used} className={inputCls} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
          {f.type === 'percent' && <div><label className={labelCls}>Maks. potongan</label><input type="number" className={inputCls} value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} placeholder="tanpa batas" /></div>}
          <div><label className={labelCls}>Min. pembelian</label><input type="number" className={inputCls} value={f.minPurchase} onChange={(e) => setF({ ...f, minPurchase: e.target.value })} /></div>
          <div><label className={labelCls}>Berlaku untuk</label><select className={inputCls} value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value as 'both' })}>{Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className={labelCls}>Kuota total</label><input type="number" className={inputCls} value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} placeholder="tanpa batas" /></div>
          <div><label className={labelCls}>Maks. per nasabah</label><input type="number" min={1} className={inputCls} value={f.perCustomer} onChange={(e) => setF({ ...f, perCustomer: e.target.value })} /></div>
          <div><label className={labelCls}>Mulai</label><input type="date" className={inputCls} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
          <div><label className={labelCls}>Berakhir</label><input type="date" className={inputCls} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div>
        </div>
        <div>
          <label className={labelCls}>Produk yang mendapat potongan</label>
          <div className="flex gap-2 mb-2"><Chip on={scope === 'all'} onClick={() => setScope('all')}>Semua produk</Chip><Chip on={scope === 'cat'} onClick={() => setScope('cat')}>Kategori tertentu</Chip><Chip on={scope === 'prod'} onClick={() => setScope('prod')}>Produk tertentu</Chip></div>
          {scope === 'cat' && <div className="flex flex-wrap gap-2">{cats?.categories.map((c) => <Chip key={c.id} on={f.categoryIds.includes(c.id)} onClick={() => toggle('categoryIds', c.id)}>{c.name}</Chip>)}</div>}
          {scope === 'prod' && <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1">{prods?.products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => toggle('productIds', p.id)} />{p.sku} · {p.name}</label>))}</div>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Aktif</label>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={f.code.length < 3 || f.name.length < 3 || !(Number(f.value) > 0)} onClick={save}>Simpan</button></div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Banner beranda
// ---------------------------------------------------------------------------
const Banners: React.FC<{ country: string; pick: React.ReactNode; readOnly: boolean }> = ({ country, pick, readOnly }) => {
  const { data, error, setError, reload } = useLoad<{ banners: Banner[] }>(`/marketing/banners?country=${country}`);
  const [edit, setEdit] = useState<Partial<Banner> | null>(null);
  const off = async (b: Banner) => { if (!window.confirm('Nonaktifkan banner ini?')) return; try { await api.delete(`/marketing/banners/${b.id}`); reload(); } catch (e) { setError(errMsg(e)); } };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<ImageIcon className="w-6 h-6" />} title="Banner Beranda" subtitle="Banner promosi di halaman depan website, per negara & bahasa. Maksimal 6 banner aktif tampil berurutan."
        actions={<>{pick}{!readOnly && <button className={btnPrimary} onClick={() => setEdit({ countryCode: country, theme: 'emerald', linkType: 'none', title: {}, subtitle: {} })}><Plus className="w-4 h-4" />Banner</button>}</>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!data ? <Spinner /> : data.banners.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">Belum ada banner.</Card> : (
        <div className="grid md:grid-cols-2 gap-4">
          {data.banners.map((b) => {
            const live = b.isActive && new Date(b.startsAt) <= new Date() && new Date(b.endsAt) >= new Date();
            return (
              <Card key={b.id} className={`overflow-hidden ${b.isActive ? '' : 'opacity-50'}`}>
                <BannerPreview b={b} />
                <div className="p-3 flex items-center justify-between text-xs">
                  <span>{live ? <span className="text-green-600 font-semibold">Tayang</span> : b.isActive ? 'Terjadwal / berakhir' : 'Nonaktif'} · {d10(b.startsAt)} – {d10(b.endsAt)} · urutan {b.sortOrder}</span>
                  {!readOnly && <span className="flex gap-3"><button className="text-masri-primary" aria-label="Ubah" onClick={() => setEdit(b)}><Pencil className="w-4 h-4" /></button>{b.isActive && <button className="text-red-500" aria-label="Nonaktifkan" onClick={() => off(b)}><Trash2 className="w-4 h-4" /></button>}</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <BannerForm init={edit} country={country} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
};

const BannerForm: React.FC<{ init: Partial<Banner>; country: string; onClose: () => void; onDone: () => void }> = ({ init, country, onClose, onDone }) => {
  const { data: prods } = useProducts(country);
  const { data: promos } = useLoad<{ promos: Promo[] }>(`/marketing/promos?country=${country}`);
  const { data: cats } = useLoad<{ categories: { id: string; code: string; name: string }[] }>('/catalog/categories');
  const [f, setF] = useState({ title: init.title ?? {}, subtitle: init.subtitle ?? {}, imageUrl: init.imageUrl ?? '', theme: init.theme ?? 'emerald', linkType: init.linkType ?? 'none', linkValue: init.linkValue ?? '',
    sortOrder: String(init.sortOrder ?? 0), startsAt: d10(init.startsAt) || today(), endsAt: d10(init.endsAt) || plus(30), isActive: init.isActive ?? true });
  const [lang, setLang] = useState<'id' | 'ms' | 'en'>('id');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const body = { countryCode: country, title: f.title, subtitle: f.subtitle, imageUrl: f.imageUrl || null, theme: f.theme, linkType: f.linkType, linkValue: f.linkType === 'none' ? null : f.linkValue || null,
      sortOrder: Number(f.sortOrder) || 0, startsAt: f.startsAt, endsAt: f.endsAt, isActive: f.isActive };
    try { if (init.id) await api.put(`/marketing/banners/${init.id}`, body); else await api.post('/marketing/banners', body); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={init.id ? 'Ubah banner' : 'Banner baru'} onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox message={err} />
        <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700"><BannerPreview b={{ ...f, imageUrl: f.imageUrl || null }} lang={lang} /></div>
        <div className="flex gap-2">{LANGS.map(([k, v]) => <Chip key={k} on={lang === k} onClick={() => setLang(k)}>{v}{f.title[k] ? ' ✓' : ''}</Chip>)}</div>
        <div><label className={labelCls}>Judul ({lang})</label><input className={inputCls} value={f.title[lang] ?? ''} onChange={(e) => setF({ ...f, title: { ...f.title, [lang]: e.target.value } })} /></div>
        <div><label className={labelCls}>Subjudul ({lang})</label><input className={inputCls} value={f.subtitle[lang] ?? ''} onChange={(e) => setF({ ...f, subtitle: { ...f.subtitle, [lang]: e.target.value } })} /></div>
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className={labelCls}>Warna</label><select className={inputCls} value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })}><option value="emerald">Hijau</option><option value="gold">Emas</option><option value="dark">Gelap</option></select></div>
          <div className="md:col-span-2"><label className={labelCls}>URL gambar (opsional, https)</label><input className={inputCls} value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://..." /></div>
          <div><label className={labelCls}>Tombol mengarah ke</label><select className={inputCls} value={f.linkType} onChange={(e) => setF({ ...f, linkType: e.target.value, linkValue: '' })}>
            <option value="none">Tanpa tombol</option><option value="promo">Kode promo</option><option value="product">Produk</option><option value="category">Kategori</option><option value="url">Halaman / URL</option></select></div>
          <div className="md:col-span-2"><label className={labelCls}>Tujuan</label>
            {f.linkType === 'promo' ? <select className={inputCls} value={f.linkValue} onChange={(e) => setF({ ...f, linkValue: e.target.value })}><option value="">— pilih —</option>{promos?.promos.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</select>
              : f.linkType === 'product' ? <select className={inputCls} value={f.linkValue} onChange={(e) => setF({ ...f, linkValue: e.target.value })}><option value="">— pilih —</option>{prods?.products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
              : f.linkType === 'category' ? <select className={inputCls} value={f.linkValue} onChange={(e) => setF({ ...f, linkValue: e.target.value })}><option value="">— pilih —</option>{cats?.categories.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}</select>
              : <input className={inputCls} disabled={f.linkType === 'none'} value={f.linkValue} onChange={(e) => setF({ ...f, linkValue: e.target.value })} placeholder="#products atau https://..." />}</div>
          <div><label className={labelCls}>Urutan</label><input type="number" className={inputCls} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></div>
          <div><label className={labelCls}>Mulai</label><input type="date" className={inputCls} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
          <div><label className={labelCls}>Berakhir</label><input type="date" className={inputCls} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Aktif</label>
        <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={!Object.values(f.title).some(Boolean)} onClick={save}>Simpan</button></div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Produk unggulan
// ---------------------------------------------------------------------------
const LABELS: Record<string, string> = { featured: 'Unggulan', promo: 'Promo', new: 'Baru', bestseller: 'Terlaris' };
interface FItem { productId: string; name: string; sku: string; label: string }

const Featured: React.FC<{ country: string; pick: React.ReactNode; readOnly: boolean }> = ({ country, pick, readOnly }) => {
  const { data, error, setError } = useLoad<{ featured: (FItem & { rank: number })[] }>(`/marketing/featured?country=${country}`);
  const { data: prods } = useProducts(country);
  const [items, setItems] = useState<FItem[] | null>(null);
  const [add, setAdd] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { if (data) setItems(data.featured.map((f) => ({ productId: f.productId, name: f.name, sku: f.sku, label: f.label }))); }, [data]);
  const move = (i: number, d: number) => setItems((p) => { if (!p) return p; const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = async () => {
    try { await api.put('/marketing/featured', { countryCode: country, items: items!.map((i) => ({ productId: i.productId, label: i.label })) }); setFlash('Produk unggulan disimpan — tampil paling atas di katalog dengan label.'); } catch (e) { setError(errMsg(e)); }
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Star className="w-6 h-6" />} title="Produk Unggulan" subtitle="Produk yang ditampilkan paling atas di katalog dengan label (Unggulan / Promo / Baru / Terlaris). Urutan sesuai daftar."
        actions={<>{pick}{!readOnly && <button className={btnPrimary} disabled={!items} onClick={save}>Simpan urutan</button>}</>} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!items ? <Spinner /> : (
        <Card className="p-4 space-y-2">
          {items.length === 0 && <p className="text-sm text-slate-500">Belum ada produk unggulan.</p>}
          {items.map((it, i) => (
            <div key={it.productId} className="flex items-center gap-3 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
              <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
              <span className="flex-1 text-sm">{it.name}<span className="block text-xs text-slate-500">{it.sku}</span></span>
              <select className={`${inputCls} max-w-[140px]`} disabled={readOnly} value={it.label} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}>{Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {!readOnly && <><button aria-label="Naik" onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></button><button aria-label="Turun" onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                <button aria-label="Hapus" className="text-red-500" onClick={() => setItems(items.filter((_, k) => k !== i))}><X className="w-4 h-4" /></button></>}
            </div>
          ))}
          {!readOnly && items.length < 24 && (
            <div className="flex gap-2 pt-2">
              <select className={inputCls} value={add} onChange={(e) => setAdd(e.target.value)}><option value="">— tambah produk —</option>
                {prods?.products.filter((p) => !items.some((i) => i.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
              <button className={btnSecondary} disabled={!add} onClick={() => { const p = prods!.products.find((x) => x.id === add)!; setItems([...items, { productId: p.id, name: p.name, sku: p.sku, label: 'featured' }]); setAdd(''); }}><Plus className="w-4 h-4" />Tambah</button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Kampanye
// ---------------------------------------------------------------------------
const CAMP_STATUS: Record<string, [string, string]> = { draft: ['Draf', 'slate'], scheduled: ['Terjadwal', 'blue'], sending: ['Mengirim', 'amber'], sent: ['Terkirim', 'green'], cancelled: ['Dibatalkan', 'slate'] };
const SEGMENTS: Record<string, string> = { all: 'Semua nasabah yang setuju', buyers: 'Pernah belanja tunai', active_credit: 'Pembiayaan aktif (lancar)', paid_off: 'Pembiayaan sudah lunas', branch: 'Nasabah cabang tertentu' };
const CHANNELS: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Email', both: 'WhatsApp + Email' };

const Campaigns: React.FC<{ country: string; pick: React.ReactNode; readOnly: boolean }> = ({ country, pick, readOnly }) => {
  const { data, error, setError, reload } = useLoad<{ campaigns: Campaign[] }>(`/marketing/campaigns?country=${country}`);
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const send = async (c: Campaign) => {
    if (!window.confirm(`Kirim "${c.name}" sekarang ke nasabah yang setuju menerima promo?`)) return;
    try { const r = await api.post<{ campaign: Campaign }>(`/marketing/campaigns/${c.id}/send`); setFlash(`"${c.name}" diantrikan ke ${r.campaign.recipients} nasabah${r.campaign.skipped ? ` (${r.campaign.skipped} dilewati karena batas frekuensi)` : ''}.`); reload(); } catch (e) { setError(errMsg(e)); }
  };
  const cancel = async (c: Campaign) => { try { await api.post(`/marketing/campaigns/${c.id}/cancel`); reload(); } catch (e) { setError(errMsg(e)); } };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Megaphone className="w-6 h-6" />} title="Kampanye WhatsApp & Email"
        subtitle="Hanya dikirim ke nasabah yang menyetujui menerima promo (UU PDP / PDPA). Setiap pesan memuat tautan berhenti berlangganan; ada batas frekuensi per nasabah."
        actions={<>{pick}{!readOnly && <button className={btnPrimary} onClick={() => setEdit({ countryCode: country, channel: 'whatsapp', segment: { type: 'all' }, body: {} })}><Plus className="w-4 h-4" />Kampanye</button>}</>} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      <Card className="overflow-x-auto">
        {!data ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className={thead}><tr><Th>Kampanye</Th><Th>Sasaran</Th><Th>Kanal</Th><Th>Jadwal / dikirim</Th><Th right>Penerima</Th><Th right>Terkirim / gagal</Th><Th right>Pakai kode</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className={tbody}>
              {data.campaigns.length === 0 && <Empty cols={9}>Belum ada kampanye.</Empty>}
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">{c.name}<span className="block text-xs text-slate-500">{c.subject}{c.promoCode ? ` · kode ${c.promoCode}` : ''}</span></td>
                  <td className="px-4 py-3 text-xs">{SEGMENTS[c.segment.type] ?? c.segment.type}{c.segment.sinceDays ? ` (${c.segment.sinceDays} hari)` : ''}</td>
                  <td className="px-4 py-3 text-xs">{CHANNELS[c.channel]}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{c.sentAt ? formatDateTime(c.sentAt) : c.scheduledAt ? formatDateTime(c.scheduledAt) : '—'}</td>
                  <td className="px-4 py-3 text-right">{c.recipients || '—'}</td>
                  <td className="px-4 py-3 text-right">{c.status === 'sent' ? <>{c.sent}<span className={c.failed ? 'text-red-600' : 'text-slate-400'}> / {c.failed}</span></> : '—'}</td>
                  <td className="px-4 py-3 text-right">{c.redemptions || '—'}</td>
                  <td className="px-4 py-3"><Pill map={CAMP_STATUS} s={c.status} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {!readOnly && ['draft', 'scheduled'].includes(c.status) && <>
                      <button className="text-masri-primary mr-3" aria-label="Ubah" onClick={() => setEdit(c)}><Pencil className="w-4 h-4" /></button>
                      <button className={`${btnPrimary} inline-flex`} onClick={() => send(c)}><Send className="w-4 h-4" />Kirim</button>
                      <button className="ml-2 text-xs text-red-600 inline-flex items-center gap-1" onClick={() => cancel(c)}><Ban className="w-3 h-3" />Batal</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <CampaignForm init={edit} country={country} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
};

const CampaignForm: React.FC<{ init: Partial<Campaign>; country: string; onClose: () => void; onDone: () => void }> = ({ init, country, onClose, onDone }) => {
  const { data: promos } = useLoad<{ promos: Promo[] }>(`/marketing/promos?country=${country}`);
  const { data: br } = useLoad<{ branches: { id: string; code: string; name: string; type: string; countryCode: string }[] }>('/branches');
  const [f, setF] = useState({ name: init.name ?? '', channel: init.channel ?? 'whatsapp', segType: init.segment?.type ?? 'all', branchId: init.segment?.branchId ?? '', sinceDays: init.segment?.sinceDays ? String(init.segment.sinceDays) : '',
    subject: init.subject ?? '', body: init.body ?? {}, promoId: init.promoId ?? '', link: init.link ?? '', schedule: init.scheduledAt ? new Date(init.scheduledAt).toISOString().slice(0, 16) : '' });
  const [lang, setLang] = useState<'id' | 'ms' | 'en'>(country === 'ID' ? 'id' : 'ms');
  const [aud, setAud] = useState<{ optedIn: number; reachable: number; frequencyCapped: number; minDaysBetween: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const segment = { type: f.segType, branchId: f.segType === 'branch' ? f.branchId || null : null, sinceDays: f.sinceDays ? Number(f.sinceDays) : null };
  const segKey = JSON.stringify(segment) + f.channel;
  useEffect(() => {
    if (f.segType === 'branch' && !f.branchId) { setAud(null); return; }
    const t = setTimeout(() => { api.post<typeof aud>('/marketing/audience', { countryCode: country, segment, channel: f.channel }).then(setAud).catch(() => setAud(null)); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey, country]);
  const promo = promos?.promos.find((p) => p.id === f.promoId);
  const preview = (f.body[lang] ?? '').replace(/\{nama\}/g, 'Budi').replace(/\{kode\}/g, promo?.code ?? '{kode}');
  const save = async () => {
    const body = { name: f.name, countryCode: country, channel: f.channel, segment, subject: f.subject, body: f.body, promoId: f.promoId || null, link: f.link || null, scheduledAt: f.schedule ? new Date(f.schedule).toISOString() : null };
    try { if (init.id) await api.put(`/marketing/campaigns/${init.id}`, body); else await api.post('/marketing/campaigns', body); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={init.id ? 'Ubah kampanye' : 'Kampanye baru'} onClose={onClose} wide="xl">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <ErrorBox message={err} />
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className={labelCls}>Nama kampanye (internal)</label><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label className={labelCls}>Kanal</label><select className={inputCls} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as 'whatsapp' })}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={labelCls}>Sasaran</label><select className={inputCls} value={f.segType} onChange={(e) => setF({ ...f, segType: e.target.value })}>{Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {f.segType === 'branch'
              ? <div><label className={labelCls}>Cabang</label><select className={inputCls} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">— pilih —</option>{br?.branches.filter((b) => b.type === 'branch' && b.countryCode === country).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
              : f.segType === 'buyers' || f.segType === 'paid_off' ? <div><label className={labelCls}>Dalam … hari terakhir</label><input type="number" className={inputCls} value={f.sinceDays} onChange={(e) => setF({ ...f, sinceDays: e.target.value })} placeholder="semua waktu" /></div> : <div />}
            <div><label className={labelCls}>Judul / subjek email</label><input className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
            <div><label className={labelCls}>Lampirkan kode promo</label><select className={inputCls} value={f.promoId} onChange={(e) => setF({ ...f, promoId: e.target.value })}><option value="">— tanpa kode —</option>{promos?.promos.filter((p) => p.isActive && new Date(p.endsAt) > new Date()).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></div>
          </div>
          <div className="flex gap-2">{LANGS.map(([k, v]) => <Chip key={k} on={lang === k} onClick={() => setLang(k)}>{v}{f.body[k] ? ' ✓' : ''}</Chip>)}</div>
          <div><label className={labelCls}>Isi pesan ({lang}) — gunakan {'{nama}'} dan {'{kode}'}</label>
            <textarea className={inputCls} rows={5} maxLength={1000} value={f.body[lang] ?? ''} onChange={(e) => setF({ ...f, body: { ...f.body, [lang]: e.target.value } })} />
            <p className="text-xs text-slate-500 mt-1">Nasabah menerima pesan sesuai bahasa pilihannya; bila bahasanya kosong dipakai bahasa lain yang terisi. Tautan berhenti berlangganan ditambahkan otomatis.</p></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className={labelCls}>Tautan (opsional)</label><input className={inputCls} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://..." /></div>
            <div><label className={labelCls}>Jadwalkan kirim (kosong = draf, kirim manual)</label><input type="datetime-local" className={inputCls} value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Batal</button><button className={btnPrimary} disabled={f.name.length < 3 || f.subject.length < 3 || !(Object.values(f.body) as (string | undefined)[]).some((v) => v && v.length >= 10)} onClick={save}>{f.schedule ? 'Simpan & jadwalkan' : 'Simpan draf'}</button></div>
        </div>
        <div className="space-y-3">
          <Card className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1"><Users className="w-3 h-3" />Perkiraan penerima</p>
            {!aud ? <p className="text-sm text-slate-500 mt-1">{f.segType === 'branch' && !f.branchId ? 'Pilih cabang' : 'Menghitung...'}</p> : <>
              <p className="text-3xl font-bold text-masri-primary mt-1">{aud.reachable}</p>
              <p className="text-xs text-slate-500">{aud.optedIn} nasabah setuju menerima promo pada sasaran ini{aud.frequencyCapped ? `; ${aud.frequencyCapped} dilewati karena sudah menerima promo < ${aud.minDaysBetween} hari terakhir` : ''}.</p>
            </>}
          </Card>
          <Card className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase">Pratinjau WhatsApp</p>
            <div className="mt-2 bg-[#e7fbe6] dark:bg-emerald-900/30 rounded-lg p-3 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-100">
              <b>{f.subject || 'Judul'}</b>{'\n\n'}{preview || 'Isi pesan...'}{promo ? `\n\nKode: ${promo.code}` : ''}{f.link ? `\n${f.link}` : ''}{'\n\n'}<span className="text-xs text-slate-500">Berhenti menerima promo: tautan berhenti berlangganan</span>
            </div>
          </Card>
        </div>
      </div>
    </Modal>
  );
};
