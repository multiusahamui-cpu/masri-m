import React from 'react';
import { KeyRound } from 'lucide-react';
import { AuthUser } from '../../types';
import { Card, PageHeader } from './ui';
import { ChangePasswordForm } from './ChangePasswordForm';

export const SuperAdminAccount: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => (
  <div className="space-y-6 animate-in fade-in duration-500">
    <PageHeader icon={<KeyRound className="w-6 h-6" />} title="Keamanan Akun" subtitle={`Login sebagai ${currentUser.email}`} />
    <Card className="p-6 max-w-lg">
      <h3 className="font-bold text-slate-800 dark:text-white mb-4">Ganti Password</h3>
      <ChangePasswordForm />
    </Card>
  </div>
);
