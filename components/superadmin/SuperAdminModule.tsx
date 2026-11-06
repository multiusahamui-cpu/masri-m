import React from 'react';
import { AuthUser } from '../../types';
import { SuperAdminOverview } from './SuperAdminOverview';
import { SuperAdminUsers } from './SuperAdminUsers';
import { SuperAdminRoles } from './SuperAdminRoles';
import { SuperAdminConfig } from './SuperAdminConfig';
import { SuperAdminAudit } from './SuperAdminAudit';
import { SuperAdminAccount } from './SuperAdminAccount';
import { SuperAdminBranches } from './SuperAdminBranches';
import { SuperAdminAssistant } from './SuperAdminAssistant';
import { SuperAdminNotify } from './SuperAdminNotify';

/** Router menu untuk role Super Admin. */
export const SuperAdminModule: React.FC<{ menu: string; currentUser: AuthUser; onNavigate: (menu: string) => void }> = ({ menu, currentUser, onNavigate }) => {
  switch (menu) {
    case 'branches': return <SuperAdminBranches />;
    case 'users': return <SuperAdminUsers currentUser={currentUser} />;
    case 'roles': return <SuperAdminRoles />;
    case 'business-config': return <SuperAdminConfig />;
    case 'assistant': return <SuperAdminAssistant onNavigate={onNavigate} />;
    case 'notify': return <SuperAdminNotify onNavigate={onNavigate} />;
    case 'audit': return <SuperAdminAudit />;
    case 'account': return <SuperAdminAccount currentUser={currentUser} />;
    default: return <SuperAdminOverview currentUser={currentUser} onNavigate={onNavigate} />;
  }
};
