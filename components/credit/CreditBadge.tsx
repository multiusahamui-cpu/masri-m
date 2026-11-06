import React from 'react';
import { CreditStatus } from '../../types';
import { CREDIT_STATUS } from './labels';

export const CreditBadge: React.FC<{ status: CreditStatus }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${CREDIT_STATUS[status].cls}`}>{CREDIT_STATUS[status].label}</span>
);
