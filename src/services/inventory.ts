import { listAllScopes, listLookups, type RawLookup } from '../api/cribl';
import { getCachedInventory, setCachedInventory } from '../api/kvstore';
import type { LookupRecord, ScanResult, Scope, SyncStatus, DriftGroup } from '../types';

// ── Normalization ─────────────────────────────────────────────────────────────

/** Returns true for internal Cribl system files that should be excluded from the inventory. */
function isSystemFile(name: string): boolean {
  return name.startsWith('cribl.');
}

function normalizeLookup(raw: RawLookup, scope: Scope): LookupRecord {
  const name = raw.filename ?? raw.id;
  const modifiedAt = raw.modifiedAt ?? raw.updatedAt;
  return {
    // For pack records, include parentScopeId (the group) to ensure uniqueness —
    // the same pack installed on two different groups produces two distinct records.
    id: scope.parentScopeId
      ? `${scope.type}:${scope.parentScopeId}:${scope.id}:${name}`
      : `${scope.type}:${scope.id}:${name}`,
    name,
    scopeType: scope.type,
    scopeId: scope.id,
    scopeName: scope.name,
    parentScopeId: scope.parentScopeId,
    path: raw.path ?? name,
    version: raw.version,
    hash: raw.hash,
    size: raw.size,
    lastModified: modifiedAt != null ? new Date(modifiedAt * 1000).toISOString() : undefined,
    lastModifiedBy: raw.modifiedBy ?? raw.updatedBy,
    exists: true,
    contentType: name.endsWith('.csv') ? 'text/csv' : 'text/plain',
    syncStatus: 'unknown',
  };
}

// ── Full scan ─────────────────────────────────────────────────────────────────

export async function scanAllScopes(
  onProgress?: (msg: string) => void,
): Promise<ScanResult> {
  onProgress?.('Discovering scopes…');
  const scopes = await listAllScopes();

  const allRecords: LookupRecord[] = [];

  await Promise.all(
    scopes.map(async (scope) => {
      onProgress?.(`Scanning ${scope.name}…`);
      const raws = await listLookups(scope.id, scope.parentScopeId);
      for (const raw of raws) {
        const name = raw.filename ?? raw.id;
        // Skip internal Cribl system files (e.g. cribl.lookup) inside packs
        if (scope.type === 'pack' && isSystemFile(name)) continue;
        allRecords.push(normalizeLookup(raw, scope));
      }
    }),
  );

  // Compute sync status using pack-aware comparison keys
  const byKey = groupByComparisonKey(allRecords);
  for (const group of Object.values(byKey)) {
    applyGroupSyncStatus(group, allRecords);
  }

  const result: ScanResult = {
    records: allRecords,
    scannedAt: new Date().toISOString(),
    scopeCount: scopes.length,
    lookupCount: allRecords.length,
  };

  // Best-effort cache write — don't await so a KV failure can't abort the scan
  setCachedInventory(result).catch(() => {});
  return result;
}

export async function loadInventory(forceRefresh = false): Promise<ScanResult> {
  if (!forceRefresh) {
    const cached = await getCachedInventory();
    if (cached) return cached;
  }
  return scanAllScopes();
}

// ── Comparison key ────────────────────────────────────────────────────────────

/**
 * Returns the key used to group records for comparison/drift purposes.
 *
 * - Pack records: `filename::pack::displayName`
 *   Groups by display name so that the same pack installed under slightly different
 *   internal IDs (e.g. different versions or manual imports) on different groups
 *   is still treated as one logical pack by operators.
 * - Group/fleet records: `filename`
 *   All direct copies of a file are compared regardless of which group holds them.
 */
export function comparisonKey(r: LookupRecord): string {
  return r.scopeType === 'pack' ? `${r.name}::pack::${r.scopeName}` : r.name;
}

// ── Drift grouping ────────────────────────────────────────────────────────────

interface ByKey {
  [key: string]: LookupRecord[];
}

export function groupByComparisonKey(records: LookupRecord[]): ByKey {
  const map: ByKey = {};
  for (const r of records) {
    const k = comparisonKey(r);
    if (!map[k]) map[k] = [];
    map[k].push(r);
  }
  return map;
}

/** @deprecated Use groupByComparisonKey for correct pack-aware grouping */
export function groupByName(records: LookupRecord[]): ByKey {
  const map: ByKey = {};
  for (const r of records) {
    if (!map[r.name]) map[r.name] = [];
    map[r.name].push(r);
  }
  return map;
}

function applyGroupSyncStatus(
  records: LookupRecord[],
  allRecords: LookupRecord[],
): void {
  if (records.length === 0) return;

  // Only one copy in existence — not a sync problem, just a distribution question
  if (records.length === 1) {
    const idx = allRecords.findIndex((x) => x.id === records[0].id);
    if (idx >= 0) allRecords[idx].syncStatus = 'sole_copy';
    return;
  }

  const hashes = records.map((r) => r.hash).filter((h): h is string => h != null);

  let status: SyncStatus;

  if (hashes.length === records.length) {
    // All copies have a native hash — authoritative comparison
    const uniqueHashes = new Set(hashes);
    status = uniqueHashes.size === 1 ? 'in_sync' : 'out_of_sync';
  } else {
    // No native hashes — fall back to file size only (not lastModified;
    // timestamps legitimately differ for identical files synced at different times)
    const sizes = records.map((r) => r.size).filter((s): s is number => s != null);
    if (sizes.length === records.length) {
      const uniqueSizes = new Set(sizes);
      status = uniqueSizes.size === 1 ? 'in_sync' : 'out_of_sync';
    } else {
      status = 'unknown';
    }
  }

  for (const r of records) {
    const idx = allRecords.findIndex((x) => x.id === r.id);
    if (idx >= 0) allRecords[idx].syncStatus = status;
  }
}

export function buildDriftGroups(records: LookupRecord[], allScopes: Scope[]): DriftGroup[] {
  const byKey = groupByComparisonKey(records);

  // Only used for direct (non-pack) missing-copy detection
  const directScopes = allScopes.filter((s) => s.type !== 'pack');

  return Object.entries(byKey).map(([key, recs]) => {
    const isPack = recs[0]?.scopeType === 'pack';
    const packId = isPack ? recs[0].scopeId : undefined;
    const name = recs[0]?.name ?? key;

    const hashes = recs.map((r) => r.hash).filter(Boolean);
    const uniqueHashes = new Set(hashes);
    const hasContentDiff = uniqueHashes.size > 1;

    // Only size is used for metadata drift — lastModified timestamps legitimately
    // differ for identical files and should not drive out-of-sync status
    const definedSizes = recs.map((r) => r.size).filter((s): s is number => s != null);
    const hasMetaDiff = definedSizes.length === recs.length && new Set(definedSizes).size > 1;

    let presentScopes: string[];
    let missingScopeIds: string[];

    if (isPack && packId) {
      // Pack files: "present" = parent group IDs that have this pack+file.
      // We never flag pack files as "missing" — a pack on one group is not required
      // to contain the same files as the same pack on another group. Drift is only
      // meaningful when the file EXISTS in multiple instances of the same pack.
      presentScopes = recs
        .map((r) => r.parentScopeId)
        .filter((id): id is string => id != null);
      missingScopeIds = [];
    } else {
      // Direct group/fleet copies: flag as missing if absent from any non-pack scope
      const presentScopeIds = new Set(recs.map((r) => r.scopeId));
      presentScopes = [...presentScopeIds];
      missingScopeIds = directScopes
        .filter((s) => !presentScopeIds.has(s.id))
        .map((s) => s.id);
    }

    const hasMissingCopies = missingScopeIds.length > 0;

    let status: SyncStatus;
    if (hasMissingCopies || hasContentDiff || hasMetaDiff) {
      status = 'out_of_sync';
    } else {
      status = 'in_sync';
    }

    // Pick most-recently-modified as default source of truth
    const sortedRecs = [...recs].sort((a, b) => {
      const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return tb - ta;
    });

    return {
      name,
      comparisonKey: key,
      packId,
      records: recs,
      status,
      hasContentDiff,
      hasMetaDiff,
      hasMissingCopies,
      presentScopes,
      missingScopes: missingScopeIds,
      sourceOfTruth: sortedRecs[0]?.id,
    };
  });
}
