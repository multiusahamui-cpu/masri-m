import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Warehouse } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Branch, Country } from '../../types';
import { Card, PageHeader, ErrorBox, Spinner, Modal, inputCls, labelCls, btnPrimary, btnSecondary } from './ui';

/** Kelola Kantor Pusat & Cabang. Kantor Pusat dibuat sistem (satu-satunya), cabang ditambah di sini. */
export const SuperAdminBranches: React.FC = () => {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ branches: Branch[] }>('/admin/branches').then((r) => setBranches(r.branches)).catch((e) => setError((e as ApiError).message));
  }, []);
  useEffect(() => {
    load();
    api.get<{ countries: Country[] }>('/admin/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
  }, [load]);

  const toggle = async (b: Branch) => {
    if (!window.confirm(`${b.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${b.name}?`)) return;
    try { await api.patch(`/admin/branches/${b.id}`, { isActive: !b.isActive }); load(); }
    catch (e) { setError((e as ApiError).message); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Building2 className="w-6 h-6" />} title="Kantor & Cabang"
        subtitle="Satu Kantor Pusat (gudang utama, Helpdesk, Business Manager) dan cabang-cabang dengan buffer stok, Manager Cabang, Admin Cabang serta AO."
        actions={<button className={btnPrimary} onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Tambah Cabang</button>} />
      <ErrorBox message={error} onClose={() => setError(null)} />
      {!branches ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branches.map((b) => (
            <Card key={b.id} className={`p-5 ${b.isActive ? '' : 'opacity-60'} ${b.type === 'head_office' ? 'ring-1 ring-masri-gold/60' : ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-mono text-slate-400">{b.code}</p>
                  <h3 className="font-bold text-slate-800 dark:text-white">{b.name}</h3>
                  <p className="text-sm text-slate-500">{b.city || '—'} · {b.countryCode}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${b.type === 'head_office' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-masri-light text-masri-dark dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
                  {b.type === 'head_office' ? 'Kantor Pusat' : 'Cabang'}
                </span>
              </div>
              {b.address && <p className="text-xs text-slate-500 mt-2">{b.address}{b.phone ? ` · ${b.phone}` : ''}</p>}
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{b.userCount} user aktif</span>
                {b.type === 'branch' && b.hasBufferStock && <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center gap-1"><Warehouse className="w-3 h-3" /> Buffer stok</span>}
                {!b.isActive && <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">Nonaktif</span>}
              </div>
              <div className="flex gap-2 mt-4">
                <button className={btnSecondary} onClick={() => setEditing(b)}><Pencil className="w-4 h-4" /> Ubah</button>
                {b.type === 'branch' && <button className={btnSecondary} onClick={() => toggle(b)}>{b.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <BranchForm branch={editing === 'new' ? null : editing} countries={countries} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

const BranchForm: React.FC<{ branch: Branch | null; countries: Country[]; onClose: () => void; onSaved: () => void }> = ({ branch, countries, onClose, onSaved }) => {
  const [form, setForm] = useState({
    code: branch?.code ?? '', name: branch?.name ?? '', city: branch?.city ?? '', address: branch?.address ?? '', postalCode: branch?.postalCode ?? '',
    phone: branch?.phone ?? '', countryCode: branch?.countryCode ?? 'ID', hasBufferStock: branch?.hasBufferStock ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { code, ...rest } = form;
      const body = { ...rest, phone: form.phone || null };
      if (branch) await api.patch(`/admin/branches/${branch.id}`, body);
      else await api.post('/admin/branches', { ...body, code });
      onSaved();
    } catch (err) { setError((err as ApiError).message); } finally { setSaving(false); }
  };

  return (
    <Modal title={branch ? `Ubah ${branch.name}` : 'Tambah Cabang'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Kode</label>
            <input required className={`${inputCls} uppercase`} value={form.code} onChange={set('code')} disabled={!!branch} placeholder="SBY01" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Nama</label>
            <input required minLength={3} className={inputCls} value={form.name} onChange={set('name')} placeholder="Cabang Surabaya" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Kota</label>
            <input required className={inputCls} value={form.city} onChange={set('city')} />
          </div>
          <div>
            <label className={labelCls}>Negara</label>
            <select className={inputCls} value={form.countryCode} onChange={set('countryCode')}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Alamat</label>
            <input className={inputCls} value={form.address} onChange={set('address')} />
          </div>
          <div>
            <label className={labelCls}>Kode pos</label>
            <input className={inputCls} value={form.postalCode} onChange={set('postalCode')} placeholder="5 digit" maxLength={5} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Telepon</label>
          <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="+62..." />
        </div>
        {branch?.type !== 'head_office' && (
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.hasBufferStock} onChange={(e) => setForm({ ...form, hasBufferStock: e.target.checked })} />
            Cabang memiliki buffer stok
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Batal</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
};
