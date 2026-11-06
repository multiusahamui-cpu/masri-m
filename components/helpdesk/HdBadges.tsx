import React from 'react';
import { HdPriority, HdStatus } from '../../types';
import { PRIORITY_META, STATUS_META } from './labels';

export const HdStatusBadge: React.FC<{ status: HdStatus }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_META[status].cls}`}>{STATUS_META[status].label}</span>
);

export const HdPriorityText: React.FC<{ priority: HdPriority }> = ({ priority }) => (
  <span className={`text-xs font-bold uppercase ${PRIORITY_META[priority].cls}`}>{PRIORITY_META[priority].label}</span>
);
