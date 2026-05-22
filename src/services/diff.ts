import type { DiffLine } from '../types';

// ── Simple hash (FNV-1a 32-bit) ───────────────────────────────────────────────

export function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── Line-by-line diff (Myers-inspired, simplified) ────────────────────────────

export function computeLineDiff(textA: string, textB: string): DiffLine[] {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  // LCS-based diff
  const m = linesA.length;
  const n = linesB.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  let lineA = m;
  let lineB = n;

  const ops: Array<{ type: 'same' | 'added' | 'removed'; a?: string; b?: string }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      ops.push({ type: 'same', a: linesA[i - 1], b: linesB[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'added', b: linesB[j - 1] });
      j--;
    } else {
      ops.push({ type: 'removed', a: linesA[i - 1] });
      i--;
    }
  }

  ops.reverse();

  let aLine = 1;
  let bLine = 1;

  for (const op of ops) {
    if (op.type === 'same') {
      result.push({ type: 'same', content: op.a!, lineA: aLine++, lineB: bLine++ });
    } else if (op.type === 'removed') {
      result.push({ type: 'removed', content: op.a!, lineA: aLine++ });
    } else {
      result.push({ type: 'added', content: op.b!, lineB: bLine++ });
    }
  }

  // Suppress unused variable warning
  void lineA;
  void lineB;

  return result;
}

// ── Metadata comparison ────────────────────────────────────────────────────────

export interface MetaDiff {
  field: string;
  values: Record<string, string | undefined>;
  isDifferent: boolean;
}

export function compareMetadata(
  records: Array<{ scopeId: string; size?: number; lastModified?: string; lastModifiedBy?: string; hash?: string; version?: string }>,
): MetaDiff[] {
  const fields = ['size', 'lastModified', 'lastModifiedBy', 'hash', 'version'] as const;
  return fields.map((field) => {
    const values: Record<string, string | undefined> = {};
    for (const r of records) {
      values[r.scopeId] = r[field]?.toString();
    }
    const unique = new Set(Object.values(values).filter(Boolean));
    return { field, values, isDifferent: unique.size > 1 };
  });
}

// ── Sync status computation ────────────────────────────────────────────────────

export type ComparisonResult = 'identical' | 'meta_diff' | 'content_diff' | 'missing';

export function computeSyncStatus(
  records: Array<{ hash?: string; size?: number; lastModified?: string }>,
): ComparisonResult {
  if (records.length === 0) return 'missing';

  const hashes = records.map((r) => r.hash).filter(Boolean);
  if (hashes.length === records.length) {
    // All have hashes — compare directly
    const unique = new Set(hashes);
    return unique.size === 1 ? 'identical' : 'content_diff';
  }

  // Fall back to size/modified comparison
  const sizes = new Set(records.map((r) => r.size));
  const mods = new Set(records.map((r) => r.lastModified));
  if (sizes.size > 1 || mods.size > 1) return 'meta_diff';
  return 'identical';
}
