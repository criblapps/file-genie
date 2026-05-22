import type { SyncStatus } from '../types';

interface Props {
  status: SyncStatus | undefined;
  size?: 'sm' | 'md';
}

const LABELS: Record<SyncStatus, string> = {
  in_sync: 'In Sync',
  out_of_sync: 'Out of Sync',
  sole_copy: 'Sole Copy',
  missing: 'Missing',
  unknown: 'Unknown',
};

export function StatusBadge({ status, size = 'md' }: Props) {
  const s = status ?? 'unknown';
  return (
    <span className={`badge badge--${s} badge--${size}`}>
      {LABELS[s]}
    </span>
  );
}

interface DriftBadgeProps {
  hasContentDiff: boolean;
  hasMetaDiff: boolean;
  hasMissingCopies: boolean;
}

export function DriftBadges({ hasContentDiff, hasMetaDiff, hasMissingCopies }: DriftBadgeProps) {
  return (
    <span className="badge-group">
      {hasContentDiff && <span className="badge badge--out_of_sync badge--sm">Content diff</span>}
      {hasMetaDiff && !hasContentDiff && <span className="badge badge--unknown badge--sm">Meta diff</span>}
      {hasMissingCopies && <span className="badge badge--missing badge--sm">Missing copies</span>}
      {!hasContentDiff && !hasMetaDiff && !hasMissingCopies && (
        <span className="badge badge--in_sync badge--sm">Identical</span>
      )}
    </span>
  );
}
