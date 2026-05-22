import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadInventory, scanAllScopes, comparisonKey } from '../services/inventory';
import { StatusBadge } from '../components/StatusBadge';
import type { LookupRecord, ScanResult, SyncStatus } from '../types';

// ── Grouped row model ─────────────────────────────────────────────────────────

interface GroupedRow {
  name: string;
  comparisonKey: string;
  packId?: string;
  packName?: string;
  records: LookupRecord[];
  syncStatus: SyncStatus | undefined;
  scopeCount: number;
  latestModified: string | undefined;
  latestModifiedBy: string | undefined;
  // size: same value if all copies agree, undefined if they vary
  size: number | undefined;
  sizeVaries: boolean;
}

// Priority order for "worst wins" status aggregation across comparison groups.
// A file that is out_of_sync in any pack/scope context shows as out_of_sync.
const STATUS_PRIORITY: Record<SyncStatus, number> = {
  out_of_sync: 4,
  unknown:     3,
  sole_copy:   2,
  missing:     1,
  in_sync:     0,
};

function worstStatus(statuses: (SyncStatus | undefined)[]): SyncStatus | undefined {
  let worst: SyncStatus | undefined;
  for (const s of statuses) {
    if (s == null) continue;
    if (worst == null || STATUS_PRIORITY[s] > STATUS_PRIORITY[worst]) worst = s;
  }
  return worst;
}

function groupRecords(records: LookupRecord[], packAware = false): GroupedRow[] {
  const map = new Map<string, LookupRecord[]>();
  for (const r of records) {
    // When pack-aware, group by comparison key so each pack gets its own row.
    // When not pack-aware, group by filename (packs are already excluded from records).
    const key = packAware ? comparisonKey(r) : r.name;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([key, recs]) => {
    const isPack = recs[0]?.scopeType === 'pack';
    const sizes = recs.map((r) => r.size).filter((s): s is number => s != null);
    const uniqueSizes = new Set(sizes);
    const mods = recs.map((r) => r.lastModified).filter(Boolean).sort().reverse();
    const mostRecent = mods[0];
    const latestRec = recs.find((r) => r.lastModified === mostRecent);
    return {
      name: recs[0]?.name ?? key,
      comparisonKey: key,
      packId: isPack ? recs[0].scopeId : undefined,
      packName: isPack ? recs[0].scopeName : undefined,
      records: recs,
      // Pack rows: all records in the group share the same status from applyGroupSyncStatus.
      // Direct rows: worst-wins across all group/fleet copies.
      syncStatus: isPack
        ? recs[0]?.syncStatus
        : worstStatus(recs.map((r) => r.syncStatus)),
      scopeCount: recs.length,
      latestModified: mostRecent,
      latestModifiedBy: latestRec?.lastModifiedBy,
      size: uniqueSizes.size === 1 ? sizes[0] : undefined,
      sizeVaries: uniqueSizes.size > 1,
    };
  });
}

// ── Column visibility ─────────────────────────────────────────────────────────

type ColKey = 'foundIn' | 'size' | 'lastModified' | 'status';

const COL_LABELS: Record<ColKey, string> = {
  foundIn: 'Found In',
  size: 'Size',
  lastModified: 'Last Modified',
  status: 'Status',
};

const DEFAULT_COLS: Record<ColKey, boolean> = {
  foundIn: true,
  size: false,
  lastModified: false,
  status: true,
};

// ── Sort / filter types ───────────────────────────────────────────────────────

type SortField = 'name' | 'scopeCount' | 'latestModified' | 'size' | 'syncStatus';
type SortDir = 'asc' | 'desc';

const STATUS_FILTERS: Array<{ value: SyncStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'in_sync', label: 'In Sync' },
  { value: 'out_of_sync', label: 'Out of Sync' },
  { value: 'sole_copy', label: 'Sole Copy' },
  { value: 'unknown', label: 'Unknown' },
];

// ── View ──────────────────────────────────────────────────────────────────────

export function InventoryView() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SyncStatus | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [includePacks, setIncludePacks] = useState(false);
  const [hideSoleCopy, setHideSoleCopy] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(DEFAULT_COLS);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  async function load(force = false) {
    setLoading(true);
    setError('');
    setProgress('Loading…');
    try {
      const result = force
        ? await scanAllScopes((msg) => setProgress(msg))
        : await loadInventory(false);
      setScan(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!colPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colPickerOpen]);

  function toggleCol(col: ColKey) {
    setVisibleCols((prev) => ({ ...prev, [col]: !prev[col] }));
  }

  const records = scan?.records ?? [];

  const scopeOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const r of records) {
      if (!includePacks && r.scopeType === 'pack') continue;
      ids.set(r.scopeId, r.scopeName);
    }
    return [['all', includePacks ? 'All Groups/Fleets/Packs' : 'All Groups/Fleets'], ...ids.entries()];
  }, [records, includePacks]);

  // Group first, then filter and sort on the grouped rows
  const visibleRecords = useMemo(
    () => (includePacks ? records : records.filter((r) => r.scopeType !== 'pack')),
    [records, includePacks],
  );
  const allGrouped = useMemo(
    () => groupRecords(visibleRecords, includePacks),
    [visibleRecords, includePacks],
  );

  // Map groupId → groupName for resolving pack row parent labels
  const parentGroupMap = useMemo(() => buildParentGroupMap(records), [records]);

  const filtered = useMemo(() => {
    let rows = allGrouped;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((g) => g.name.toLowerCase().includes(q));
    }
    if (hideSoleCopy) {
      rows = rows.filter((g) => g.syncStatus !== 'sole_copy');
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((g) => g.syncStatus === statusFilter);
    }
    if (scopeFilter !== 'all') {
      // Show only files that exist in the selected scope
      rows = rows.filter((g) => g.records.some((r) => r.scopeId === scopeFilter));
    }
    return rows;
  }, [allGrouped, search, statusFilter, scopeFilter, hideSoleCopy]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      switch (sortField) {
        case 'name':          va = a.name; vb = b.name; break;
        case 'scopeCount':    va = a.scopeCount; vb = b.scopeCount; break;
        case 'latestModified': va = a.latestModified ?? ''; vb = b.latestModified ?? ''; break;
        case 'size':          va = a.size ?? -1; vb = b.size ?? -1; break;
        case 'syncStatus':    va = a.syncStatus ?? ''; vb = b.syncStatus ?? ''; break;
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="sort-icon sort-icon--inactive">↕</span>;
    return <span className="sort-icon">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const outOfSyncCount = allGrouped.filter((g) => g.syncStatus === 'out_of_sync').length;
  const soleCopyCount = allGrouped.filter((g) => g.syncStatus === 'sole_copy').length;
  const uniqueFileCount = allGrouped.length;

  return (
    <div className="view">
      <div className="view__header">
        <div>
          <h1 className="view__title">Lookup Inventory</h1>
          {scan && (
            <p className="view__subtitle">
              {uniqueFileCount} unique file{uniqueFileCount !== 1 ? 's' : ''} · {records.length} copies across {scan.scopeCount} scope{scan.scopeCount !== 1 ? 's' : ''} · scanned {new Date(scan.scannedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="btn-group">
          <button className="btn btn--ghost" onClick={() => load(false)} disabled={loading}>
            Use Cache
          </button>
          <button className="btn btn--primary" onClick={() => load(true)} disabled={loading}>
            {loading ? 'Scanning…' : 'Refresh Scan'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading-bar">
          <div className="spinner spinner--sm" />
          {progress}
        </div>
      )}

      {error && <div className="alert alert--danger">{error}</div>}

      {!loading && (outOfSyncCount > 0 || soleCopyCount > 0) && (
        <div className="drift-alert">
          {outOfSyncCount > 0 && (
            <span>
              <span className="badge badge--out_of_sync">{outOfSyncCount}</span>{' '}
              file{outOfSyncCount !== 1 ? 's' : ''} out of sync
            </span>
          )}
          {soleCopyCount > 0 && (
            <span>
              <span className="badge badge--sole_copy">{soleCopyCount}</span>{' '}
              sole cop{soleCopyCount !== 1 ? 'ies' : 'y'} — not distributed
            </span>
          )}
          <Link to="/drift" className="btn btn--sm btn--ghost">View Drift Dashboard →</Link>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search by filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-group">
          <label className="filter-label">Status</label>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SyncStatus | 'all')}>
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label">Scope</label>
          <select className="select" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
            {scopeOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <button
          className={`btn btn--sm ${includePacks ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => { setIncludePacks((p) => !p); setScopeFilter('all'); }}
          title={includePacks ? 'Click to exclude packs' : 'Click to include packs'}
        >
          {includePacks ? 'Packs: On' : 'Packs: Off'}
        </button>

        <button
          className={`btn btn--sm ${hideSoleCopy ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setHideSoleCopy((s) => !s)}
          title={hideSoleCopy ? 'Sole copies hidden — click to show' : 'Click to hide sole copy files'}
        >
          {hideSoleCopy ? 'Sole Copy: Hidden' : 'Hide Sole Copy'}
        </button>

        <span className="toolbar__count">{sorted.length} of {uniqueFileCount}</span>

        {/* Column visibility picker */}
        <div className="col-picker" ref={colPickerRef}>
          <button
            className="btn btn--ghost btn--sm col-picker__trigger"
            onClick={() => setColPickerOpen((o) => !o)}
            title="Show/hide columns"
          >
            <ColsIcon /> Columns
          </button>
          {colPickerOpen && (
            <div className="col-picker__menu">
              {(Object.keys(COL_LABELS) as ColKey[]).map((col) => (
                <label key={col} className="col-picker__item">
                  <input
                    type="checkbox"
                    checked={visibleCols[col]}
                    onChange={() => toggleCol(col)}
                  />
                  {COL_LABELS[col]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {scan && sorted.length === 0 && !loading && (
        <div className="empty-state">
          {records.length === 0
            ? 'No lookup files found. Try refreshing the scan.'
            : 'No files match the current filters.'}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-sortable col--name" onClick={() => toggleSort('name')}>
                  Name <SortIcon field="name" />
                </th>
                {visibleCols.foundIn && (
                  <th className="col-sortable" onClick={() => toggleSort('scopeCount')}>
                    Found In <SortIcon field="scopeCount" />
                  </th>
                )}
                {visibleCols.size && (
                  <th className="col-sortable col--narrow" onClick={() => toggleSort('size')}>
                    Size <SortIcon field="size" />
                  </th>
                )}
                {visibleCols.lastModified && (
                  <th className="col-sortable col--narrow" onClick={() => toggleSort('latestModified')}>
                    Last Modified <SortIcon field="latestModified" />
                  </th>
                )}
                {visibleCols.status && (
                  <th className="col-sortable col--narrow" onClick={() => toggleSort('syncStatus')}>
                    Status <SortIcon field="syncStatus" />
                  </th>
                )}
                <th className="col--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => (
                <GroupedRow
                  key={g.comparisonKey}
                  group={g}
                  highlightScope={scopeFilter !== 'all' ? scopeFilter : undefined}
                  visibleCols={visibleCols}
                  parentGroupMap={parentGroupMap}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Grouped row component ─────────────────────────────────────────────────────

const MAX_VISIBLE_SCOPES = 4;

const SCOPE_LABELS: Record<string, string> = {
  group: 'Worker Group',
  fleet: 'Fleet',
  pack: 'Pack',
};

// Build a map of groupId → groupName from all records in the inventory.
// Used to resolve parentScopeId labels for pack rows.
function buildParentGroupMap(records: LookupRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of records) {
    if (r.scopeType !== 'pack') m.set(r.scopeId, r.scopeName);
  }
  return m;
}

function GroupedRow({
  group: g,
  highlightScope,
  visibleCols,
  parentGroupMap,
}: {
  group: GroupedRow;
  highlightScope?: string;
  visibleCols: Record<ColKey, boolean>;
  parentGroupMap: Map<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const visibleScopes = showAll ? g.records : g.records.slice(0, MAX_VISIBLE_SCOPES);
  const overflow = g.records.length - MAX_VISIBLE_SCOPES;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // For pack rows, chips show the parent group name (pack identity is already in the Name cell).
  // For direct rows, chips show the scope name as before.
  function chipLabel(r: LookupRecord): string {
    if (r.scopeType === 'pack' && r.parentScopeId) {
      return parentGroupMap.get(r.parentScopeId) ?? r.parentScopeId;
    }
    return r.scopeName;
  }

  // For pack rows, highlight by parentScopeId; for direct rows, highlight by scopeId.
  function isHighlighted(r: LookupRecord): boolean {
    if (!highlightScope) return false;
    return r.scopeType === 'pack'
      ? r.parentScopeId === highlightScope
      : r.scopeId === highlightScope;
  }

  return (
    <tr className={g.syncStatus === 'out_of_sync' ? 'row--warn' : ''}>
      <td>
        <Link to={`/lookup/${encodeURIComponent(g.name)}`} className="lookup-name-link">
          {g.name}
        </Link>
        {g.packId && (
          <div className="drift-pack-label">
            <span className="scope-type-badge scope-type-badge--pack">pack</span>
            {g.packName}
          </div>
        )}
      </td>
      {visibleCols.foundIn && (
        <td>
          <div className="scope-chips">
            {visibleScopes.map((r) => (
              <span
                key={r.id}
                className={`scope-chip scope-chip--${g.packId ? 'group' : r.scopeType}${isHighlighted(r) ? ' scope-chip--highlight' : ''}`}
                title={r.scopeId}
              >
                {!g.packId && (
                  <span className="scope-chip__type">{SCOPE_LABELS[r.scopeType]}</span>
                )}
                {chipLabel(r)}
              </span>
            ))}
            {!showAll && overflow > 0 && (
              <button
                className="scope-chip-overflow"
                onClick={() => setShowAll(true)}
                title="Show all scopes"
              >
                +{overflow} more
              </button>
            )}
          </div>
        </td>
      )}
      {visibleCols.size && (
        <td className="col-mono">
          {g.sizeVaries
            ? <span className="muted" title="Size differs across scopes">varies</span>
            : g.size != null
              ? formatBytes(g.size)
              : <span className="muted">—</span>}
        </td>
      )}
      {visibleCols.lastModified && (
        <td className="col-mono">
          {g.latestModified ? (
            <span title={g.latestModified}>
              {formatRelative(g.latestModified)}
              {g.latestModifiedBy && <span className="muted"> · {g.latestModifiedBy}</span>}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      )}
      {visibleCols.status && (
        <td>
          <StatusBadge status={g.syncStatus} size="sm" />
        </td>
      )}
      <td>
        <div className="row-actions" ref={menuRef}>
          <button
            className="row-actions__trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Row actions"
            title="Actions"
          >
            <EllipsisIcon />
          </button>
          {menuOpen && (
            <div className="row-actions__menu">
              <button className="row-actions__item" onClick={() => { setMenuOpen(false); navigate(`/lookup/${encodeURIComponent(g.name)}`); }}>
                Compare
              </button>
              <button className="row-actions__item" onClick={() => { setMenuOpen(false); navigate(`/lookup/${encodeURIComponent(g.name)}/edit`); }}>
                Edit &amp; Push
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function EllipsisIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="13" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function ColsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 4 }}>
      <rect x="1" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
