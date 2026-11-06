import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { RoleInfo, RoleType } from '../../types';
import { ROLE_MENUS } from '../../constants';
import { Card, PageHeader, ErrorBox, Spinner } from './ui';

/** Matriks role → menu yang dapat diakses. Saat ini hak akses ditetapkan di kode (RBAC statis). */
export const SuperAdminRoles: React.FC = () => {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ roles: RoleInfo[] }>('/admin/roles').then((r) => setRoles(r.roles)).catch((e) => setError((e as ApiError).message));
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={<Shield className="w-6 h-6" />} title="Role & Akses"
        subtitle="Daftar role resmi Masri-M beserta modul yang dapat diakses. Penugasan role dilakukan di Manajemen User." />
      <ErrorBox message={error} />
      {!roles ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {roles.map((r) => (
            <Card key={r.code} className="p-5">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">{r.name}</h3>
                  <p className="text-xs font-mono text-slate-400">{r.code} · {r.scope === 'head_office' ? 'Kantor Pusat' : r.scope === 'branch' ? 'Cabang' : 'Pusat / Cabang'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.isInternal ? 'bg-masri-light text-masri-dark dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                  {r.isInternal ? `${r.userCount} user` : 'Eksternal'}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{r.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {(ROLE_MENUS[r.code as RoleType] ?? []).map((m) => (
                  <span key={m.id} className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{m.label}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Catatan: hak akses per modul saat ini ditetapkan di kode (RBAC statis) dan ditegakkan di backend. Permission granular yang dapat diatur dari layar ini dapat ditambahkan pada fase berikutnya.
      </p>
    </div>
  );
};
