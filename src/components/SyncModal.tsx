import { useState } from 'react';
import type { LookupRecord, SyncResult } from '../types';
import { syncLookup } from '../services/sync';
import { StatusBadge } from './StatusBadge';

interface Props {
  source: LookupRecord;
  candidates: LookupRecord[];
  allScopes: Array<{ id: string; name: string; type: string }>;
  onClose: () => void;
  onSyncComplete: () => void;
}

type Phase = 'configure' | 'confirm' | 'running' | 'results';

export function SyncModal({ source, candidates, onClose, onSyncComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('configure');
  const [skipIdentical, setSkipIdentical] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.id)),
  );
  const [progress, setProgress] = useState('');
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [results, setResults] = useState<SyncResult[]>([]);

  const targets = candidates.filter((c) => selected.has(c.id));

  function toggleTarget(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSync() {
    setPhase('running');
    setProgressTotal(targets.length);
    const res = await syncLookup(source, targets, { skipIdentical, dryRun }, (msg, done, total) => {
      setProgress(msg);
      setProgressDone(done);
      setProgressTotal(total);
    });
    setResults(res);
    setPhase('results');
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const failureCount = results.filter((r) => r.status === 'failure').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal__header">
          <h2 className="modal__title">Sync Lookup: {source.name}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {phase === 'configure' && (
          <>
            <div className="modal__body">
              <div className="sync-source-info">
                <span className="label">Source</span>
                <span className="sync-source-scope">{source.scopeName}</span>
                {source.hash && <code className="hash">{source.hash.slice(0, 8)}</code>}
                {source.lastModified && (
                  <span className="muted">{new Date(source.lastModified).toLocaleString()}</span>
                )}
              </div>

              <div className="sync-options">
                <label className="checkbox-label">
                  <input type="checkbox" checked={skipIdentical} onChange={(e) => setSkipIdentical(e.target.checked)} />
                  Skip targets that already match source
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                  Dry run — preview only, no changes written
                </label>
              </div>

              <div className="sync-targets">
                <div className="sync-targets__header">
                  <h3>Target scopes ({targets.length} selected)</h3>
                  <div className="btn-group">
                    <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set(candidates.map((c) => c.id)))}>All</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>None</button>
                  </div>
                </div>
                <ul className="target-list">
                  {candidates.map((c) => (
                    <li key={c.id} className="target-item">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleTarget(c.id)}
                        />
                        <span className="target-item__name">{c.scopeName}</span>
                        <span className="muted target-item__type">{c.scopeType}</span>
                        <StatusBadge status={c.syncStatus} size="sm" />
                        {c.hash && source.hash && c.hash === source.hash && (
                          <span className="badge badge--in_sync badge--sm">Already matches</span>
                        )}
                      </label>
                    </li>
                  ))}
                  {candidates.length === 0 && (
                    <li className="empty-state">No other scopes have this lookup file.</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn--primary"
                disabled={targets.length === 0}
                onClick={() => setPhase('confirm')}
              >
                Review → ({targets.length} target{targets.length !== 1 ? 's' : ''})
              </button>
            </div>
          </>
        )}

        {phase === 'confirm' && (
          <>
            <div className="modal__body">
              <div className="confirm-summary">
                <p>
                  You are about to sync <strong>{source.name}</strong> from{' '}
                  <strong>{source.scopeName}</strong> to {targets.length} scope{targets.length !== 1 ? 's' : ''}.
                </p>
                {dryRun && <div className="alert alert--info">Dry run mode: no changes will be written.</div>}
                <ul className="confirm-target-list">
                  {targets.map((t) => (
                    <li key={t.id}>
                      <strong>{t.scopeName}</strong>
                      {t.exists ? ' — will overwrite existing file' : ' — will create new file'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setPhase('configure')}>← Back</button>
              <button className="btn btn--danger" onClick={runSync}>
                {dryRun ? 'Run Dry Run' : `Apply to ${targets.length} scope${targets.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="modal__body">
            <div className="sync-running">
              <div className="spinner" />
              <p>{progress}</p>
              {progressTotal > 0 && (
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: `${(progressDone / progressTotal) * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'results' && (
          <>
            <div className="modal__body">
              <div className="results-summary">
                {successCount > 0 && <div className="alert alert--success">{successCount} scope{successCount !== 1 ? 's' : ''} updated successfully.</div>}
                {skippedCount > 0 && <div className="alert alert--info">{skippedCount} skipped.</div>}
                {failureCount > 0 && <div className="alert alert--danger">{failureCount} failed.</div>}
              </div>
              <ul className="result-list">
                {results.map((r, i) => (
                  <li key={i} className={`result-item result-item--${r.status}`}>
                    <span className="result-item__scope">{r.target.scopeName}</span>
                    <span className={`badge badge--${r.status === 'success' ? 'in_sync' : r.status === 'skipped' ? 'unknown' : 'out_of_sync'} badge--sm`}>
                      {r.status}
                    </span>
                    {r.reason && <span className="result-item__reason muted">{r.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal__footer">
              <button className="btn btn--primary" onClick={() => { onSyncComplete(); onClose(); }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
