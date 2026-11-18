import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoApproveController } from '../../src/core/controller';
import { resolveState } from '../../src/core/state';
import type { ConfirmMode, InvocationOrigin, ToggleOutcome } from '../../src/core/types';
import { describeOutcome } from '../../src/ui/presentation';
import {
  ACK_KEY,
  createHarness,
  FakeConfirm,
  FakeLogger,
  FakePreferences,
  FakeSettings,
  FakeStorage,
  flushMicrotasks,
  type Harness,
  LOCAL_STASH,
  POLICY_MESSAGE,
  REMOTE_TARGET,
  stashKeyFor,
} from './fakes';

const ORIGINS: readonly InvocationOrigin[] = ['statusBar', 'external'];
const MODES: readonly ConfirmMode[] = ['firstTime', 'always', 'never'];
const REMOTE_STASH = stashKeyFor(REMOTE_TARGET);
const FRENCH_POLICY =
  "Impossible d'écrire dans les paramètres utilisateur, car chat.tools.global.autoApprove est configuré dans la stratégie système.";

/** I5: the controller's state always equals resolveState(fresh read, sticky); sticky is inferred from `managed`. */
function expectStateMatchesFreshRead(h: Harness): void {
  const fresh = resolveState(h.settings.read(), false);
  const sticky = resolveState(h.settings.read(), true);
  expect([fresh, sticky]).toContainEqual(h.controller.state);
  expect(Object.isFrozen(h.controller.state)).toBe(true);
}

/** Collects unhandled rejections for the duration of a test (I4). */
let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await flushMicrotasks();
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

describe('enable — step 1 short-circuits', () => {
  const rows: readonly { name: string; setup: (h: Harness) => Promise<void> | void; expected: string }[] = [
    {
      name: 'unsupported',
      setup: (h) => {
        h.settings.supported = false;
      },
      expected: 'blocked/unsupported',
    },
    {
      name: 'effective true',
      setup: (h) => {
        h.settings.externalSet(true);
      },
      expected: 'unchanged',
    },
    {
      name: 'user true + override false (derived managed)',
      setup: (h) => {
        h.settings.setOverride(false);
        h.settings.externalSet(true);
      },
      expected: 'blocked/managed',
    },
    {
      name: 'def true, eff false (policy-forced managed)',
      setup: (h) => {
        h.settings.forceDefault(true);
        h.settings.setOverride(false);
      },
      expected: 'blocked/managed',
    },
    {
      name: 'sticky managed',
      setup: async (h) => {
        h.settings.failNextWrite(POLICY_MESSAGE);
        await h.controller.enable();
        h.settings.writes.length = 0;
        h.confirm.calls = 0;
      },
      expected: 'blocked/managed',
    },
    {
      name: 'def true, eff true (policy forces on)',
      setup: (h) => {
        h.settings.setPolicy(true);
      },
      expected: 'unchanged',
    },
  ];

  for (const row of rows) {
    for (const origin of ORIGINS) {
      it(`TS-QA-04 ${row.name}: enable('${origin}') ⇒ ${row.expected}, no probe, no confirm, nothing written`, async () => {
        const h = createHarness({ confirmMode: 'always' });
        await row.setup(h);
        const stashUpdatesBefore = h.storage.updates.length;
        const outcome = await h.controller.enable(origin);
        expect(outcome.kind === 'blocked' ? `blocked/${outcome.reason}` : outcome.kind).toBe(row.expected);
        // §9: guard outcomes carry no detail.
        expect(outcome).not.toHaveProperty('detail');
        expect(h.settings.writes).toEqual([]);
        expect(h.confirm.calls).toBe(0);
        expect(h.storage.updates.length).toBe(stashUpdatesBefore);
        expect(outcome.state).toEqual(h.controller.state);
      });
    }
  }
});

describe('enable — policy probe (§3.2 step 2, §9)', () => {
  it.each([[undefined], [false], [null], ['true'], [0]])(
    'TS-QA-05 glob=%j: identity probe write(glob) runs before the dialog, then write(true)',
    async (glob) => {
      const h = createHarness({ user: glob });
      const outcome = await h.controller.enable();
      expect(outcome.kind).toBe('changed');
      expect(h.trace.entries.filter((e) => e !== 'event')).toEqual(['write:identity', 'confirm', 'write:change']);
      expect(h.settings.writes[0]).toEqual({ value: glob, identity: true, error: undefined });
      expect(h.settings.writes[1]?.value).toBe(true);
    },
  );

  it.each([[{ a: true }], [{}], [[true]]])(
    'TS-QA-05 glob=%j (object/map): no probe — settings.json is never re-serialized before the dialog (§9)',
    async (glob) => {
      const h = createHarness({ user: glob });
      const outcome = await h.controller.enable();
      expect(outcome.kind).toBe('changed');
      expect(h.trace.entries.filter((e) => e !== 'event')).toEqual(['confirm', 'write:change']);
      expect(h.settings.writes.map((w) => w.value)).toEqual([true]);
    },
  );

  it('TS-QA-06 probe rejected by policy ⇒ blocked/managed with raw detail, no dialog, no stash, sticky + one event', async () => {
    const h = createHarness();
    h.settings.failNextWrite(POLICY_MESSAGE);
    const outcome = await h.controller.enable('external');
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'managed', detail: POLICY_MESSAGE });
    expect(h.confirm.calls).toBe(0);
    expect(h.storage.updates).toEqual([]);
    expect(h.controller.state.managed).toBe(true);
    expect(h.events).toEqual([{ mode: 'off', customToolCount: 0, managed: true, userSettingOn: false }]);
    expect(h.logger.at('warn').some((l) => l.includes(POLICY_MESSAGE))).toBe(true);
  });

  it('TS-QA-07 probe fails for another reason ⇒ blocked/write-failed with raw detail, not sticky, no dialog', async () => {
    const h = createHarness();
    h.settings.failNextWrite('EACCES: permission denied');
    const outcome = await h.controller.enable('external');
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'EACCES: permission denied' });
    expect(h.confirm.calls).toBe(0);
    expect(h.storage.updates).toEqual([]);
    expect(h.controller.state.managed).toBe(false);
    expect(h.events).toEqual([]);
    expect(h.logger.at('error').some((l) => l.includes('EACCES: permission denied'))).toBe(true);
  });

  it('TS-AI-15 policy with a per-tool map in settings.json: no probe applies, so the dialog IS shown before the policy rejection (documented §9 trade-off)', async () => {
    const h = createHarness({ user: { a: true } });
    h.settings.setPolicy(false);
    const outcome = await h.controller.enable('external');
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'managed', detail: POLICY_MESSAGE });
    expect(h.confirm.calls).toBe(1);
    expect(h.settings.userValue).toEqual({ a: true });
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });
});

describe('enable — confirmation (§3.2 step 3)', () => {
  const matrix = ORIGINS.flatMap((origin) =>
    MODES.flatMap((mode) => [false, true].map((acknowledged) => ({ origin, mode, acknowledged }))),
  );

  it.each(matrix)('TS-QA-08 confirm matrix: %j', async ({ origin, mode, acknowledged }) => {
    const h = createHarness({ confirmMode: mode, acknowledged });
    const outcome = await h.controller.enable(origin);
    const expectConfirm = origin === 'external' || mode === 'always' || (mode === 'firstTime' && !acknowledged);
    expect(h.confirm.calls).toBe(expectConfirm ? 1 : 0);
    expect(outcome.kind).toBe('changed');
  });

  it('TS-QA-08 the preference is never consulted for external origins', async () => {
    const h = createHarness({ confirmMode: 'never', acknowledged: true });
    await h.controller.enable('external');
    expect(h.prefs.calls).toBe(0);
    expect(h.confirm.calls).toBe(1);
  });

  it.each(ORIGINS)(
    'TS-QA-09 cancel (%s) ⇒ cancelled; only the probe written; ack unchanged; no stash; no event',
    async (origin) => {
      const h = createHarness({ confirmAnswer: false, confirmMode: 'always' });
      const outcome = await h.controller.enable(origin);
      expect(outcome.kind).toBe('cancelled');
      expect(outcome).not.toHaveProperty('detail');
      expect(h.settings.writes).toEqual([{ value: undefined, identity: true, error: undefined }]);
      expect(h.storage.updates).toEqual([]);
      expect(h.storage.peek(ACK_KEY)).toBeUndefined();
      expect(h.events).toEqual([]);
      expect(h.logger.at('info').some((l) => l.includes('decision=declined'))).toBe(true);
    },
  );

  it('TS-QA-10 acceptance records the acknowledgement (external + always)', async () => {
    const h = createHarness({ confirmMode: 'always' });
    await h.controller.enable('external');
    expect(h.storage.peek(ACK_KEY)).toBe(true);
    expect(h.storage.updates[0]).toEqual({ key: ACK_KEY, value: true, error: undefined });
  });

  it('TS-QA-10 acceptance records the acknowledgement for a statusBar origin too', async () => {
    const h = createHarness({ confirmMode: 'firstTime' });
    await h.controller.enable('statusBar');
    expect(h.storage.peek(ACK_KEY)).toBe(true);
  });

  it('TS-QA-10 ack untouched when the dialog was skipped (statusBar + never)', async () => {
    const h = createHarness({ confirmMode: 'never' });
    const outcome = await h.controller.enable('statusBar');
    expect(outcome.kind).toBe('changed');
    expect(h.storage.updatesFor(ACK_KEY)).toEqual([]);
  });

  it('TS-QA-11 setting turned on externally while the dialog is open ⇒ unchanged, no stash, only the probe', async () => {
    const h = createHarness({ confirmAnswer: 'hold' });
    const pending = h.controller.enable();
    await flushMicrotasks();
    expect(h.confirm.calls).toBe(1);
    h.settings.externalSet(true);
    h.confirm.lastHeld.resolve(true);
    const outcome = await pending;
    expect(outcome.kind).toBe('unchanged');
    expect(outcome.state.mode).toBe('on');
    expect(h.settings.writes).toEqual([{ value: undefined, identity: true, error: undefined }]);
    expect(h.storage.updatesFor(LOCAL_STASH)).toEqual([]);
    expect(h.storage.peek(ACK_KEY)).toBe(true);
  });

  it.each([
    [
      '(a) defaultValue becomes undefined',
      (h: Harness) => {
        h.settings.supported = false;
        h.settings.fire();
      },
      'unsupported',
    ],
    [
      '(b) user true while an override keeps eff false',
      (h: Harness) => {
        h.settings.setOverride(false);
        h.settings.externalSet(true);
      },
      'managed',
    ],
    [
      '(c) policy appears forcing false with user true',
      (h: Harness) => {
        h.settings.externalSet(true);
        h.settings.setPolicy(false);
      },
      'managed',
    ],
  ] as const)(
    'TS-QA-13 re-read after the dialog: %s ⇒ blocked/%s, no stash, nothing beyond the probe',
    async (_name, change, reason) => {
      const h = createHarness({ confirmAnswer: 'hold' });
      const pending = h.controller.enable();
      await flushMicrotasks();
      change(h);
      h.confirm.lastHeld.resolve(true);
      const outcome = await pending;
      expect(outcome).toEqual({ kind: 'blocked', reason, state: h.controller.state });
      expect(h.settings.writes).toEqual([{ value: undefined, identity: true, error: undefined }]);
      expect(h.storage.updatesFor(LOCAL_STASH)).toEqual([]);
    },
  );
});

describe('enable — stash, write, verify (§3.2 steps 4–8)', () => {
  it.each([[undefined], [false], [{ a: true }], ['true'], [null]])(
    'TS-QA-12 glob=%j: stash stored at exactly …stash.v1/local, malformed entry replaced, other target untouched',
    async (glob) => {
      const h = createHarness({ user: glob });
      h.storage.seed(LOCAL_STASH, 42);
      h.storage.seed(REMOTE_STASH, { v: 1, target: REMOTE_TARGET, value: 'remote' });
      const outcome = await h.controller.enable();
      expect(outcome.kind).toBe('changed');
      const stash = h.storage.peek(LOCAL_STASH) as Record<string, unknown>;
      if (glob === undefined) {
        expect(stash).toEqual({ v: 1, target: 'local' });
        expect('value' in stash).toBe(false);
      } else {
        expect(stash).toEqual({ v: 1, target: 'local', value: glob });
      }
      expect(h.storage.peek(REMOTE_STASH)).toEqual({ v: 1, target: REMOTE_TARGET, value: 'remote' });
      expect(h.storage.updates.map((u) => u.key)).toEqual([ACK_KEY, LOCAL_STASH]);
    },
  );

  it('TS-QA-12 remote target stashes under …stash.v1/remote:<name>:<authority>', async () => {
    const h = createHarness({ targetId: REMOTE_TARGET, user: false });
    await h.controller.enable();
    expect(h.storage.peek(REMOTE_STASH)).toEqual({ v: 1, target: REMOTE_TARGET, value: false });
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-12 stash is written before the setting write (so a crash mid-way can still be restored)', async () => {
    const h = createHarness({ user: false });
    const order: string[] = [];
    const update = h.storage.update.bind(h.storage);
    h.storage.update = (key, value) => {
      order.push(`storage:${key}`);
      return update(key, value);
    };
    h.settings.onDidChange(() => order.push('settings-changed'));
    await h.controller.enable();
    expect(order).toEqual([`storage:${ACK_KEY}`, `storage:${LOCAL_STASH}`, 'settings-changed']);
  });

  it('TS-QA-14 policy rejects the real write after a clean probe ⇒ stash cleared, sticky, blocked/managed + raw detail', async () => {
    const h = createHarness({ user: false });
    h.settings.failWrites(undefined, POLICY_MESSAGE);
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'managed', detail: POLICY_MESSAGE });
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.storage.updatesFor(LOCAL_STASH).map((u) => u.value)).toEqual([
      { v: 1, target: 'local', value: false },
      undefined,
    ]);
    expect(h.controller.state.managed).toBe(true);
    expect(h.settings.userValue).toBe(false);
  });

  it('TS-QA-15 real write fails for another reason ⇒ stash cleared, not sticky, blocked/write-failed + raw detail', async () => {
    const h = createHarness({ user: false });
    h.settings.failWrites(undefined, 'disk full');
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'disk full' });
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.controller.state.managed).toBe(false);
  });

  it('TS-QA-15 an Error object thrown by the write keeps its message as detail', async () => {
    const h = createHarness({ user: false });
    h.settings.failWrites(undefined, new RangeError('ENOSPC'));
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'ENOSPC' });
  });

  it.each([[undefined], [false], [{ a: true }], [null], ['x']])(
    'TS-QA-16 verify failed (override keeps eff false), prior glob=%j ⇒ restored exactly, stash cleared, no detail',
    async (glob) => {
      const h = createHarness({ user: glob });
      h.settings.setOverride(false);
      const outcome = await h.controller.enable();
      expect(outcome).toEqual({ kind: 'blocked', reason: 'verify-failed', state: h.controller.state });
      expect(h.settings.userValue).toEqual(glob);
      expect(h.settings.writes.at(-1)?.value).toEqual(glob);
      expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
      expectStateMatchesFreshRead(h);
    },
  );

  it('TS-QA-17 verify failed and the restore write also fails ⇒ still verify-failed, warn logged, resolves', async () => {
    const h = createHarness({ user: false });
    h.settings.setOverride(false);
    h.settings.failWrites(undefined, undefined, 'restore failed');
    const outcome = await h.controller.enable();
    expect(outcome.kind).toBe('blocked');
    expect(outcome).toMatchObject({ reason: 'verify-failed' });
    expect(h.logger.problems.some((l) => l.includes('restore failed'))).toBe(true);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-18 successful enable ⇒ changed/on, exactly one state event, inFlight cleared afterwards', async () => {
    const h = createHarness({ user: false });
    const outcome = await h.controller.enable();
    expect(outcome).toEqual({
      kind: 'changed',
      state: { mode: 'on', customToolCount: 0, managed: false, userSettingOn: true },
    });
    expect(h.events).toHaveLength(1);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(true);
    h.settings.externalSet(false);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-18 enabling from a custom map turns everything on and stashes the map', async () => {
    const h = createHarness({ user: { a: true, b: false } });
    expect(h.controller.state).toMatchObject({ mode: 'custom', customToolCount: 1 });
    const outcome = await h.controller.enable();
    expect(outcome.kind).toBe('changed');
    expect(h.storage.peek(LOCAL_STASH)).toEqual({ v: 1, target: 'local', value: { a: true, b: false } });
  });
});

describe('disable (§3.2)', () => {
  const rows = [
    { name: 'unsupported', user: true, supported: false, expected: 'blocked/unsupported' },
    { name: 'off', user: false, supported: true, expected: 'unchanged' },
    { name: 'custom map', user: { a: true }, supported: true, expected: 'unchanged' },
  ] as const;

  it.each(rows)('TS-QA-19 $name ⇒ $expected, no writes, stash untouched', async ({ user, supported, expected }) => {
    const h = createHarness({ user, supported });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    const outcome = await h.controller.disable();
    expect(outcome.kind === 'blocked' ? `blocked/${outcome.reason}` : outcome.kind).toBe(expected);
    expect(outcome).not.toHaveProperty('detail');
    expect(h.settings.writes).toEqual([]);
    expect(h.storage.updates).toEqual([]);
    expect(h.settings.userValue).toEqual(user);
  });

  it.each([
    ['absent', { v: 1, target: 'local' }, undefined],
    ['false', { v: 1, target: 'local', value: false }, false],
    ['map', { v: 1, target: 'local', value: { a: true } }, { a: true }],
    ['"true"', { v: 1, target: 'local', value: 'true' }, 'true'],
    ['null', { v: 1, target: 'local', value: null }, null],
  ])('TS-QA-20 restore from a same-target stash (value %s)', async (_name, stash, restored) => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, stash);
    const outcome = await h.controller.disable();
    expect(outcome.kind).toBe('changed');
    expect(h.settings.writes).toEqual([{ value: restored, identity: false, error: undefined }]);
    expect(h.settings.userValue).toEqual(restored);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.logger.at('info').some((l) => l.includes('decision=restore-previous'))).toBe(true);
  });

  it.each([
    ['no stash', undefined],
    ['entry naming another target', { v: 1, target: REMOTE_TARGET, value: { a: true } }],
    ['stash value true', { v: 1, target: 'local', value: true }],
    ['null', null],
    ['42', 42],
    ['"x"', 'x'],
    ['[]', []],
    ['v 2', { v: 2, target: 'local', value: false }],
    ['{v:1}', { v: 1 }],
    ['{v:1,target:5}', { v: 1, target: 5 }],
    ["{v:'1'}", { v: '1', target: 'local' }],
  ])('TS-QA-21 fallback to false: %s', async (_name, entry) => {
    const h = createHarness({ user: true });
    if (entry !== undefined) {
      h.storage.seed(LOCAL_STASH, entry);
    }
    const outcome = await h.controller.disable();
    expect(outcome.kind).toBe('changed');
    expect(h.settings.writes).toEqual([{ value: false, identity: false, error: undefined }]);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.logger.at('info').some((l) => l.includes('decision=write-false'))).toBe(true);
  });

  it.each([
    [POLICY_MESSAGE, 'managed', true],
    ['EIO: i/o error', 'write-failed', false],
  ] as const)(
    'TS-QA-22 disable write fails (%s) ⇒ blocked/%s, stash kept, retry restores',
    async (message, reason, sticky) => {
      const h = createHarness({ user: true });
      const stash = { v: 1, target: 'local', value: false };
      h.storage.seed(LOCAL_STASH, stash);
      h.settings.failNextWrite(message);
      const outcome = await h.controller.disable();
      expect(outcome).toMatchObject({ kind: 'blocked', reason, detail: message });
      expect(h.controller.state.managed).toBe(sticky);
      expect(h.storage.peek(LOCAL_STASH)).toEqual(stash);
      expect(h.storage.updates).toEqual([]);
      const retry = await h.controller.disable();
      expect(retry.kind).toBe('changed');
      expect(h.settings.userValue).toBe(false);
      expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    },
  );

  it('TS-QA-23 override keeps eff true ⇒ stash cleared, blocked/verify-failed without detail', async () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    h.settings.setOverride(true);
    const outcome = await h.controller.disable();
    expect(outcome).toEqual({ kind: 'blocked', reason: 'verify-failed', state: h.controller.state });
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.settings.userValue).toBe(false);
  });

  it('TS-QA-23 mode on via override only (user value absent) still attempts the disable write', async () => {
    const h = createHarness();
    h.settings.setOverride(true);
    const outcome = await h.controller.disable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'verify-failed' });
    expect(h.settings.writes.map((w) => w.value)).toEqual([false]);
  });

  const confirmRows = ORIGINS.flatMap((origin) => MODES.map((mode) => ({ origin, mode })));
  it.each(confirmRows)('TS-QA-24 disable never confirms: %j', async ({ origin, mode }) => {
    const h = createHarness({ user: true, confirmMode: mode });
    const outcome = await h.controller.disable(origin);
    expect(outcome.kind).toBe('changed');
    expect(h.confirm.calls).toBe(0);
    expect(h.prefs.calls).toBe(0);
  });

  it('TS-QA-25 user true under a policy false ⇒ attempts the removal, policy rejects ⇒ blocked/managed, value unchanged', async () => {
    const h = createHarness({ user: true });
    h.settings.setPolicy(false);
    expect(h.controller.state).toMatchObject({ mode: 'off', managed: true, userSettingOn: true });
    const outcome = await h.controller.disable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'managed', detail: POLICY_MESSAGE });
    expect(h.settings.writes).toEqual([{ value: false, identity: false, error: POLICY_MESSAGE }]);
    expect(h.settings.userValue).toBe(true);
    expect(h.confirm.calls).toBe(0);
  });

  it('TS-QA-25 user true + non-policy override false ⇒ disable cleans up the leftover true', async () => {
    const h = createHarness({ user: true });
    h.settings.setOverride(false);
    const outcome = await h.controller.disable();
    expect(outcome.kind).toBe('changed');
    expect(h.settings.userValue).toBe(false);
    expect(outcome.state).toMatchObject({ managed: false, userSettingOn: false });
  });
});

describe('toggle (§3.2)', () => {
  it.each([
    [
      'on',
      (h: Harness): void => {
        h.settings.externalSet(true);
      },
      'disable',
    ],
    [
      'user true + override false',
      (h: Harness): void => {
        h.settings.externalSet(true);
        h.settings.setOverride(false);
      },
      'disable',
    ],
    ['off', (_h: Harness): void => undefined, 'enable'],
    [
      'custom',
      (h: Harness): void => {
        h.settings.externalSet({ a: true });
      },
      'enable',
    ],
  ] as const)('TS-QA-26 toggle routing: %s ⇒ %s path', async (_name, setup, path) => {
    const h = createHarness();
    setup(h);
    const outcome = await h.controller.toggle();
    expect(h.logger.at('info')).toContain(`toggle origin=external decision=${path}`);
    expect(outcome.kind).toBe('changed');
    expect(h.confirm.calls).toBe(path === 'enable' ? 1 : 0);
    expect(h.settings.userValue).toBe(path === 'enable');
  });

  it('TS-QA-27 coalescing lifecycle: p1 === p2 while pending, one dialog; p3 after settle is a new operation', async () => {
    const h = createHarness({ confirmAnswer: 'hold' });
    const p1 = h.controller.toggle('statusBar');
    const p2 = h.controller.toggle('external');
    expect(p2).toBe(p1);
    await flushMicrotasks();
    expect(h.controller.toggle()).toBe(p1);
    expect(h.confirm.calls).toBe(1);
    h.confirm.lastHeld.resolve(true);
    const first = await p1;
    expect(first.kind).toBe('changed');
    expect(first.state.mode).toBe('on');
    const p3 = h.controller.toggle();
    expect(p3).not.toBe(p1);
    const third = await p3;
    expect(third.kind).toBe('changed');
    expect(third.state.mode).toBe('off');
    expect(h.confirm.calls).toBe(1);
    expect(h.events.map((s) => s.mode)).toEqual(['on', 'off']);
    expect(h.logger.at('info').filter((l) => l.includes('decision=coalesced'))).toHaveLength(2);
  });

  it('TS-QA-27 a failed toggle also releases the coalescing slot', async () => {
    const h = createHarness();
    h.settings.failNextWrite('EACCES');
    const p1 = h.controller.toggle();
    await p1;
    const p2 = h.controller.toggle();
    expect(p2).not.toBe(p1);
    expect((await p2).kind).toBe('changed');
  });

  it('TS-QA-28 direct calls queue FIFO behind a pending toggle and are never coalesced or concurrent', async () => {
    const h = createHarness();
    h.confirm.answer('hold', true);
    const done: string[] = [];
    const track = (name: string, p: Promise<ToggleOutcome>): Promise<ToggleOutcome> =>
      p.then((o) => {
        done.push(name);
        return o;
      });
    const t = track('toggle', h.controller.toggle());
    const d = track('disable', h.controller.disable());
    const e = track('enable', h.controller.enable());
    await flushMicrotasks();
    expect(h.settings.writes).toHaveLength(1);
    expect(done).toEqual([]);
    h.confirm.lastHeld.resolve(true);
    const [to, dis, en] = await Promise.all([t, d, e]);
    expect(done).toEqual(['toggle', 'disable', 'enable']);
    expect(to).toMatchObject({ kind: 'changed', state: { mode: 'on' } });
    expect(dis).toMatchObject({ kind: 'changed', state: { mode: 'off' } });
    expect(en).toMatchObject({ kind: 'changed', state: { mode: 'on' } });
    expect(h.confirm.calls).toBe(2);
    expect(h.trace.entries.filter((x) => x !== 'event')).toEqual([
      'write:identity',
      'confirm',
      'write:change',
      'write:change',
      'write:identity',
      'confirm',
      'write:change',
    ]);
  });

  it('TS-QA-28 enable() and disable() called twice are queued twice (not coalesced)', async () => {
    const h = createHarness({ confirmMode: 'never' });
    const a = h.controller.enable('statusBar');
    const b = h.controller.enable('statusBar');
    expect(b).not.toBe(a);
    expect((await a).kind).toBe('changed');
    expect((await b).kind).toBe('unchanged');
  });
});

describe('change listener (§3.2)', () => {
  it('TS-QA-30 (a) external write false clears this target stash only', () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    h.storage.seed(REMOTE_STASH, { v: 1, target: REMOTE_TARGET, value: false });
    h.settings.externalSet(false);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    expect(h.storage.peek(REMOTE_STASH)).toEqual({ v: 1, target: REMOTE_TARGET, value: false });
    expect(h.storage.updates.map((u) => u.key)).toEqual([LOCAL_STASH]);
  });

  it('TS-QA-30 (a) external removal of the key also clears the stash (malformed entries too)', () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, 'garbage');
    h.settings.externalSet(undefined);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-30 (b) an external change that keeps glob true keeps the stash', () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    h.settings.setOverride(false);
    h.settings.clearOverride();
    expect(h.storage.peek(LOCAL_STASH)).toEqual({ v: 1, target: 'local', value: false });
    expect(h.storage.updates).toEqual([]);
  });

  it('TS-QA-30 no stash present ⇒ the listener writes nothing to storage', () => {
    const h = createHarness({ user: true });
    h.settings.externalSet(false);
    expect(h.storage.updates).toEqual([]);
  });

  it('TS-QA-30 (c) our own enable write fires during inFlight and keeps the fresh stash', async () => {
    const h = createHarness({ user: false });
    h.storage.seed(REMOTE_STASH, { v: 1, target: REMOTE_TARGET });
    let stashDuringEvent: unknown = 'not fired';
    h.settings.onDidChange(() => {
      stashDuringEvent = h.storage.peek(LOCAL_STASH);
    });
    await h.controller.enable();
    expect(stashDuringEvent).toEqual({ v: 1, target: 'local', value: false });
    expect(h.storage.peek(LOCAL_STASH)).toEqual({ v: 1, target: 'local', value: false });
    expect(h.storage.peek(REMOTE_STASH)).toEqual({ v: 1, target: REMOTE_TARGET });
  });

  it('TS-QA-30 our own disable write (inFlight) does not race the stash clear: restore value is used', async () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: { a: true } });
    await h.controller.disable();
    expect(h.settings.userValue).toEqual({ a: true });
    expect(h.storage.updatesFor(LOCAL_STASH)).toEqual([{ key: LOCAL_STASH, value: undefined, error: undefined }]);
  });

  it('TS-QA-31 sticky reset on any change, then emits only when one of the four fields changes', async () => {
    const h = createHarness({ user: false });
    h.settings.failNextWrite(POLICY_MESSAGE);
    await h.controller.enable();
    expect(h.events).toHaveLength(1);
    expect(h.controller.state.managed).toBe(true);

    h.settings.fire();
    expect(h.controller.state.managed).toBe(false);
    expect(h.events).toHaveLength(2);

    h.settings.fire();
    expect(h.events).toHaveLength(2);

    h.settings.externalSet({ a: true });
    expect(h.events).toHaveLength(3);
    h.settings.externalSet({ b: true, c: false });
    expect(h.events).toHaveLength(3);
    h.settings.externalSet({ b: true, c: true });
    expect(h.events).toHaveLength(4);
    expect(h.events.at(-1)).toEqual({ mode: 'custom', customToolCount: 2, managed: false, userSettingOn: false });
  });

  it('TS-QA-31 a throwing state listener is logged and does not break other listeners or the controller', () => {
    const h = createHarness();
    h.controller.onDidChangeState(() => {
      throw new Error('listener boom');
    });
    const seen: string[] = [];
    h.controller.onDidChangeState((s) => seen.push(s.mode));
    h.settings.externalSet(true);
    expect(seen).toEqual(['on']);
    expect(h.logger.at('error').some((l) => l.includes('listener boom'))).toBe(true);
  });

  it('TS-QA-31 a disposed state subscription receives nothing', () => {
    const h = createHarness();
    const seen: string[] = [];
    const sub = h.controller.onDidChangeState((s) => seen.push(s.mode));
    sub.dispose();
    h.settings.externalSet(true);
    expect(seen).toEqual([]);
    expect(h.events).toHaveLength(1);
  });

  it('TS-QA-31 a read failure inside the listener is logged and leaves the state as it was', () => {
    const h = createHarness();
    h.settings.readError = 'config service gone';
    h.settings.fire();
    expect(h.controller.state.mode).toBe('off');
    expect(h.logger.at('error').some((l) => l.includes('config service gone'))).toBe(true);
  });

  it('TS-QA-31 storage.get throwing inside the listener is logged at warn; the state still updates', () => {
    const h = createHarness({ user: true });
    h.storage.getError = 'storage offline';
    h.settings.externalSet(false);
    expect(h.controller.state.userSettingOn).toBe(false);
    expect(h.logger.at('warn').some((l) => l.includes('storage offline'))).toBe(true);
  });
});

describe('initialize (§3.2)', () => {
  const remoteEntry = { v: 1, target: REMOTE_TARGET, value: 'r' };
  it.each([
    ['glob true + valid own stash ⇒ kept', true, { v: 1, target: 'local', value: false }, 'kept'],
    ['glob false + own stash ⇒ cleared', false, { v: 1, target: 'local', value: false }, 'cleared'],
    ['glob absent + own stash ⇒ cleared', undefined, { v: 1, target: 'local' }, 'cleared'],
    ['glob true + malformed entry ⇒ cleared', true, 42, 'cleared'],
    ['glob true + wrong target field ⇒ cleared', true, { v: 1, target: REMOTE_TARGET, value: false }, 'cleared'],
    ['no stash ⇒ no storage write', true, undefined, 'none'],
  ] as const)('TS-QA-32 %s', async (_name, user, entry, expected) => {
    const h = createHarness({ user });
    h.storage.seed(REMOTE_STASH, remoteEntry);
    if (entry !== undefined) {
      h.storage.seed(LOCAL_STASH, entry);
    }
    await h.controller.initialize();
    if (expected === 'kept') {
      expect(h.storage.peek(LOCAL_STASH)).toEqual(entry);
    } else {
      expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
    }
    expect(h.storage.updates.map((u) => u.key)).toEqual(expected === 'cleared' ? [LOCAL_STASH] : []);
    expect(h.storage.peek(REMOTE_STASH)).toEqual(remoteEntry);
    expect(h.storage.gets).not.toContain(REMOTE_STASH);
    expect(h.controller.state).toEqual(resolveState(h.settings.read(), false));
  });

  it('TS-QA-32 storage.update throws ⇒ initialize resolves and logs', async () => {
    const h = createHarness({ user: false });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local' });
    h.storage.failNextUpdate('disk locked');
    await expect(h.controller.initialize()).resolves.toBeUndefined();
    expect(h.logger.at('warn').some((l) => l.includes('disk locked'))).toBe(true);
  });

  it('TS-QA-32 storage.get throws ⇒ initialize still resolves (never throws)', async () => {
    const h = createHarness();
    h.storage.getError = 'corrupt state db';
    await expect(h.controller.initialize()).resolves.toBeUndefined();
    expect(h.logger.at('error').some((l) => l.includes('corrupt state db'))).toBe(true);
  });

  it('TS-QA-32 an enable() issued before initialize() resolves runs after it (queued)', async () => {
    const h = createHarness({ user: false });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: 'stale' });
    const init = h.controller.initialize();
    const enable = h.controller.enable();
    await init;
    expect((await enable).kind).toBe('changed');
    expect(h.storage.updatesFor(LOCAL_STASH).map((u) => u.value)).toEqual([
      undefined,
      { v: 1, target: 'local', value: false },
    ]);
  });

  it('TS-QA-32 initial state is computed at construction; an unreadable setting starts as unsupported', () => {
    expect(createHarness({ user: true }).controller.state).toEqual({
      mode: 'on',
      customToolCount: 0,
      managed: false,
      userSettingOn: true,
    });
    const h = createHarness();
    h.settings.readError = 'boom';
    const second = new AutoApproveController({
      settings: h.settings,
      storage: h.storage,
      preferences: h.prefs,
      confirm: h.confirm,
      logger: h.logger,
    });
    expect(second.state.mode).toBe('unsupported');
    expect(h.logger.at('error').some((l) => l.includes('boom'))).toBe(true);
  });
});

describe('dispose (§3.2)', () => {
  it('TS-QA-33 dispose mid-operation: no unhandled rejection, no events after dispose, listener removed, idempotent', async () => {
    const h = createHarness({ confirmAnswer: 'hold' });
    expect(h.settings.listenerCount).toBe(1);
    const pending = h.controller.enable();
    await flushMicrotasks();
    h.controller.dispose();
    expect(h.settings.listenerCount).toBe(0);
    h.confirm.lastHeld.resolve(true);
    const outcome = await pending;
    expect(outcome.kind).toBe('changed');
    h.settings.externalSet(false);
    h.settings.fire();
    expect(h.events).toEqual([]);
    expect(() => {
      h.controller.dispose();
    }).not.toThrow();
  });

  it('TS-QA-33 operations started after dispose still settle (no rejection)', async () => {
    const h = createHarness({ user: true });
    h.controller.dispose();
    await expect(h.controller.disable()).resolves.toMatchObject({ kind: 'changed' });
    await expect(h.controller.toggle()).resolves.toBeDefined();
    expect(h.events).toEqual([]);
  });

  it('TS-QA-33 a confirm that rejects after dispose still settles', async () => {
    const h = createHarness({ confirmAnswer: 'hold' });
    const pending = h.controller.toggle();
    await flushMicrotasks();
    h.controller.dispose();
    h.confirm.lastHeld.reject(new Error('window closed'));
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled' });
  });
});

describe('storage, confirm and unexpected failures (TS-QA-34)', () => {
  it('TS-QA-34 (a) ack write fails ⇒ blocked/write-failed + raw detail, nothing written but the probe', async () => {
    const h = createHarness({ user: false });
    h.storage.failNextUpdate('ack quota', (key) => key === ACK_KEY);
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'ack quota' });
    expect(h.settings.writes).toEqual([{ value: false, identity: true, error: undefined }]);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-34 (a) a synchronous throw from storage.update is handled the same way', async () => {
    const h = createHarness({ user: false });
    h.storage.failNextUpdate('sync ack failure', (key) => key === ACK_KEY, true);
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'sync ack failure' });
    expect(h.settings.changeWrites).toEqual([]);
  });

  it('TS-QA-34 (b) stash write fails ⇒ blocked/write-failed + raw detail, nothing written but the probe', async () => {
    const h = createHarness({ user: false });
    h.storage.failNextUpdate('stash quota', (key) => key === LOCAL_STASH);
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'stash quota' });
    expect(h.settings.changeWrites).toEqual([]);
    expect(h.settings.userValue).toBe(false);
    expect(h.storage.peek(ACK_KEY)).toBe(true);
  });

  it('TS-QA-34 (c) clearing the stash after a successful disable fails ⇒ changed, warn, next initialize clears it', async () => {
    const h = createHarness({ user: true });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    h.storage.failNextUpdate('clear failed', (key, value) => key === LOCAL_STASH && value === undefined);
    const outcome = await h.controller.disable();
    expect(outcome.kind).toBe('changed');
    expect(h.settings.userValue).toBe(false);
    expect(h.logger.at('warn').some((l) => l.includes('clear failed'))).toBe(true);
    expect(h.storage.data.has(LOCAL_STASH)).toBe(true);

    const next = new AutoApproveController({
      settings: h.settings,
      storage: h.storage,
      preferences: h.prefs,
      confirm: h.confirm,
      logger: h.logger,
    });
    await next.initialize();
    expect(h.storage.data.has(LOCAL_STASH)).toBe(false);
  });

  it('TS-QA-34 (d) confirm rejects ⇒ cancelled; only the probe; ack unchanged; warn logged', async () => {
    const h = createHarness({ confirmAnswer: 'reject' });
    const outcome = await h.controller.enable();
    expect(outcome.kind).toBe('cancelled');
    expect(h.settings.writes).toEqual([{ value: undefined, identity: true, error: undefined }]);
    expect(h.storage.updates).toEqual([]);
    expect(h.logger.at('warn').some((l) => l.includes('dialog service unavailable'))).toBe(true);
  });

  it('TS-QA-34 an unexpected throw inside an operation (settings.read) ⇒ blocked/write-failed, logged, queue continues', async () => {
    const h = createHarness();
    h.settings.readError = 'read exploded';
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: 'read exploded' });
    expect(h.logger.at('error').some((l) => l.includes('failed unexpectedly: read exploded'))).toBe(true);
    h.settings.readError = undefined;
    expect((await h.controller.enable()).kind).toBe('changed');
  });

  it('TS-QA-34 storage.get throwing while restoring after a failed verify ⇒ still settles as blocked', async () => {
    const h = createHarness({ user: false });
    h.settings.setOverride(false);
    let gets = 0;
    const get = h.storage.get.bind(h.storage);
    h.storage.get = (key) => {
      if (key === LOCAL_STASH && ++gets >= 1) {
        throw new Error('get exploded');
      }
      return get(key);
    };
    const outcome = await h.controller.enable();
    expect(outcome.kind).toBe('blocked');
    expect(h.controller.state).toEqual(resolveState(h.settings.read(), false));
  });
});

describe('logging contract (TS-QA-35, TS-AI-17)', () => {
  it('TS-QA-35 one info line per operation with origin, decision and outcome; failures at warn/error with the raw message', async () => {
    const h = createHarness({ user: { secretToolName: true, other: 'secretValue' } });
    await h.controller.initialize();
    await h.controller.enable('statusBar'); // changed
    await h.controller.enable('external'); // unchanged
    await h.controller.disable('external'); // changed (restores the map)
    h.confirm.answer(false);
    await h.controller.enable('external'); // cancelled
    h.settings.failWrites('EACCES: nope');
    h.settings.externalSet(false);
    await h.controller.enable('external'); // blocked/write-failed (probe)

    const outcomes = h.logger.at('info').filter((l) => l.includes('outcome='));
    expect(outcomes).toEqual([
      expect.stringMatching(/^initialize origin=external outcome=unchanged mode=custom count=1 /),
      expect.stringMatching(/^enable origin=statusBar outcome=changed mode=on /),
      expect.stringMatching(/^enable origin=external outcome=unchanged mode=on /),
      expect.stringMatching(/^disable origin=external outcome=changed mode=custom count=1 /),
      expect.stringMatching(/^enable origin=external outcome=cancelled mode=custom count=1 /),
      expect.stringMatching(/^enable origin=external outcome=blocked\/write-failed mode=off /),
    ]);
    expect(h.logger.at('error')).toContainEqual(expect.stringContaining('EACCES: nope'));
    expect(h.logger.leaks(['secretToolName', 'secretValue', 'other'])).toEqual([]);
  });

  it('TS-QA-35 logs mode/count only — a custom map value is never logged in full', async () => {
    const h = createHarness({ user: { 'mcp_tool-with-secret': true } });
    await h.controller.toggle();
    await h.controller.toggle();
    expect(h.logger.leaks(['mcp_tool-with-secret'])).toEqual([]);
    expect(h.logger.lines.length).toBeGreaterThan(0);
  });
});

describe('logging contract — exact lines (TS-QA-35)', () => {
  it('TS-QA-35 non-custom states log no count; the decision lines name each step', async () => {
    const h = createHarness({ user: false });
    await h.controller.enable('external');
    expect(h.logger.at('info')).toEqual([
      'enable origin=external decision=confirmed',
      'enable origin=external outcome=changed mode=on managed=false userSettingOn=true',
    ]);
    await h.controller.disable('external');
    expect(h.logger.at('info').slice(2)).toEqual([
      'disable origin=external decision=restore-previous',
      'disable origin=external outcome=changed mode=off managed=false userSettingOn=false',
    ]);
  });

  it('TS-QA-35 write failures name the failing step: enable-probe, enable, disable', async () => {
    const probe = createHarness({ user: false });
    probe.settings.failNextWrite(POLICY_MESSAGE);
    await probe.controller.enable();
    expect(probe.logger.at('warn')).toEqual([`enable-probe rejected by policy: ${POLICY_MESSAGE}`]);

    const enable = createHarness({ user: { a: true } });
    enable.settings.failNextWrite('EACCES');
    await enable.controller.enable();
    expect(enable.logger.at('error')).toEqual(['enable write failed: EACCES']);

    const disable = createHarness({ user: true });
    disable.settings.failNextWrite('EACCES');
    await disable.controller.disable();
    expect(disable.logger.at('error')).toEqual(['disable write failed: EACCES']);
  });

  it('TS-QA-35 storage failures name what could not be stored', async () => {
    const ack = createHarness({ user: false });
    ack.storage.failNextUpdate('quota', (key) => key === ACK_KEY);
    await ack.controller.enable('statusBar');
    expect(ack.logger.at('error')).toEqual(['enable aborted, could not store the risk acknowledgement: quota']);

    const stash = createHarness({ user: false, acknowledged: true, confirmMode: 'never' });
    stash.storage.failNextUpdate('quota', (key) => key === LOCAL_STASH);
    await stash.controller.enable('statusBar');
    expect(stash.logger.at('error')).toEqual(['enable aborted, could not store the previous value: quota']);
  });

  it('TS-QA-35 stash clean-up decisions are logged (initialize and external change)', async () => {
    const init = createHarness({ user: false });
    init.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: 'x' });
    await init.controller.initialize();
    expect(init.logger.at('info')[0]).toBe('initialize decision=clear-stale-stash');

    const change = createHarness({ user: true });
    change.storage.seed(LOCAL_STASH, { v: 1, target: 'local' });
    change.settings.externalSet(false);
    expect(change.logger.at('info')).toEqual(['change decision=clear-stash-after-external-change']);
  });
});

describe('in-flight protection and defensive paths (mutation-driven)', () => {
  it('TS-QA-26 toggle when another layer forces on (user unset) routes to disable, not to an unchanged enable', async () => {
    const h = createHarness();
    h.settings.setOverride(true);
    expect(h.controller.state).toMatchObject({ mode: 'on', userSettingOn: false });
    const outcome = await h.controller.toggle();
    expect(h.logger.at('info')).toContain('toggle origin=external decision=disable');
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'verify-failed' });
    expect(h.confirm.calls).toBe(0);
  });

  it('TS-QA-30 a settings event while the stash is being written does not clear the fresh stash (I2)', async () => {
    const h = createHarness({ user: undefined, acknowledged: true, confirmMode: 'never' });
    const update = h.storage.update.bind(h.storage);
    h.storage.update = (key: string, value: unknown) => {
      const result = update(key, value);
      if (key === LOCAL_STASH && value !== undefined) {
        h.settings.fire(); // e.g. another window touched settings.json while globalState was being written
      }
      return result;
    };
    expect((await h.controller.enable('statusBar')).kind).toBe('changed');
    expect(h.storage.peek(LOCAL_STASH)).toEqual({ v: 1, target: 'local' });
    expect((await h.controller.disable()).kind).toBe('changed');
    expect(h.settings.userValue).toBeUndefined();
  });

  it('TS-QA-30 a settings event during the identity probe does not clear an existing stash', async () => {
    const h = createHarness({ user: false, acknowledged: true, confirmMode: 'never' });
    h.storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: 'keep' });
    h.settings.onWriteAttempt = (_value, identity) => {
      if (identity) {
        h.settings.fire();
      }
    };
    await h.controller.enable('statusBar');
    expect(h.storage.updatesFor(LOCAL_STASH).map((u) => u.value)).not.toContain(undefined);
  });

  it('TS-QA-34 unreadable storage in the change listener ⇒ warn and leave storage alone', () => {
    const h = createHarness({ user: true });
    h.storage.getError = 'storage gone';
    h.settings.externalSet(false);
    expect(h.storage.updates).toEqual([]);
    expect(h.logger.at('warn')).toEqual(['Could not read the stored previous value: storage gone']);
    expect(h.controller.state.mode).toBe('off');
  });
});

describe('localized policy message (TS-QA-46)', () => {
  it('TS-QA-46 enable: French policy text ⇒ blocked/write-failed with the exact raw detail shown verbatim', async () => {
    const h = createHarness({ user: false });
    h.settings.failNextWrite(FRENCH_POLICY);
    const outcome = await h.controller.enable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: FRENCH_POLICY });
    expect(h.controller.state.managed).toBe(false);
    const feedback = describeOutcome(outcome);
    expect(feedback.kind).toBe('warning');
    expect(feedback.kind === 'warning' && feedback.text.includes(FRENCH_POLICY)).toBe(true);
  });

  it('TS-QA-46 disable: French policy text ⇒ blocked/write-failed with the exact raw detail', async () => {
    const h = createHarness({ user: true });
    h.settings.failNextWrite(FRENCH_POLICY);
    const outcome = await h.controller.disable();
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'write-failed', detail: FRENCH_POLICY });
  });
});

describe('remote / local isolation (TS-ADM-07)', () => {
  it('TS-ADM-07 remote steps never touch the local stash; each machine restores its own prior value', async () => {
    const local = createHarness({ user: undefined });
    expect((await local.controller.enable()).kind).toBe('changed');
    const localStash = local.storage.peek(LOCAL_STASH);
    expect(localStash).toEqual({ v: 1, target: 'local' });

    const remote = createHarness({ targetId: REMOTE_TARGET, user: false, storage: local.storage, acknowledged: true });
    const steps: (() => Promise<unknown>)[] = [
      () => remote.controller.initialize(),
      () => remote.controller.enable(),
      () => {
        remote.settings.externalSet(false);
        return Promise.resolve();
      },
      () => remote.controller.enable(),
      () => remote.controller.disable(),
    ];
    for (const step of steps) {
      await step();
      expect(local.storage.peek(LOCAL_STASH)).toEqual(localStash);
    }
    expect(remote.settings.userValue).toBe(false);
    expect(remote.storage.data.has(REMOTE_STASH)).toBe(false);

    expect((await local.controller.disable()).kind).toBe('changed');
    expect(local.settings.userValue).toBeUndefined();
    expect(local.settings.writes.at(-1)?.value).toBeUndefined();
  });

  it('TS-ADM-07 targetId is read on each access: a target switch after enable never restores another target value', async () => {
    const h = createHarness({ targetId: 'remote:ssh-remote:', user: { a: true } });
    await h.controller.enable();
    expect(h.storage.data.has(stashKeyFor('remote:ssh-remote:'))).toBe(true);
    h.settings.targetId = REMOTE_TARGET;
    const outcome = await h.controller.disable();
    expect(outcome.kind).toBe('changed');
    expect(h.settings.userValue).toBe(false);
    expect(h.storage.data.has(REMOTE_STASH)).toBe(false);
  });
});

describe('frozen states (§9)', () => {
  it('TS-QA-55 initial, emitted and outcome states are frozen; mutating them throws and changes nothing', async () => {
    const h = createHarness({ user: false, acknowledged: true, confirmMode: 'never' });
    expect(Object.isFrozen(h.controller.state)).toBe(true);
    const outcome = await h.controller.toggle('statusBar');
    expect(outcome.kind).toBe('changed');
    expect(Object.isFrozen(outcome.state)).toBe(true);
    expect(h.events.length).toBeGreaterThan(0);
    expect(h.events.every((state) => Object.isFrozen(state))).toBe(true);
    expect(() => {
      (outcome.state as { mode: string }).mode = 'off';
    }).toThrow(TypeError);
    expect(h.controller.state.mode).toBe('on');
  });

  it('TS-QA-33 a change event already dispatched to a disposed controller is ignored (no read, no stash clear)', async () => {
    const settings = new FakeSettings({ user: true });
    const storage = new FakeStorage();
    storage.seed(LOCAL_STASH, { v: 1, target: 'local', value: false });
    // Registered before the controller's own listener, so fire() disposes the controller and then still calls it.
    settings.onDidChange(() => {
      controller.dispose();
    });
    const controller = new AutoApproveController({
      settings,
      storage,
      preferences: new FakePreferences('firstTime'),
      confirm: new FakeConfirm(true),
      logger: new FakeLogger(),
    });
    const events: unknown[] = [];
    controller.onDidChangeState((state) => events.push(state));
    const reads = settings.readsCount;
    settings.externalSet(false);
    await flushMicrotasks();
    expect(settings.readsCount).toBe(reads);
    expect(storage.peek(LOCAL_STASH)).toEqual({ v: 1, target: 'local', value: false });
    expect(controller.state.userSettingOn).toBe(true);
    expect(events).toEqual([]);
  });

  it('TS-QA-33 unreadable settings at construction ⇒ frozen unsupported fallback state', () => {
    const settings = new FakeSettings();
    settings.readError = 'boom';
    const logger = new FakeLogger();
    const controller = new AutoApproveController({
      settings,
      storage: new FakeStorage(),
      preferences: new FakePreferences('firstTime'),
      confirm: new FakeConfirm(true),
      logger,
    });
    expect(controller.state).toEqual({ mode: 'unsupported', customToolCount: 0, managed: false, userSettingOn: false });
    expect(Object.isFrozen(controller.state)).toBe(true);
    expect(logger.at('error').join('\n')).toContain('Could not read the setting: boom');
    controller.dispose();
  });
});
