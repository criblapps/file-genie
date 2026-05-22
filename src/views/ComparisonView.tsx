import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { loadInventory } from '../services/inventory';
import { compareLookupContents } from '../services/sync';
import { compareMetadata } from '../services/diff';
import { DiffViewer } from '../components/DiffViewer';
import { SyncModal } from '../components/SyncModal';
import { StatusBadge } from '../components/StatusBadge';
import { listAllScopes } from '../api/cribl';
import type { LookupRecord, Scope } from '../types';

export function ComparisonView() {
  const { name } = useParams<{ name: string }>();
  const lookupName = decodeURIComponent(name ?? '');

  const [records, setRecords] = useState<LookupRecord[]>([]);
  const [allScopes, setAllScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [result, scopes] = await Promise.all([loadInventory(), listAllScopes()]);
        const matching = result.records.filter((r) => r.name === lookupName);
        setRecords(matching);
        setAllScopes(scopes);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [lookupName]);

  // Split into direct (group/fleet) records and pack records grouped by pack ID
  const directRecords = useMemo(
    () => records.filter((r) => r.scopeType !== 'pack'),
    [records],
  );

  const packGroups = useMemo(() => {
    const map = new Map<string, { packName: string; records: LookupRecord[] }>();
    for (const r of records) {
      if (r.scopeType !== 'pack') continue;
      if (!map.has(r.scopeId)) map.set(r.scopeId, { packName: r.scopeName, records: [] });
      map.get(r.scopeId)!.records.push(r);
    }
    return map;
  }, [records]);

  if (loading) {
    return (
      <div className="view">
        <div className="loading-bar"><div className="spinner spinner--sm" /> Loading…</div>
      </div>
    );
  }

  if (error) {
    return <div className="view"><div className="alert alert--danger">{error}</div></div>;
  }

  if (records.length === 0) {
    return (
      <div className="view">
        <div className="view__header">
          <Link to="/" className="back-link">← Inventory</Link>
        </div>
        <div className="empty-state">No records found for <strong>{lookupName}</strong>.</div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view__header">
        <div>
          <Link to="/" className="back-link">← Inventory</Link>
          <h1 className="view__title">{lookupName}</h1>
          <p className="view__subtitle">
            {directRecords.length > 0 && `${directRecords.length} direct cop${directRecords.length !== 1 ? 'ies' : 'y'}`}
            {directRecords.length > 0 && packGroups.size > 0 && ' · '}
            {packGroups.size > 0 && `${packGroups.size} pack${packGroups.size !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="btn-group">
          <Link to={`/lookup/${encodeURIComponent(lookupName)}/edit`} className="btn btn--ghost">
            Edit &amp; Push
          </Link>
        </div>
      </div>

      {/* Direct (group/fleet) copies section */}
      {(directRecords.length > 0 || allScopes.some((s) => s.type !== 'pack')) && (
        <DirectSection
          lookupName={lookupName}
          records={directRecords}
          allScopes={allScopes.filter((s) => s.type !== 'pack')}
        />
      )}

      {/* Per-pack sections */}
      {[...packGroups.entries()].map(([packId, { packName, records: packRecs }]) => (
        <PackSection
          key={packId}
          packName={packName}
          records={packRecs}
          allScopes={allScopes}
        />
      ))}
    </div>
  );
}

// ── Direct copies section (group/fleet) ───────────────────────────────────────

function DirectSection({
  lookupName,
  records,
  allScopes,
}: {
  lookupName: string;
  records: LookupRecord[];
  allScopes: Scope[]; // non-pack scopes only
}) {
  const [selectedA, setSelectedA] = useState(records[0]?.id ?? '');
  const [selectedB, setSelectedB] = useState(records[1]?.id ?? '');
  const [diffData, setDiffData] = useState<{ contentA: string; contentB: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [sourceOfTruth, setSourceOfTruth] = useState(records[0]?.id ?? '');
  const [showSyncModal, setShowSyncModal] = useState(false);

  const missingScopes = useMemo(() => {
    const presentIds = new Set(records.map((r) => r.scopeId));
    return allScopes.filter((s) => !presentIds.has(s.id)).map((s) => ({
      id: `${s.type}:${s.id}:${lookupName}`,
      name: lookupName,
      scopeType: s.type,
      scopeId: s.id,
      scopeName: s.name,
      parentScopeId: s.parentScopeId,
      path: lookupName,
      exists: false,
      syncStatus: 'missing' as const,
    } satisfies LookupRecord));
  }, [records, allScopes, lookupName]);

  const metaDiffs = useMemo(() => compareMetadata(records), [records]);
  const recordA = records.find((r) => r.id === selectedA);
  const recordB = records.find((r) => r.id === selectedB);
  const sourceTruthRecord = records.find((r) => r.id === sourceOfTruth);
  const syncTargets = records.filter((r) => r.id !== sourceOfTruth);

  async function loadDiff() {
    if (!recordA || !recordB) return;
    setDiffLoading(true);
    setDiffError('');
    setDiffData(null);
    try {
      const result = await compareLookupContents(recordA, recordB);
      setDiffData(result);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to fetch content');
    } finally {
      setDiffLoading(false);
    }
  }

  if (records.length === 0 && missingScopes.length === 0) return null;

  return (
    <>
      <section className="card">
        <h2 className="section-title">Direct Copies — Groups &amp; Fleets</h2>
        {records.length === 0 ? (
          <p className="muted">This file does not exist directly on any group or fleet.</p>
        ) : (
          <div className="scope-presence-grid">
            {records.map((r) => (
              <ScopeCard
                key={r.id}
                record={r}
                isSource={sourceOfTruth === r.id}
                onSetSource={() => setSourceOfTruth(r.id)}
              />
            ))}
            {missingScopes.map((r) => (
              <MissingScopeCard key={r.id} record={r} />
            ))}
          </div>
        )}
        {sourceTruthRecord && (
          <div className="card__footer">
            <button
              className="btn btn--primary"
              onClick={() => setShowSyncModal(true)}
              disabled={syncTargets.length + missingScopes.length === 0}
            >
              Sync from {sourceTruthRecord.scopeName}
            </button>
          </div>
        )}
      </section>

      {records.length >= 2 && (
        <MetadataSection records={records} metaDiffs={metaDiffs} />
      )}

      {records.length >= 2 && (
        <ContentDiffSection
          records={records}
          selectedA={selectedA}
          selectedB={selectedB}
          diffData={diffData}
          diffLoading={diffLoading}
          diffError={diffError}
          recordA={recordA}
          recordB={recordB}
          onSelectA={(id) => { setSelectedA(id); setDiffData(null); }}
          onSelectB={(id) => { setSelectedB(id); setDiffData(null); }}
          onLoadDiff={loadDiff}
        />
      )}

      {showSyncModal && sourceTruthRecord && (
        <SyncModal
          source={sourceTruthRecord}
          candidates={[...syncTargets, ...missingScopes]}
          allScopes={allScopes}
          onClose={() => setShowSyncModal(false)}
          onSyncComplete={() => setShowSyncModal(false)}
        />
      )}
    </>
  );
}

// ── Pack section ──────────────────────────────────────────────────────────────

function PackSection({
  packName,
  records,
  allScopes,
}: {
  packName: string;
  records: LookupRecord[];
  allScopes: Scope[];
}) {
  const [selectedA, setSelectedA] = useState(records[0]?.id ?? '');
  const [selectedB, setSelectedB] = useState(records[1]?.id ?? '');
  const [diffData, setDiffData] = useState<{ contentA: string; contentB: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [sourceOfTruth, setSourceOfTruth] = useState(records[0]?.id ?? '');
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Pack files are never flagged as "missing" — a pack on one group is not required
  // to contain every file that the same pack has on another group.
  const missingScopes: LookupRecord[] = [];

  const metaDiffs = useMemo(() => compareMetadata(records), [records]);
  const recordA = records.find((r) => r.id === selectedA);
  const recordB = records.find((r) => r.id === selectedB);
  const sourceTruthRecord = records.find((r) => r.id === sourceOfTruth);
  const syncTargets = records.filter((r) => r.id !== sourceOfTruth);

  // Label each scope card with the parent group name for clarity
  const parentGroupMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allScopes) {
      if (s.type !== 'pack') m.set(s.id, s.name);
    }
    return m;
  }, [allScopes]);

  async function loadDiff() {
    if (!recordA || !recordB) return;
    setDiffLoading(true);
    setDiffError('');
    setDiffData(null);
    try {
      const result = await compareLookupContents(recordA, recordB);
      setDiffData(result);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to fetch content');
    } finally {
      setDiffLoading(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="section-title-row">
          <h2 className="section-title">
            <span className="scope-type-badge scope-type-badge--pack">pack</span>
            {packName}
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {records.length} cop{records.length !== 1 ? 'ies' : 'y'} across {records.length + missingScopes.length} group{records.length + missingScopes.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="scope-presence-grid">
          {records.map((r) => (
            <ScopeCard
              key={r.id}
              record={r}
              isSource={sourceOfTruth === r.id}
              onSetSource={() => setSourceOfTruth(r.id)}
              subtitle={r.parentScopeId ? (parentGroupMap.get(r.parentScopeId) ?? r.parentScopeId) : undefined}
            />
          ))}
          {missingScopes.map((r) => (
            <MissingScopeCard
              key={r.id}
              record={r}
              subtitle={r.parentScopeId ? (parentGroupMap.get(r.parentScopeId) ?? r.parentScopeId) : undefined}
            />
          ))}
        </div>
        {sourceTruthRecord && (
          <div className="card__footer">
            <button
              className="btn btn--primary"
              onClick={() => setShowSyncModal(true)}
              disabled={syncTargets.length + missingScopes.length === 0}
            >
              Sync from {sourceTruthRecord.parentScopeId
                ? (parentGroupMap.get(sourceTruthRecord.parentScopeId) ?? sourceTruthRecord.scopeName)
                : sourceTruthRecord.scopeName}
            </button>
          </div>
        )}
      </section>

      {records.length >= 2 && (
        <MetadataSection records={records} metaDiffs={metaDiffs} labelFn={(r) =>
          r.parentScopeId ? (parentGroupMap.get(r.parentScopeId) ?? r.scopeName) : r.scopeName
        } />
      )}

      {records.length >= 2 && (
        <ContentDiffSection
          records={records}
          selectedA={selectedA}
          selectedB={selectedB}
          diffData={diffData}
          diffLoading={diffLoading}
          diffError={diffError}
          recordA={recordA}
          recordB={recordB}
          onSelectA={(id) => { setSelectedA(id); setDiffData(null); }}
          onSelectB={(id) => { setSelectedB(id); setDiffData(null); }}
          onLoadDiff={loadDiff}
          labelFn={(r) =>
            r.parentScopeId ? (parentGroupMap.get(r.parentScopeId) ?? r.scopeName) : r.scopeName
          }
        />
      )}

      {showSyncModal && sourceTruthRecord && (
        <SyncModal
          source={sourceTruthRecord}
          candidates={[...syncTargets, ...missingScopes]}
          allScopes={allScopes}
          onClose={() => setShowSyncModal(false)}
          onSyncComplete={() => setShowSyncModal(false)}
        />
      )}
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

interface MetaDiff {
  field: string;
  values: Record<string, string | undefined>;
  isDifferent: boolean;
}

function MetadataSection({
  records,
  metaDiffs,
  labelFn,
}: {
  records: LookupRecord[];
  metaDiffs: MetaDiff[];
  labelFn?: (r: LookupRecord) => string;
}) {
  const label = (r: LookupRecord) => (labelFn ? labelFn(r) : r.scopeName);
  return (
    <section className="card">
      <h2 className="section-title">Metadata Comparison</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Field</th>
              {records.map((r) => <th key={r.id}>{label(r)}</th>)}
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {metaDiffs.map((diff) => (
              <tr key={diff.field} className={diff.isDifferent ? 'row--warn' : ''}>
                <td className="col-mono">{diff.field}</td>
                {records.map((r) => (
                  <td key={r.id} className="col-mono">
                    {diff.values[r.scopeId] ?? <span className="muted">—</span>}
                  </td>
                ))}
                <td>
                  {diff.isDifferent
                    ? <span className="badge badge--out_of_sync badge--sm">Different</span>
                    : <span className="badge badge--in_sync badge--sm">Same</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContentDiffSection({
  records,
  selectedA,
  selectedB,
  diffData,
  diffLoading,
  diffError,
  recordA,
  recordB,
  onSelectA,
  onSelectB,
  onLoadDiff,
  labelFn,
}: {
  records: LookupRecord[];
  selectedA: string;
  selectedB: string;
  diffData: { contentA: string; contentB: string } | null;
  diffLoading: boolean;
  diffError: string;
  recordA?: LookupRecord;
  recordB?: LookupRecord;
  onSelectA: (id: string) => void;
  onSelectB: (id: string) => void;
  onLoadDiff: () => void;
  labelFn?: (r: LookupRecord) => string;
}) {
  const label = (r: LookupRecord) => (labelFn ? labelFn(r) : r.scopeName);
  return (
    <section className="card">
      <h2 className="section-title">Content Diff</h2>
      <div className="diff-selectors">
        <div className="filter-group">
          <label className="filter-label">Compare A</label>
          <select className="select" value={selectedA} onChange={(e) => onSelectA(e.target.value)}>
            {records.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
          </select>
        </div>
        <span className="diff-arrow">vs</span>
        <div className="filter-group">
          <label className="filter-label">Compare B</label>
          <select className="select" value={selectedB} onChange={(e) => onSelectB(e.target.value)}>
            {records.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
          </select>
        </div>
        <button
          className="btn btn--primary"
          onClick={onLoadDiff}
          disabled={diffLoading || selectedA === selectedB || !selectedA || !selectedB}
        >
          {diffLoading ? 'Fetching…' : 'Load Diff'}
        </button>
      </div>
      {diffError && <div className="alert alert--danger">{diffError}</div>}
      {diffData && recordA && recordB && (
        <DiffViewer
          contentA={diffData.contentA}
          contentB={diffData.contentB}
          labelA={label(recordA)}
          labelB={label(recordB)}
        />
      )}
      {!diffData && !diffLoading && !diffError && (
        <div className="diff-prompt">Select two scopes and click "Load Diff" to compare file content.</div>
      )}
    </section>
  );
}

function ScopeCard({
  record: r,
  isSource,
  onSetSource,
  subtitle,
}: {
  record: LookupRecord;
  isSource: boolean;
  onSetSource: () => void;
  subtitle?: string;
}) {
  return (
    <div className={`scope-card ${isSource ? 'scope-card--source' : ''}`}>
      <div className="scope-card__header">
        <span className={`scope-type-badge scope-type-badge--${r.scopeType}`}>{r.scopeType}</span>
        {isSource && <span className="badge badge--in_sync badge--sm">Source of Truth</span>}
      </div>
      <div className="scope-card__name">{subtitle ?? r.scopeName}</div>
      {subtitle && <div className="scope-card__sub muted">{r.scopeName}</div>}
      <div className="scope-card__meta">
        {r.size != null && <span>{formatBytes(r.size)}</span>}
        {r.lastModified && <span title={r.lastModified}>{new Date(r.lastModified).toLocaleDateString()}</span>}
        {r.lastModifiedBy && <span>{r.lastModifiedBy}</span>}
      </div>
      {r.hash && <code className="hash hash--sm">{r.hash.slice(0, 12)}</code>}
      <div className="scope-card__actions">
        <button
          className={`btn btn--sm ${isSource ? 'btn--primary' : 'btn--ghost'}`}
          onClick={onSetSource}
        >
          {isSource ? 'Source ✓' : 'Set as Source'}
        </button>
      </div>
      <StatusBadge status={r.syncStatus} size="sm" />
    </div>
  );
}

function MissingScopeCard({ record: r, subtitle }: { record: LookupRecord; subtitle?: string }) {
  return (
    <div className="scope-card scope-card--missing">
      <div className="scope-card__header">
        <span className={`scope-type-badge scope-type-badge--${r.scopeType}`}>{r.scopeType}</span>
        <span className="badge badge--missing badge--sm">Missing</span>
      </div>
      <div className="scope-card__name">{subtitle ?? r.scopeName}</div>
      {subtitle && <div className="scope-card__sub muted">{r.scopeName}</div>}
      <div className="scope-card__meta muted">Not present in this scope</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
