import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/constants';
import {
  clearStash,
  createStash,
  hasStashEntry,
  isValidStash,
  readStash,
  stashKey,
  writeStash,
} from '../../src/core/stash';
import { FakeStorage, REMOTE_TARGET } from './fakes';

describe('stash helpers (§3.2 stash)', () => {
  it('TS-QA-12 key is per target: `${STORAGE_KEYS.stash}/${targetId}`', () => {
    expect(STORAGE_KEYS.stash).toBe('copilotAutoApproveToggle.stash.v1');
    expect(stashKey('local')).toBe('copilotAutoApproveToggle.stash.v1/local');
    expect(stashKey(REMOTE_TARGET)).toBe('copilotAutoApproveToggle.stash.v1/remote:ssh-remote:host');
  });

  it("TS-QA-12 createStash omits `value` when absent (so 'value' in stash is false), keeps it otherwise", () => {
    const absent = createStash('local', undefined);
    expect(absent).toEqual({ v: 1, target: 'local' });
    expect('value' in absent).toBe(false);
    for (const value of [false, null, 'true', 0, { a: true }, []]) {
      const stash = createStash('local', value);
      expect(stash).toEqual({ v: 1, target: 'local', value });
      expect('value' in stash).toBe(true);
    }
  });

  it.each([
    [null],
    [42],
    ['x'],
    [[]],
    [[{ v: 1, target: 'local' }]],
    [{ v: 2, target: 'local', value: false }],
    [{ v: 1 }],
    [{ v: 1, target: 5 }],
    [{ v: '1', target: 'local' }],
    [{ v: 1, target: REMOTE_TARGET }],
    [undefined],
    [true],
  ])('TS-QA-21 isValidStash rejects corrupt entry %j for target local', (raw) => {
    expect(isValidStash(raw, 'local')).toBe(false);
  });

  it('TS-QA-21 isValidStash accepts v=1 with the matching target, with or without value', () => {
    expect(isValidStash({ v: 1, target: 'local' }, 'local')).toBe(true);
    expect(isValidStash({ v: 1, target: 'local', value: { a: true } }, 'local')).toBe(true);
    expect(isValidStash({ v: 1, target: 'local', extra: 1 }, 'local')).toBe(true);
  });

  it('TS-AI-11 readStash returns undefined for a malformed or foreign entry and reads only its own key', () => {
    const storage = new FakeStorage();
    expect(readStash(storage, 'local')).toBeUndefined();
    storage.seed(stashKey('local'), { v: 1, target: REMOTE_TARGET, value: false });
    expect(readStash(storage, 'local')).toBeUndefined();
    storage.seed(stashKey('local'), { v: 1, target: 'local', value: false });
    expect(readStash(storage, 'local')).toEqual({ v: 1, target: 'local', value: false });
    expect(new Set(storage.gets)).toEqual(new Set([stashKey('local')]));
  });

  it('TS-QA-32 hasStashEntry is true for any stored value, valid or not', () => {
    const storage = new FakeStorage();
    expect(hasStashEntry(storage, 'local')).toBe(false);
    storage.seed(stashKey('local'), 0);
    expect(hasStashEntry(storage, 'local')).toBe(true);
    storage.seed(stashKey('local'), null);
    expect(hasStashEntry(storage, 'local')).toBe(true);
  });

  it('TS-QA-12 writeStash stores under the stash target key; clearStash writes undefined (delete)', async () => {
    const storage = new FakeStorage({ [stashKey(REMOTE_TARGET)]: { v: 1, target: REMOTE_TARGET } });
    await writeStash(storage, createStash('local', false));
    expect(storage.peek(stashKey('local'))).toEqual({ v: 1, target: 'local', value: false });
    await clearStash(storage, 'local');
    expect(storage.data.has(stashKey('local'))).toBe(false);
    expect(storage.updates.at(-1)).toEqual({ key: stashKey('local'), value: undefined, error: undefined });
    expect(storage.peek(stashKey(REMOTE_TARGET))).toEqual({ v: 1, target: REMOTE_TARGET });
  });

  it('TS-QA-34 writeStash/clearStash propagate storage failures to the caller', async () => {
    const storage = new FakeStorage();
    storage.failNextUpdate('quota exceeded');
    await expect(writeStash(storage, createStash('local', false))).rejects.toThrow('quota exceeded');
    storage.failNextUpdate('locked', () => true, true);
    await expect(clearStash(storage, 'local')).rejects.toThrow('locked');
  });
});
