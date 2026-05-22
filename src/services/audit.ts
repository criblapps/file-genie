import { getAuditEntries, appendAuditEntry } from '../api/kvstore';
import type { AuditEntry, AuditAction } from '../types';

let _counter = Date.now();

function newId(): string {
  return `audit-${++_counter}`;
}

export async function recordAction(params: {
  action: AuditAction;
  lookupName: string;
  sourceScope?: string;
  targetScopes?: string[];
  beforeHash?: string;
  afterHash?: string;
  result: 'success' | 'failure';
  details?: string;
  actor?: string;
}): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: newId(),
    timestamp: new Date().toISOString(),
    actor: params.actor ?? 'unknown',
    action: params.action,
    lookupName: params.lookupName,
    sourceScope: params.sourceScope,
    targetScopes: params.targetScopes,
    beforeHash: params.beforeHash,
    afterHash: params.afterHash,
    result: params.result,
    details: params.details,
  };
  await appendAuditEntry(entry);
  return entry;
}

export async function fetchAuditEntries(): Promise<AuditEntry[]> {
  return getAuditEntries();
}

export interface AuditFilter {
  lookupName?: string;
  action?: AuditAction;
  result?: 'success' | 'failure';
  actor?: string;
  since?: string;
  until?: string;
}

export function filterAuditEntries(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries.filter((e) => {
    if (filter.lookupName && !e.lookupName.toLowerCase().includes(filter.lookupName.toLowerCase())) return false;
    if (filter.action && e.action !== filter.action) return false;
    if (filter.result && e.result !== filter.result) return false;
    if (filter.actor && !e.actor?.toLowerCase().includes(filter.actor.toLowerCase())) return false;
    if (filter.since && e.timestamp < filter.since) return false;
    if (filter.until && e.timestamp > filter.until) return false;
    return true;
  });
}
