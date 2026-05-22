import { useState, useMemo } from 'react';
import { computeLineDiff } from '../services/diff';
import type { DiffLine } from '../types';

interface Props {
  contentA: string;
  contentB: string;
  labelA?: string;
  labelB?: string;
  contextLines?: number;
}

export function DiffViewer({ contentA, contentB, labelA = 'Source', labelB = 'Target', contextLines = 3 }: Props) {
  const [showFull, setShowFull] = useState(false);

  const diffLines = useMemo(() => computeLineDiff(contentA, contentB), [contentA, contentB]);

  const hasChanges = diffLines.some((l) => l.type !== 'same');

  const visibleLines = useMemo(() => {
    if (showFull || !hasChanges) return diffLines;
    // Show only changed lines with context around them
    const changeIndices = new Set<number>();
    diffLines.forEach((l, i) => {
      if (l.type !== 'same') {
        for (let c = Math.max(0, i - contextLines); c <= Math.min(diffLines.length - 1, i + contextLines); c++) {
          changeIndices.add(c);
        }
      }
    });
    return diffLines.filter((_, i) => changeIndices.has(i));
  }, [diffLines, showFull, hasChanges, contextLines]);

  if (!hasChanges) {
    return (
      <div className="diff-viewer diff-viewer--identical">
        <div className="diff-viewer__header">
          <span className="diff-viewer__label">{labelA}</span>
          <span className="badge badge--in_sync badge--sm">Identical content</span>
          <span className="diff-viewer__label">{labelB}</span>
        </div>
        <div className="diff-identical-msg">{diffLines.length} lines — files are identical</div>
      </div>
    );
  }

  const added = diffLines.filter((l) => l.type === 'added').length;
  const removed = diffLines.filter((l) => l.type === 'removed').length;

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <span className="diff-viewer__label">{labelA}</span>
        <span className="diff-stats">
          <span className="diff-stat diff-stat--removed">−{removed}</span>
          <span className="diff-stat diff-stat--added">+{added}</span>
        </span>
        <span className="diff-viewer__label">{labelB}</span>
      </div>
      <div className="diff-body">
        {visibleLines.map((line, i) => (
          <DiffLineRow key={i} line={line} prev={visibleLines[i - 1]} />
        ))}
        {!showFull && diffLines.length !== visibleLines.length && (
          <button className="diff-expand-btn" onClick={() => setShowFull(true)}>
            Show all {diffLines.length} lines
          </button>
        )}
      </div>
    </div>
  );
}

function DiffLineRow({ line, prev }: { line: DiffLine; prev?: DiffLine }) {
  const showEllipsis = prev != null && line.type === 'same' && prev.type === 'same';
  void showEllipsis;

  return (
    <div className={`diff-line diff-line--${line.type}`}>
      <span className="diff-line__gutter diff-line__gutter--a">
        {line.lineA ?? ''}
      </span>
      <span className="diff-line__gutter diff-line__gutter--b">
        {line.lineB ?? ''}
      </span>
      <span className="diff-line__prefix">
        {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
      </span>
      <span className="diff-line__content">{line.content}</span>
    </div>
  );
}
