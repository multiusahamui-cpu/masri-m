import React, { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Search, Pencil, KeyRound, Copy, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs, ApiError } from '../../lib/api';
import { AuthUser, Branch, Country, InternalUser, RoleInfo, UserStatus } from '../../types';
import {
  Card, PageHeader, ErrorBox, Spinner, Modal, StatusBadge, formatDateTime,
  inputCls, labelCls, btnPrimary, btnSecondary,
} from './ui';

interface ListResponse { users: InternalUser[]; total: number; page: number; pageSize: number }
const PAGE_SIZE = 15;

export const SuperAdminUsers: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [data, setData] = useState<ListResponse | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<InternalUser | 'new' | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const internalRoles = roles.filter((r) => r.isInternal);
  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ListResponse>(`/admin/users${qs({ search, role: roleFilter, status: statusFilter, branchId: branchFilter, page, pageSize: PAGE_SIZE })}`));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, branchFilter, page]);

  useEffect(() => {
    Promise.all([api.get<{ roles: RoleInfo[] }>('/admin/roles'), api.get<{ countries: Country[] }>('/admin/countries'), api.get<{ branches: Branch[] }>('/admin/branches')])
      .then(([r, c, b]) => { setRoles(r.roles); setCountries(c.countries); setBranches(b.branches); })
      .catch((e) => setError((e as ApiError).message));
  }, []);

  // Debounce pencarian
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const resetPassword = async (u: InternalUser) => {
    if (!window.confirm(`Reset password untuk ${u.fullName}? Password lama tidak berlaku lagi.`)) return;
    try {
      const r = await api.post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
      setTempPassword({ email: u.email, password: r.temporaryPassword });
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={<Users className="w-6 h-6" />}
        title="Manajemen User Internal"
        subtitle="Kelola akun staf Masri-M: buat akun, atur role, nonaktifkan, buka kunci, dan reset password."
        actions={<button className={btnPrimary} onClick={() => setEditing('new')}><UserPlus className="w-4 h-4" /> Tambah User</button>}
      />

      <Card className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Cari nama, email, atau telepon..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className={inputCls} value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
          <option value="">Semua role</option>
          {internalRoles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
        <select className={inputCls} value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}>
          <option value="">Semua kantor</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={inputCls} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">Semua status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
          <option value="locked">Terkunci</option>
        </select>
      </Card>

      <ErrorBox message={error} onClose={() => setError(null)} />

      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Nama</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Kantor</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Login Terakhir</th>
                  <th className="text-right px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data?.users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800 dark:text-white">
                        {u.fullName} {u.id === currentUser.id && <span className="text-xs text-masri-primary">(Anda)</span>}
                      </p>
                      <p className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{roleName(u.roleCode)}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {u.branchName ?? <span className="text-red-500 text-xs">Belum ditempatkan</span>}
                      {u.branchCode && <span className="block text-[11px] font-mono text-slate-400">{u.branchCode} · {u.countryCode}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <StatusBadge status={u.status} />
                        {u.mustChangePassword && <span className="text-[11px] text-amber-600">Belum ganti password</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button title="Ubah" onClick={() => setEditing(u)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300"><Pencil className="w-4 h-4" /></button>
                        {u.id !== currentUser.id && (
                          <button title="Reset password" onClick={() => resetPassword(u)} className="p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-600"><KeyRound className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data && data.users.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-500">Tidak ada user yang cocok dengan filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
            <span>{data.total} user</span>
            <div className="flex items-center gap-2">
              <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
              <span>Hal. {page} / {totalPages}</span>
              <button className={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </Card>

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.id === currentUser.id}
          roles={internalRoles}
          countries={countries}
          branches={branches.filter((b) => b.isActive)}
          onClose={() => setEditing(null)}
          onSaved={(temp) => { setEditing(null); if (temp) setTempPassword(temp); load(); }}
        />
      )}

      {tempPassword && <TempPasswordModal {...tempPassword} onClose={() => setTempPassword(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------

interface FormProps {
  user: InternalUser | null;
  isSelf: boolean;
  roles: RoleInfo[];
  countries: Country[];
  branches: Branch[];
  onClose: () => void;
  onSaved: (temp?: { email: string; password: string }) => void;
}

const fits = (role: RoleInfo | undefined, b: Branch) => !role || role.scope === 'any' || role.scope === b.type;

const UserFormModal: React.FC<FormProps> = ({ user, isSelf, roles, countries, branches, onClose, onSaved }) => {
  const [form, setForm] = useState({
    email: user?.email ?? '',
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    roleCode: user?.roleCode ?? (roles.find((r) => r.code !== 'super-admin')?.code ?? 'ao'),
    countryCode: user?.countryCode ?? 'ID',
    status: (user?.status ?? 'active') as UserStatus,
    branchId: user?.branchId ?? '',
  });
  const selectedRole = roles.find((r) => r.code === form.roleCode);
  const branchOptions = branches.filter((b) => fits(selectedRole, b));
  // Saat role diganti, kosongkan kantor yang tidak cocok (mis. Admin Cabang tidak boleh di Kantor Pusat)
  React.useEffect(() => {
    if (form.branchId && !branchOptions.some((b) => b.id === form.branchId)) setForm((f) => ({ ...f, branchId: '' }));
    if (!form.branchId && branchOptions.length === 1) setForm((f) => ({ ...f, branchId: branchOptions[0].id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.roleCode, branches.length]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (user) {
        await api.patch(`/admin/users/${user.id}`, {
          fullName: form.fullName, phone: form.phone || null, countryCode: form.countryCode,
          ...(form.branchId ? { branchId: form.branchId } : {}),
          ...(isSelf ? {} : { roleCode: form.roleCode, status: form.status }),
        });
        onSaved();
      } else {
        const r = await api.post<{ temporaryPassword?: string }>('/admin/users', {
          email: form.email, fullName: form.fullName, phone: form.phone || null,
          roleCode: form.roleCode, countryCode: form.countryCode, branchId: form.branchId || undefined,
        });
        onSaved(r.temporaryPassword ? { email: form.email, password: r.temporaryPassword } : undefined);
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={user ? 'Ubah User' : 'Tambah User Internal'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" required className={inputCls} value={form.email} onChange={set('email')} disabled={!!user} />
          {user && <p className="text-xs text-slate-500 mt-1">Email tidak dapat diubah.</p>}
        </div>
        <div>
          <label className={labelCls}>Nama Lengkap</label>
          <input required minLength={3} className={inputCls} value={form.fullName} onChange={set('fullName')} />
        </div>
        <div>
          <label className={labelCls}>Telepon (opsional)</label>
          <input className={inputCls} placeholder="+62812..." value={form.phone} onChange={set('phone')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Role</label>
            <select className={inputCls} value={form.roleCode} onChange={set('roleCode')} disabled={isSelf}>
              {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Negara</label>
            <select className={inputCls} value={form.countryCode} onChange={set('countryCode')}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}{c.isActive ? '' : ' (belum aktif)'}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Kantor / Cabang</label>
          <select required className={inputCls} value={form.branchId} onChange={set('branchId')}>
            <option value="">— pilih —</option>
            {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}{b.type === 'head_office' ? ' (Pusat)' : ''}</option>)}
          </select>
          {selectedRole && selectedRole.scope !== 'any' && (
            <p className="text-xs text-slate-500 mt-1">Role {selectedRole.name} hanya ditempatkan di {selectedRole.scope === 'branch' ? 'cabang' : 'Kantor Pusat'}.</p>
          )}
        </div>
        {user && (
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={form.status} onChange={set('status')} disabled={isSelf}>
              <option value="active">Aktif{user.status === 'locked' ? ' (buka kunci)' : ''}</option>
              <option value="inactive">Nonaktif</option>
              <option value="locked">Terkunci</option>
            </select>
            {isSelf && <p className="text-xs text-slate-500 mt-1">Role & status akun sendiri tidak dapat diubah.</p>}
          </div>
        )}
        {!user && (
          <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
            Sistem membuat password sementara yang hanya ditampilkan sekali. User wajib menggantinya saat login pertama.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Batal</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
};

const TempPasswordModal: React.FC<{ email: string; password: string; onClose: () => void }> = ({ email, password, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* clipboard tidak tersedia */ }
  };
  return (
    <Modal title="Password Sementara" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Berikan password ini kepada <strong>{email}</strong> melalui saluran aman. Password <strong>tidak akan ditampilkan lagi</strong>.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-4 py-3 rounded-lg bg-slate-900 text-masri-accent font-mono text-lg tracking-wider select-all">{password}</code>
          <button className={btnSecondary} onClick={copy}>{copied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}{copied ? 'Tersalin' : 'Salin'}</button>
        </div>
        <div className="flex justify-end"><button className={btnPrimary} onClick={onClose}>Selesai</button></div>
      </div>
    </Modal>
  );
};
