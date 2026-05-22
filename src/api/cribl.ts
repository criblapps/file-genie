import type { Scope, ScopeType } from '../types';

const apiBase = (): string => (window as unknown as { CRIBL_API_URL: string }).CRIBL_API_URL ?? '';

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiBase()}${path}`, options);
  return res;
}

async function apiGetItems<T>(path: string): Promise<T[]> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return [];
  }
  if (Array.isArray(json)) return json as T[];
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj?.items)) return obj.items as T[];
  return [];
}

// Builds the API path prefix for a given scope.
// For pack scopes: /m/{parentGroupId}/p/{packId}
// For group/fleet scopes: /m/{scopeId}
function scopeApiBase(scopeId: string, parentScopeId?: string): string {
  if (parentScopeId) {
    return `/m/${encodeURIComponent(parentScopeId)}/p/${encodeURIComponent(scopeId)}`;
  }
  return `/m/${encodeURIComponent(scopeId)}`;
}

// ── Groups / Fleets ──────────────────────────────────────────────────────────

export interface RawGroup {
  id: string;
  name?: string;
  type?: string;
  configVersion?: string;
}

// IDs belonging to other Cribl products (Search) that should not appear in this app.
const EXCLUDED_GROUP_IDS = new Set(['default_search']);

export async function listGroups(): Promise<Scope[]> {
  try {
    const items = await apiGetItems<RawGroup>('/master/groups');
    return items
      .filter((g) => !EXCLUDED_GROUP_IDS.has(g.id))
      .map((g) => ({ id: g.id, name: g.name ?? g.id, type: 'group' as ScopeType }));
  } catch {
    return [];
  }
}

export async function listFleets(): Promise<Scope[]> {
  try {
    const items = await apiGetItems<RawGroup>('/master/fleets');
    return items.map((f) => ({ id: f.id, name: f.name ?? f.id, type: 'fleet' as ScopeType }));
  } catch {
    return [];
  }
}

// ── Packs ─────────────────────────────────────────────────────────────────────

export interface RawPack {
  id: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
}

export async function listPacksForGroup(groupId: string): Promise<Scope[]> {
  try {
    const items = await apiGetItems<RawPack>(`/m/${encodeURIComponent(groupId)}/packs`);
    return items.map((p) => ({
      id: p.id,
      name: p.displayName ?? p.id,
      type: 'pack' as ScopeType,
      parentScopeId: groupId,
    }));
  } catch {
    return [];
  }
}

export async function listAllScopes(): Promise<Scope[]> {
  const [groups, fleets] = await Promise.all([listGroups(), listFleets()]);
  const packLists = await Promise.all(groups.map((g) => listPacksForGroup(g.id)));
  const packs = packLists.flat();
  return [...groups, ...fleets, ...packs];
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export interface RawLookup {
  id: string;
  filename?: string;
  path?: string;
  size?: number;
  modifiedAt?: number;
  updatedAt?: number;
  modifiedBy?: string;
  updatedBy?: string;
  hash?: string;
  version?: string;
  tags?: string;
}

export async function listLookups(scopeId: string, parentScopeId?: string): Promise<RawLookup[]> {
  try {
    const base = scopeApiBase(scopeId, parentScopeId);
    const items = await apiGetItems<RawLookup>(`${base}/system/lookups`);
    return items;
  } catch {
    return [];
  }
}

// GET /m/:scopeId/system/lookups/:id/content?raw=1  →  raw CSV text
// For packs: GET /m/:groupId/p/:packId/system/lookups/:id/content?raw=1
export async function getLookupContent(scopeId: string, filename: string, parentScopeId?: string): Promise<string> {
  const base = scopeApiBase(scopeId, parentScopeId);
  const res = await apiFetch(
    `${base}/system/lookups/${encodeURIComponent(filename)}/content?raw=1`,
  );
  if (!res.ok) throw new Error(`Failed to fetch ${filename} from ${scopeId}: ${res.status}`);
  return res.text();
}

// Step 1 of the two-step upload:
// PUT /m/:scopeId/system/lookups?filename=:filename  →  { filename: "xxx.tmp", rows, size }
async function uploadRaw(scopeId: string, filename: string, content: string, parentScopeId?: string): Promise<string> {
  const base = scopeApiBase(scopeId, parentScopeId);
  const res = await apiFetch(
    `${base}/system/lookups?filename=${encodeURIComponent(filename)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: content,
    },
  );
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${filename} → ${scopeId}`);
  const json = await res.json() as { filename: string };
  if (!json.filename) throw new Error(`Upload response missing filename: ${JSON.stringify(json)}`);
  return json.filename; // e.g. "lookup.csv.ABCDeFg.tmp"
}

// Replace an existing lookup file (two-step: upload raw → PATCH to commit)
// PATCH /m/:scopeId/system/lookups/:id  body: { id, fileInfo: { filename: tmpName } }
export async function uploadLookup(
  scopeId: string,
  filename: string,
  content: string,
  parentScopeId?: string,
): Promise<void> {
  const base = scopeApiBase(scopeId, parentScopeId);
  const tmpFilename = await uploadRaw(scopeId, filename, content, parentScopeId);
  const res = await apiFetch(
    `${base}/system/lookups/${encodeURIComponent(filename)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: filename, fileInfo: { filename: tmpFilename } }),
    },
  );
  if (!res.ok) throw new Error(`Commit failed (${res.status}): ${filename} → ${scopeId}`);
}

// Create a brand-new lookup (two-step: upload raw → POST to register)
// POST /m/:scopeId/system/lookups  body: { id, fileInfo: { filename: tmpName } }
export async function createLookup(
  scopeId: string,
  filename: string,
  content: string,
  parentScopeId?: string,
): Promise<void> {
  const base = scopeApiBase(scopeId, parentScopeId);
  const tmpFilename = await uploadRaw(scopeId, filename, content, parentScopeId);
  const res = await apiFetch(`${base}/system/lookups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: filename, fileInfo: { filename: tmpFilename } }),
  });
  if (!res.ok) throw new Error(`Create failed (${res.status}): ${filename} → ${scopeId}`);
}
