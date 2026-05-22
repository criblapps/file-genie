export type ScopeType = 'group' | 'fleet' | 'pack';

export type SyncStatus = 'in_sync' | 'out_of_sync' | 'sole_copy' | 'missing' | 'unknown';

export interface Scope {
  id: string;
  name: string;
  type: ScopeType;
  /** For pack scopes: the ID of the worker group that contains this pack */
  parentScopeId?: string;
}

export interface LookupRecord {
  id: string; // `${scopeType}:${scopeId}:${name}`
  name: string;
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
  /** For pack-scoped records: the ID of the worker group that contains the pack */
  parentScopeId?: string;
  path: string;
  version?: string;
  hash?: string;
  size?: number;
  lastModified?: string;
  lastModifiedBy?: string;
  exists: boolean;
  contentType?: string;
  syncStatus?: SyncStatus;
}

export interface DriftGroup {
  name: string;
  /** The key used for comparison grouping. Equals `name` for group/fleet records,
   *  `name::pack::packId` for pack-scoped records. */
  comparisonKey: string;
  /** Set only when this drift group is scoped to a specific pack. */
  packId?: string;
  records: LookupRecord[];
  status: SyncStatus;
  hasContentDiff: boolean;
  hasMetaDiff: boolean;
  hasMissingCopies: boolean;
  /** For pack groups: parent group IDs that have this pack+file.
   *  For direct groups: scope IDs. */
  presentScopes: string[];
  /** For pack groups: parent group IDs that have the pack installed but are missing this file.
   *  For direct groups: scope IDs missing the file. */
  missingScopes: string[];
  sourceOfTruth?: string; // record.id
}

export type AuditAction = 'create' | 'update' | 'sync' | 'delete' | 'compare' | 'scan';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor?: string;
  action: AuditAction;
  lookupName: string;
  sourceScope?: string;
  targetScopes?: string[];
  beforeHash?: string;
  afterHash?: string;
  result: 'success' | 'failure';
  details?: string;
}

export interface SyncTarget {
  record: LookupRecord;
  selected: boolean;
  willSkip: boolean;
}

export interface SyncJob {
  id: string;
  lookupName: string;
  sourceRecord: LookupRecord;
  targets: LookupRecord[];
  skipIdentical: boolean;
  dryRun: boolean;
}

export interface SyncResult {
  target: LookupRecord;
  status: 'success' | 'failure' | 'skipped';
  reason?: string;
}

export interface ScanResult {
  records: LookupRecord[];
  scannedAt: string;
  scopeCount: number;
  lookupCount: number;
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  content: string;
  lineA?: number;
  lineB?: number;
}
