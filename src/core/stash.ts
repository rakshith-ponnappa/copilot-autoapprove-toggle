import { STORAGE_KEYS } from '../constants';
import type { AutoApproveStash, StoragePort } from './types';

/** One stash per settings target, because local and remote windows share globalState. */
export function stashKey(targetId: string): string {
  return `${STORAGE_KEYS.stash}/${targetId}`;
}

export function isValidStash(raw: unknown, targetId: string): raw is AutoApproveStash {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const candidate = raw as { readonly v?: unknown; readonly target?: unknown };
  return candidate.v === 1 && candidate.target === targetId;
}

/** Returns this target's stash, or `undefined` when absent or malformed (malformed counts as no stash). */
export function readStash(storage: StoragePort, targetId: string): AutoApproveStash | undefined {
  const raw = storage.get(stashKey(targetId));
  return isValidStash(raw, targetId) ? raw : undefined;
}

/** True when anything (valid or not) is stored under this target's stash key. */
export function hasStashEntry(storage: StoragePort, targetId: string): boolean {
  return storage.get(stashKey(targetId)) !== undefined;
}

export function createStash(targetId: string, globalValue: unknown): AutoApproveStash {
  return globalValue === undefined ? { v: 1, target: targetId } : { v: 1, target: targetId, value: globalValue };
}

export async function writeStash(storage: StoragePort, stash: AutoApproveStash): Promise<void> {
  await storage.update(stashKey(stash.target), stash);
}

export async function clearStash(storage: StoragePort, targetId: string): Promise<void> {
  await storage.update(stashKey(targetId), undefined);
}
