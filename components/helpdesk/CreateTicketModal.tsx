import React, { useEffect, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { BranchOption, HdCategory, HdChannel, HdCustomer, HdPriority } from '../../types';
import { Modal, ErrorBox, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_META } from './labels';

export const CreateTicketModal: React.FC<{ branches: BranchOption[]; onClose: () => void; onCreated: (id: string) => void }> = ({ branches, onClose, onCreated }) => {
  const cabang = branches.filter((b) => b.type === 'branch');
  const [customer, setCustomer] = useState<HdCustomer | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<HdCustomer[]>([]);
  const [newCust, setNewCust] = useState<null | { fullName: string; phone: string; email: string; city: string; branchId: string }>(null);
  const [form, setForm] = useState({
    subject: '', description: '', category: 'order' as HdCategory, priority: 'normal' as HdPriority,
    channel: 'phone' as HdChannel, orderRef: '', branchId: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer || search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<{ customers: HdCustomer[] }>(`/customers${qs({ search })}`).then((r) => setResults(r.customers)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search, customer]);

  const pickCustomer = (c: HdCustomer) => {
    setCustomer(c);
    setResults([]);
    setForm((f) => ({ ...f, branchId: c.branchId ?? f.branchId }));
  };

  const saveNewCustomer = async () => {
    if (!newCust) return;
    setError(null);
    try {
      const r = await api.post<{ customer: HdCustomer }>('/customers', newCust);
      pickCustomer({ ...r.customer, branchName: cabang.find((b) => b.id === newCust.branchId)?.name });
      setNewCust(null);
    } catch (e) { setError((e as ApiError).message); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{ ticket: { id: string } }>('/helpdesk/tickets', {
        ...form, orderRef: form.orderRef || null, branchId: form.branchId || null, customerId: customer?.id ?? null,
      });
      onCreated(r.ticket.id);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Tiket Baru — Helpdesk Pusat" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />

        {/* Nasabah */}
        <div>
          <label className={labelCls}>Nasabah</label>
          {customer ? (
            <div className="flex items-center justify-between p-3 rounded-lg bg-masri-light dark:bg-emerald-900/20">
              <div className="text-sm">
                <p className="font-semibold text-slate-800 dark:text-white">{customer.fullName} <span className="font-mono text-xs text-slate-500">{customer.customerNo}</span></p>
                <p className="text-xs text-slate-500">{customer.phone} · {customer.city} · {customer.branchName ?? '—'}</p>
              </div>
              <button type="button" onClick={() => setCustomer(null)} className="p-1 text-slate-500 hover:text-red-500" aria-label="Ganti nasabah"><X className="w-4 h-4" /></button>
            </div>
          ) : newCust ? (
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder="Nama lengkap" value={newCust.fullName} onChange={(e) => setNewCust({ ...newCust, fullName: e.target.value })} />
                <input className={inputCls} placeholder="No. HP (+62...)" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
                <input className={inputCls} placeholder="Email (opsional)" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} />
                <input className={inputCls} placeholder="Kota" value={newCust.city} onChange={(e) => setNewCust({ ...newCust, city: e.target.value })} />
              </div>
              <select className={inputCls} value={newCust.branchId} onChange={(e) => setNewCust({ ...newCust, branchId: e.target.value })}>
                <option value="">— cabang yang melayani —</option>
                {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setNewCust(null)}>Batal</button>
                <button type="button" className={btnPrimary} onClick={saveNewCustomer}>Simpan Nasabah</button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input className={`${inputCls} pl-9`} placeholder="Cari nama, no. HP, atau no. nasabah..." value={search} onChange={(e) => setSearch(e.target.value)} />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pickCustomer(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                        <span className="font-semibold text-slate-800 dark:text-white">{c.fullName}</span>
                        <span className="text-xs text-slate-500"> · {c.phone} · {c.branchName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="mt-2 text-sm text-masri-primary flex items-center gap-1 hover:underline"
                onClick={() => setNewCust({ fullName: search, phone: '', email: '', city: '', branchId: '' })}>
                <UserPlus className="w-4 h-4" /> Nasabah belum terdaftar? Daftarkan
              </button>
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>Judul masalah</label>
          <input required minLength={5} className={inputCls} value={form.subject} onChange={set('subject')} placeholder="mis. Kulkas belum dikirim padahal sudah 5 hari" />
        </div>
        <div>
          <label className={labelCls}>Uraian</label>
          <textarea required minLength={10} className={`${inputCls} h-28`} value={form.description} onChange={set('description')} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Kategori</label>
            <select className={inputCls} value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Prioritas</label>
            <select className={inputCls} value={form.priority} onChange={set('priority')}>
              {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Kanal</label>
            <select className={inputCls} value={form.channel} onChange={set('channel')}>
              {Object.entries(CHANNEL_LABEL).filter(([k]) => k !== 'chat').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>No. Order (opsional)</label>
            <input className={inputCls} value={form.orderRef} onChange={set('orderRef')} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Cabang terkait</label>
            <select className={inputCls} value={form.branchId} onChange={set('branchId')}>
              <option value="">— belum ditentukan —</option>
              {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Batal</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Menyimpan...' : 'Buat Tiket'}</button>
        </div>
      </form>
    </Modal>
  );
};
