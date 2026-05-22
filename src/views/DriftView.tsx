import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { loadInventory, buildDriftGroups } from '../services/inventory';
import { listAllScopes } from '../api/cribl';
import { DriftBadges, StatusBadge } from '../components/StatusBadge';
import type { DriftGroup, Scope } from '../types';

type DriftFilter = 'all' | 'out_of_sync' | 'in_sync' | 'sole_copy' | 'missing' | 'content' | 'meta';

export function DriftView() {
  const [groups, setGroups] = useState<DriftGroup[]>([]);
  const [allScopes, setAllScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<DriftFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [result, scopes] = await Promise.all([loadInventory(), listAllScopes()]);
        setAllScopes(scopes);
        setGroups(buildDriftGroups(result.records, scopes));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const stats = useMemo(() => {
    const total = groups.length;
    const inSync = groups.filter((g) => g.status === 'in_sync').length;
    const outOfSync = groups.filter((g) => g.status === 'out_of_sync').length;
    // sole_copy: exists in exactly one scope — distribution question, not a drift problem
    const soleCopy = groups.filter((g) => g.records.length === 1).length;
    const missingCopies = groups.filter((g) => g.hasMissingCopies).length;
    const contentDiff = groups.filter((g) => g.hasContentDiff).length;
    const metaDiff = groups.filter((g) => g.hasMetaDiff && !g.hasContentDiff).length;
    return { total, inSync, outOfSync, soleCopy, missingCopies, contentDiff, metaDiff };
  }, [groups]);

  const filtered = useMemo(() => {
    let result = groups;
    if (search) result = result.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
    switch (filter) {
      case 'out_of_sync': result = result.filter((g) => g.status === 'out_of_sync'); break;
      case 'in_sync':     result = result.filter((g) => g.status === 'in_sync'); break;
      case 'sole_copy':   result = result.filter((g) => g.records.length === 1); break;
      case 'missing':     result = result.filter((g) => g.hasMissingCopies); break;
      case 'content':     result = result.filter((g) => g.hasContentDiff); break;
      case 'meta':        result = result.filter((g) => g.hasMetaDiff && !g.hasContentDiff); break;
    }
    // Sort: out_of_sync first, then by name
    return [...result].sort((a, b) => {
      if (a.status === 'out_of_sync' && b.status !== 'out_of_sync') return -1;
      if (a.status !== 'out_of_sync' && b.status === 'out_of_sync') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [groups, filter, search]);

  const FILTER_OPTIONS: Array<{ value: DriftFilter; label: string; count?: number }> = [
    { value: 'all',        label: 'All',            count: stats.total },
    { value: 'out_of_sync', label: 'Out of Sync',   count: stats.outOfSync },
    { value: 'in_sync',    label: 'In Sync',        count: stats.inSync },
    { value: 'sole_copy',  label: 'Sole Copy',      count: stats.soleCopy },
    { value: 'missing',    label: 'Missing Copies', count: stats.missingCopies },
    { value: 'content',    label: 'Content Diff',   count: stats.contentDiff },
    { value: 'meta',       label: 'Meta Only',      count: stats.metaDiff },
  ];

  if (loading) {
    return <div className="view"><div className="loading-bar"><div className="spinner spinner--sm" /> Loading drift data…</div></div>;
  }

  if (error) {
    return <div className="view"><div className="alert alert--danger">{error}</div></div>;
  }

  return (
    <div className="view">
      <div className="view__header">
        <div>
          <h1 className="view__title">Drift Dashboard</h1>
          <p className="view__subtitle">
            {allScopes.length} scope{allScopes.length !== 1 ? 's' : ''} monitored · {groups.length} unique lookup names
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="stat-grid">
        <StatCard label="Total Lookups" value={stats.total} />
        <StatCard label="In Sync" value={stats.inSync} tone="success" />
        <StatCard label="Out of Sync" value={stats.outOfSync} tone="danger" onClick={() => setFilter('out_of_sync')} />
        <StatCard label="Sole Copy" value={stats.soleCopy} tone="info" onClick={() => setFilter('sole_copy')} />
        <StatCard label="Missing Copies" value={stats.missingCopies} tone="warning" onClick={() => setFilter('missing')} />
        <StatCard label="Content Diffs" value={stats.contentDiff} tone="danger" onClick={() => setFilter('content')} />
        <StatCard label="Meta Only Diffs" value={stats.metaDiff} tone="warning" onClick={() => setFilter('meta')} />
      </div>

      {/* Filters */}
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search by filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="pill-filters">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`pill-filter ${filter === opt.value ? 'pill-filter--active' : ''}`}
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
              {opt.count !== undefined && <span className="pill-filter__count">{opt.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          {groups.length === 0
            ? 'No lookup files found. Refresh scan from the Inventory view.'
            : 'No files match the current filter.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Present In</th>
                <th>Missing From</th>
                <th>Drift Details</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <DriftRow key={g.comparisonKey} group={g} allScopes={allScopes} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DriftRow({ group, allScopes }: { group: DriftGroup; allScopes: Scope[] }) {
  // Build a map for quick name resolution (works for both group IDs and pack IDs)
  const scopeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allScopes) m.set(s.id, s.name);
    return m;
  }, [allScopes]);

  // For pack drift groups, presentScopes are parent group IDs; resolve to group names.
  // For direct drift groups, presentScopes are scope IDs; resolve normally.
  const presentNames = group.packId
    ? group.presentScopes.map((id) => scopeNameMap.get(id) ?? id).join(', ')
    : group.records.map((r) => r.scopeName).join(', ');

  // missingScopes for pack groups = parent group IDs; for direct groups = scope IDs.
  const missingNames = group.missingScopes
    .map((id) => scopeNameMap.get(id) ?? id)
    .join(', ');

  return (
    <tr className={group.status === 'out_of_sync' ? 'row--warn' : ''}>
      <td>
        <Link to={`/lookup/${encodeURIComponent(group.name)}`} className="lookup-name-link">
          {group.name}
        </Link>
        {group.packId && (
          <div className="drift-pack-label">
            <span className="scope-type-badge scope-type-badge--pack">pack</span>
            {/* Show the pack display name from the first record */}
            {group.records[0]?.scopeName ?? group.packId}
          </div>
        )}
      </td>
      <td>
        <span className="scope-list">{presentNames || '—'}</span>
      </td>
      <td>
        {missingNames
          ? <span className="scope-list scope-list--missing">{missingNames}</span>
          : <span className="muted">—</span>}
      </td>
      <td>
        <DriftBadges
          hasContentDiff={group.hasContentDiff}
          hasMetaDiff={group.hasMetaDiff}
          hasMissingCopies={group.hasMissingCopies}
        />
      </td>
      <td>
        <StatusBadge status={group.status} size="sm" />
      </td>
      <td>
        <Link to={`/lookup/${encodeURIComponent(group.name)}`} className="btn btn--sm btn--ghost">
          Inspect
        </Link>
      </td>
    </tr>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'warning' | 'info';
  onClick?: () => void;
}

function StatCard({ label, value, tone, onClick }: StatCardProps) {
  const cls = ['stat-card', tone ? `stat-card--${tone}` : '', onClick ? 'stat-card--clickable' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}
