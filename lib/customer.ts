// Sesi Akun Saya (nasabah). Cookie httpOnly dikelola server; di sini hanya status & profil.
import { useEffect, useState } from 'react';
import { api } from './api';

export interface CustomerProfile { fullName: string; phone: string; email: string | null; city: string; address: string; customerNo: string; kycVerified: boolean; needsName: boolean; marketingOptIn?: boolean }
export interface CustomerKyc { nik: string | null; birthDate: string | null; maritalStatus: string | null; dependents: number | null; occupation: string | null; employer: string | null; monthlyIncome: number | null }
export interface CustomerMe { profile: CustomerProfile; kyc: CustomerKyc }

let current: CustomerMe | null | undefined; // undefined = belum dicek
let loading: Promise<CustomerMe | null> | null = null;
const listeners = new Set<(c: CustomerMe | null) => void>();
const emit = () => listeners.forEach((f) => f(current ?? null));

export const customerSession = {
  async refresh() {
    loading = api.get<CustomerMe>('/customer/me').then((r) => r).catch(() => null);
    current = await loading; loading = null; emit();
    return current;
  },
  async get() { if (current !== undefined) return current; return loading ?? this.refresh(); },
  async logout() { await api.post('/customer/auth/logout').catch(() => undefined); current = null; emit(); },
};

export function useCustomer() {
  const [c, setC] = useState<CustomerMe | null | undefined>(current);
  useEffect(() => {
    listeners.add(setC);
    if (current === undefined) customerSession.get().then(setC);
    return () => { listeners.delete(setC); };
  }, []);
  return c;
}
