// Digantikan oleh components/StaffLogin.tsx (login generik untuk semua role yang memakai backend).
// File ini dipertahankan sebagai pembungkus agar impor lama tetap berjalan; boleh dihapus.
import React from 'react';
import { AuthUser } from '../../types';
import { StaffLogin } from '../StaffLogin';

export const SuperAdminLogin: React.FC<{ onSuccess: (user: AuthUser) => void; onClose: () => void }> = (props) => (
  <StaffLogin role="super-admin" roleTitle="Super Admin" {...props} />
);
