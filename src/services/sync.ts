import { getLookupContent, uploadLookup, createLookup } from '../api/cribl';
import { hashString } from './diff';
import { recordAction } from './audit';
import type { LookupRecord, SyncResult } from '../types';

export interface SyncOptions {
  skipIdentical: boolean;
  dryRun: boolean;
}

export async function syncLookup(
  source: LookupRecord,
  targets: LookupRecord[],
  opts: SyncOptions,
  onProgress?: (msg: string, done: number, total: number) => void,
): Promise<SyncResult[]> {
  if (targets.length === 0) return [];

  onProgress?.(`Fetching source content from ${source.scopeName}…`, 0, targets.length);
  const content = await getLookupContent(source.scopeId, source.name, source.parentScopeId);
  const contentHash = hashString(content);

  const results: SyncResult[] = [];
  let done = 0;

  for (const target of targets) {
    onProgress?.(`Syncing to ${target.scopeName}…`, done, targets.length);

    if (opts.skipIdentical && target.hash === source.hash && target.hash != null) {
      results.push({ target, status: 'skipped', reason: 'Already identical' });
      done++;
      continue;
    }

    if (opts.dryRun) {
      results.push({ target, status: 'skipped', reason: 'Dry run — no changes written' });
      done++;
      continue;
    }

    try {
      const beforeHash = target.hash;

      if (target.exists) {
        await uploadLookup(target.scopeId, target.name, content, target.parentScopeId);
      } else {
        await createLookup(target.scopeId, target.name, content, target.parentScopeId);
      }

      await recordAction({
        action: 'sync',
        lookupName: source.name,
        sourceScope: source.scopeId,
        targetScopes: [target.scopeId],
        beforeHash,
        afterHash: contentHash,
        result: 'success',
        details: `Synced from ${source.scopeName} (${source.scopeId}) to ${target.scopeName} (${target.scopeId})`,
      });

      results.push({ target, status: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      await recordAction({
        action: 'sync',
        lookupName: source.name,
        sourceScope: source.scopeId,
        targetScopes: [target.scopeId],
        result: 'failure',
        details: msg,
      });

      results.push({ target, status: 'failure', reason: msg });
    }

    done++;
  }

  return results;
}

// Push locally-edited content to one or more target scopes
export async function syncContentToTargets(
  lookupName: string,
  content: string,
  targets: LookupRecord[],
  opts: SyncOptions,
  onProgress?: (msg: string, done: number, total: number) => void,
): Promise<SyncResult[]> {
  if (targets.length === 0) return [];

  const contentHash = hashString(content);
  const results: SyncResult[] = [];
  let done = 0;

  for (const target of targets) {
    onProgress?.(`Writing to ${target.scopeName}…`, done, targets.length);

    if (opts.skipIdentical && target.hash != null && target.hash === contentHash) {
      results.push({ target, status: 'skipped', reason: 'Already identical' });
      done++;
      continue;
    }

    if (opts.dryRun) {
      results.push({ target, status: 'skipped', reason: 'Dry run — no changes written' });
      done++;
      continue;
    }

    try {
      const beforeHash = target.hash;

      if (target.exists) {
        await uploadLookup(target.scopeId, target.name, content, target.parentScopeId);
      } else {
        await createLookup(target.scopeId, target.name, content, target.parentScopeId);
      }

      await recordAction({
        action: 'update',
        lookupName,
        targetScopes: [target.scopeId],
        beforeHash,
        afterHash: contentHash,
        result: 'success',
        details: `Edited and pushed ${lookupName} to ${target.scopeName} (${target.scopeId})`,
      });

      results.push({ target, status: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      await recordAction({
        action: 'update',
        lookupName,
        targetScopes: [target.scopeId],
        result: 'failure',
        details: msg,
      });

      results.push({ target, status: 'failure', reason: msg });
    }

    done++;
  }

  return results;
}

export async function compareLookupContents(
  recordA: LookupRecord,
  recordB: LookupRecord,
): Promise<{ contentA: string; contentB: string; hashA: string; hashB: string; identical: boolean }> {
  const [contentA, contentB] = await Promise.all([
    getLookupContent(recordA.scopeId, recordA.name, recordA.parentScopeId),
    getLookupContent(recordB.scopeId, recordB.name, recordB.parentScopeId),
  ]);

  await recordAction({
    action: 'compare',
    lookupName: recordA.name,
    sourceScope: recordA.scopeId,
    targetScopes: [recordB.scopeId],
    result: 'success',
    details: `Compared ${recordA.scopeName} vs ${recordB.scopeName}`,
  });

  const hashA = hashString(contentA);
  const hashB = hashString(contentB);
  return { contentA, contentB, hashA, hashB, identical: hashA === hashB };
}
