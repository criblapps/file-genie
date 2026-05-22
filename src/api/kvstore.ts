import type { AuditEntry, ScanResult } from '../types';

const apiBase = (): string => (window as unknown as { CRIBL_API_URL: string }).CRIBL_API_URL ?? '';

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}/kvstore/${key}`);
    if (!res.ok) return null;
    // Await inside try so JSON parse errors are caught here, not by the caller
    const data = await res.json();
    return data as T;
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const body = JSON.stringify(value);
    if (!body) return;
    await fetch(`${apiBase()}/kvstore/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    // KV writes are best-effort; a write failure should not crash the caller
  }
}

async function kvDelete(key: string): Promise<void> {
  await fetch(`${apiBase()}/kvstore/${key}`, { method: 'DELETE' });
}

// ── Inventory cache ───────────────────────────────────────────────────────────

const INVENTORY_KEY = 'lkp/inventory';

export async function getCachedInventory(): Promise<ScanResult | null> {
  const data = await kvGet<ScanResult>(INVENTORY_KEY);
  // Validate shape — guard against empty objects or stale bad writes
  if (!data || !Array.isArray(data.records) || !data.scannedAt) return null;
  return data;
}

export async function setCachedInventory(result: ScanResult): Promise<void> {
  await kvSet(INVENTORY_KEY, result);
}

export async function clearCachedInventory(): Promise<void> {
  await kvDelete(INVENTORY_KEY);
}

// ── Audit entries ─────────────────────────────────────────────────────────────

const AUDIT_KEY = 'lkp/audit';
const MAX_AUDIT_ENTRIES = 500;

export async function getAuditEntries(): Promise<AuditEntry[]> {
  const data = await kvGet<AuditEntry[]>(AUDIT_KEY);
  return data ?? [];
}

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const existing = await getAuditEntries();
  const updated = [entry, ...existing].slice(0, MAX_AUDIT_ENTRIES);
  await kvSet(AUDIT_KEY, updated);
}

export async function clearAuditEntries(): Promise<void> {
  await kvDelete(AUDIT_KEY);
}

// ── User preferences ──────────────────────────────────────────────────────────

const PREFS_KEY = 'lkp/prefs';

export interface UserPrefs {
  lastScanAt?: string;
  defaultSkipIdentical?: boolean;
}

export async function getPrefs(): Promise<UserPrefs> {
  return (await kvGet<UserPrefs>(PREFS_KEY)) ?? {};
}

export async function setPrefs(prefs: UserPrefs): Promise<void> {
  await kvSet(PREFS_KEY, prefs);
}
