import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getLookupContent } from '../api/cribl';
import { loadInventory } from '../services/inventory';
import { syncContentToTargets } from '../services/sync';
import { hashString } from '../services/diff';
import { LookupEditor } from '../components/LookupEditor';
import { StatusBadge } from '../components/StatusBadge';
import type { LookupRecord, SyncResult } from '../types';

type Phase = 'load-source' | 'edit' | 'select-targets' | 'confirm' | 'pushing' | 'results';

export function EditView() {
  const { name } = useParams<{ name: string }>();
  const lookupName = decodeURIComponent(name ?? '');
  const navigate = useNavigate();

  // Source data
  const [records, setRecords] = useState<LookupRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [recordsError, setRecordsError] = useState('');

  // Content loading
  const [sourceId, setSourceId] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState('');

  // Editor state
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [phase, setPhase] = useState<Phase>('load-source');

  // Push state
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [skipIdentical, setSkipIdentical] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [pushProgress, setPushProgress] = useState('');
  const [results, setResults] = useState<SyncResult[]>([]);

  useEffect(() => {
    async function load() {
      setLoadingRecords(true);
      try {
        const result = await loadInventory();
        const matching = result.records.filter((r) => r.name === lookupName);
        setRecords(matching);
        if (matching.length > 0) setSourceId(matching[0].id);
      } catch (e) {
        setRecordsError(e instanceof Error ? e.message : 'Failed to load records');
      } finally {
        setLoadingRecords(false);
      }
    }
    load();
  }, [lookupName]);

  async function loadContent() {
    const record = records.find((r) => r.id === sourceId);
    if (!record) return;
    setLoadingContent(true);
    setContentError('');
    try {
      const text = await getLookupContent(record.scopeId, record.name);
      setContent(text);
      setOriginalContent(text);
      setPhase('edit');
      // Pre-select all other scopes as push targets
      setSelectedTargets(new Set(records.filter((r) => r.id !== sourceId).map((r) => r.id)));
    } catch (e) {
      setContentError(e instanceof Error ? e.message : 'Failed to fetch content');
    } finally {
      setLoadingContent(false);
    }
  }

  function toggleTarget(id: string) {
    setSelectedTargets((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const targets = records.filter((r) => selectedTargets.has(r.id));
  const isDirty = content !== originalContent;
  const contentHash = content ? hashString(content) : '';

  async function runPush() {
    setPhase('pushing');
    const res = await syncContentToTargets(
      lookupName,
      content,
      targets,
      { skipIdentical, dryRun },
      (msg) => setPushProgress(msg),
    );
    setResults(res);
    setPhase('results');
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const failureCount = results.filter((r) => r.status === 'failure').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;

  if (loadingRecords) {
    return (
      <div className="view">
        <div className="loading-bar"><div className="spinner spinner--sm" /> Loading…</div>
      </div>
    );
  }

  if (recordsError) {
    return <div className="view"><div className="alert alert--danger">{recordsError}</div></div>;
  }

  return (
    <div className="view view--edit">
      <div className="view__header">
        <div>
          <Link to={`/lookup/${encodeURIComponent(lookupName)}`} className="back-link">
            ← {lookupName}
          </Link>
          <h1 className="view__title">
            Edit: {lookupName}
            {isDirty && phase === 'edit' && <span className="dirty-indicator"> ●</span>}
          </h1>
          <p className="view__subtitle">
            {records.length} scope{records.length !== 1 ? 's' : ''} · Edit content and push to selected groups
          </p>
        </div>
        {phase === 'edit' && (
          <div className="btn-group">
            <button className="btn btn--ghost" onClick={() => { setContent(originalContent); }}>
              Reset
            </button>
            <button
              className="btn btn--primary"
              onClick={() => setPhase('select-targets')}
            >
              Push to Groups →
            </button>
          </div>
        )}
      </div>

      {/* ── Step 1: Source selection ─────────────────────────────────────────── */}
      {phase === 'load-source' && (
        <div className="edit-step-card">
          <h2 className="section-title">Choose source to edit</h2>
          <p className="edit-step-desc">
            Select which scope's copy to load as your starting point. You can edit the content before pushing to any groups.
          </p>
          {contentError && <div className="alert alert--danger">{contentError}</div>}
          <ul className="source-pick-list">
            {records.map((r) => (
              <li key={r.id} className={`source-pick-item ${sourceId === r.id ? 'source-pick-item--selected' : ''}`}>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="source"
                    value={r.id}
                    checked={sourceId === r.id}
                    onChange={() => setSourceId(r.id)}
                  />
                  <span className="source-pick-scope">{r.scopeName}</span>
                  <span className={`scope-type-badge scope-type-badge--${r.scopeType}`}>{r.scopeType}</span>
                  <StatusBadge status={r.syncStatus} size="sm" />
                  {r.size != null && <span className="muted">{formatBytes(r.size)}</span>}
                  {r.lastModified && (
                    <span className="muted">{new Date(r.lastModified).toLocaleDateString()}</span>
                  )}
                </label>
              </li>
            ))}
            {records.length === 0 && (
              <li className="empty-state">
                No existing copies found.{' '}
                <button className="btn btn--sm btn--ghost" onClick={() => { setContent(''); setPhase('edit'); }}>
                  Start with a blank file
                </button>
              </li>
            )}
          </ul>
          <div className="edit-step-actions">
            <button
              className="btn btn--primary"
              onClick={loadContent}
              disabled={loadingContent || (!sourceId && records.length > 0)}
            >
              {loadingContent ? 'Loading…' : 'Load & Edit'}
            </button>
            {records.length === 0 && (
              <button className="btn btn--ghost" onClick={() => { setContent(''); setOriginalContent(''); setPhase('edit'); }}>
                Start blank
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Editor ───────────────────────────────────────────────────── */}
      {phase === 'edit' && (
        <>
          {isDirty && (
            <div className="alert alert--warning">
              Unsaved changes — click "Push to Groups" to deploy your edits.
            </div>
          )}
          <LookupEditor
            value={content}
            onChange={setContent}
            filename={lookupName}
          />
          <div className="edit-footer">
            {contentHash && <code className="hash">sha: {contentHash}</code>}
            <div className="btn-group">
              <button className="btn btn--ghost" onClick={() => setPhase('load-source')}>
                ← Change Source
              </button>
              <button
                className="btn btn--primary"
                onClick={() => setPhase('select-targets')}
              >
                Push to Groups →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3: Target selection ─────────────────────────────────────────── */}
      {phase === 'select-targets' && (
        <div className="edit-step-card">
          <h2 className="section-title">Select push targets</h2>
          <p className="edit-step-desc">
            Choose which worker groups to push your edited version of <strong>{lookupName}</strong> to.
          </p>

          <div className="sync-options" style={{ marginBottom: '16px' }}>
            <label className="checkbox-label">
              <input type="checkbox" checked={skipIdentical} onChange={(e) => setSkipIdentical(e.target.checked)} />
              Skip targets that already match (by hash)
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry run — preview only, no changes written
            </label>
          </div>

          <div className="sync-targets__header">
            <span className="label">{targets.length} selected</span>
            <div className="btn-group">
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedTargets(new Set(records.map((r) => r.id)))}>All</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedTargets(new Set())}>None</button>
            </div>
          </div>

          <ul className="target-list">
            {records.map((r) => (
              <li key={r.id} className="target-item">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTargets.has(r.id)}
                    onChange={() => toggleTarget(r.id)}
                  />
                  <span className="target-item__name">{r.scopeName}</span>
                  <span className={`scope-type-badge scope-type-badge--${r.scopeType}`}>{r.scopeType}</span>
                  <StatusBadge status={r.syncStatus} size="sm" />
                  {r.id === sourceId && (
                    <span className="badge badge--unknown badge--sm">Loaded source</span>
                  )}
                </label>
              </li>
            ))}
          </ul>

          <div className="edit-step-actions">
            <button className="btn btn--ghost" onClick={() => setPhase('edit')}>← Back to Editor</button>
            <button
              className="btn btn--primary"
              disabled={targets.length === 0}
              onClick={() => setPhase('confirm')}
            >
              Review → ({targets.length} target{targets.length !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Confirm ──────────────────────────────────────────────────── */}
      {phase === 'confirm' && (
        <div className="edit-step-card">
          <h2 className="section-title">Confirm push</h2>
          {dryRun && <div className="alert alert--info">Dry run mode — no changes will be written.</div>}
          {isDirty
            ? <div className="alert alert--warning">You have unsaved edits. These modified contents will be pushed.</div>
            : <div className="alert alert--info">Content is unchanged from the loaded source. The same content will be pushed to selected targets.</div>
          }
          <div className="confirm-summary">
            <p>
              Pushing <strong>{lookupName}</strong> to <strong>{targets.length}</strong> scope{targets.length !== 1 ? 's' : ''}:
            </p>
            <ul className="confirm-target-list">
              {targets.map((t) => (
                <li key={t.id}>
                  <strong>{t.scopeName}</strong>
                  {t.exists ? ' — will overwrite existing file' : ' — will create new file'}
                </li>
              ))}
            </ul>
          </div>
          <div className="edit-step-actions">
            <button className="btn btn--ghost" onClick={() => setPhase('select-targets')}>← Back</button>
            <button className="btn btn--danger" onClick={runPush}>
              {dryRun ? 'Run Dry Run' : `Push to ${targets.length} scope${targets.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Pushing ──────────────────────────────────────────────────── */}
      {phase === 'pushing' && (
        <div className="edit-step-card">
          <div className="sync-running">
            <div className="spinner" />
            <p>{pushProgress || 'Pushing…'}</p>
          </div>
        </div>
      )}

      {/* ── Step 6: Results ──────────────────────────────────────────────────── */}
      {phase === 'results' && (
        <div className="edit-step-card">
          <h2 className="section-title">Push complete</h2>
          {successCount > 0 && <div className="alert alert--success">{successCount} scope{successCount !== 1 ? 's' : ''} updated successfully.</div>}
          {skippedCount > 0 && <div className="alert alert--info">{skippedCount} skipped (already identical or dry run).</div>}
          {failureCount > 0 && <div className="alert alert--danger">{failureCount} failed.</div>}

          <ul className="result-list">
            {results.map((r, i) => (
              <li key={i} className={`result-item result-item--${r.status}`}>
                <span className="result-item__scope">{r.target.scopeName}</span>
                <span className={`badge badge--sm badge--${r.status === 'success' ? 'in_sync' : r.status === 'skipped' ? 'unknown' : 'out_of_sync'}`}>
                  {r.status}
                </span>
                {r.reason && <span className="result-item__reason muted">{r.reason}</span>}
              </li>
            ))}
          </ul>

          <div className="edit-step-actions">
            <button className="btn btn--ghost" onClick={() => { setPhase('edit'); setResults([]); }}>
              ← Back to Editor
            </button>
            <button className="btn btn--ghost" onClick={() => navigate(`/lookup/${encodeURIComponent(lookupName)}`)}>
              View Comparison
            </button>
            <button className="btn btn--primary" onClick={() => navigate('/')}>
              Back to Inventory
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
