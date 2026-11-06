// Daftar role resmi Masri-M. Kode harus sama dengan RoleType di frontend (types.ts).
// scope: head_office = hanya Kantor Pusat, branch = hanya Cabang, any = keduanya.
export const ROLE_SEED = [
  { code: 'super-admin', name: 'Super Admin', description: 'Parameter bisnis, cabang & manajemen user internal', isInternal: true, scope: 'head_office', sortOrder: 1 },
  { code: 'admin', name: 'System Admin', description: 'Operasional sistem & katalog produk', isInternal: true, scope: 'head_office', sortOrder: 2 },
  { code: 'biz-mgr', name: 'Business Manager', description: 'Penetapan kredit & strategi (Pusat)', isInternal: true, scope: 'head_office', sortOrder: 3 },
  { code: 'branch-manager', name: 'Manager Cabang', description: 'Memimpin cabang & membawahi Account Officer', isInternal: true, scope: 'branch', sortOrder: 4 },
  { code: 'branch-admin', name: 'Admin Cabang', description: 'Stok buffer, pengiriman & pengeluaran operasional cabang', isInternal: true, scope: 'branch', sortOrder: 5 },
  { code: 'ao', name: 'Account Officer', description: 'Survey & verifikasi nasabah (di bawah Manager Cabang)', isInternal: true, scope: 'branch', sortOrder: 6 },
  { code: 'warehouse', name: 'Warehouse Pusat', description: 'Gudang pusat & distribusi stok ke cabang', isInternal: true, scope: 'head_office', sortOrder: 7 },
  { code: 'delivery', name: 'Delivery Team', description: 'Ekspedisi internal Masri-M', isInternal: true, scope: 'any', sortOrder: 8 },
  { code: 'cashier', name: 'Cashier', description: 'Kasir & pembayaran', isInternal: true, scope: 'any', sortOrder: 9 },
  { code: 'support', name: 'Helpdesk Pusat', description: 'Pusat bantuan satu pintu & eskalasi ke cabang', isInternal: true, scope: 'head_office', sortOrder: 10 },
  { code: 'finance', name: 'Bookkeeping', description: 'Keuangan & pajak', isInternal: true, scope: 'head_office', sortOrder: 11 },
  { code: 'marketing', name: 'Marketing', description: 'Promosi & kampanye', isInternal: true, scope: 'head_office', sortOrder: 12 },
  { code: 'customer', name: 'Customer', description: 'Nasabah / pelanggan', isInternal: false, scope: 'any', sortOrder: 99 },
] as const;

export type RoleCode = (typeof ROLE_SEED)[number]['code'];
export type RoleScope = (typeof ROLE_SEED)[number]['scope'];
export const INTERNAL_ROLE_CODES = ROLE_SEED.filter((r) => r.isInternal).map((r) => r.code) as RoleCode[];
export const ROLE_SCOPE = new Map<string, RoleScope>(ROLE_SEED.map((r) => [r.code, r.scope]));

/** Cek apakah role boleh ditempatkan di jenis kantor tertentu. */
export function roleFitsBranch(roleCode: string, branchType: 'head_office' | 'branch'): boolean {
  const scope = ROLE_SCOPE.get(roleCode);
  return scope === 'any' || scope === branchType;
}
