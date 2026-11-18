import fc from 'fast-check';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/constants';
import { AutoApproveController } from '../../src/core/controller';
import { isValidStash } from '../../src/core/stash';
import { resolveState } from '../../src/core/state';
import type { ConfirmMode, InvocationOrigin, StoragePort, ToggleOutcome } from '../../src/core/types';
import {
  ACK_KEY,
  type ConfirmAnswer,
  createHarness,
  FakeConfirm,
  FakeLogger,
  FakePreferences,
  FakeSettings,
  FakeStorage,
  flushMicrotasks,
  POLICY_MESSAGE,
  REMOTE_TARGET,
  stashKeyFor,
} from './fakes';
import { fcParams } from './fakes/fc';

// ---- value generators ------------------------------------------------------------------------------------------

/** Tool names / string values carry unique markers so the log-redaction check (TS-AI-17) can find any leak. */
const secretKey = fc.stringMatching(/^[a-z]{4}$/).map((s) => `tool${s}Zq`);
const secretString = fc.stringMatching(/^[a-z]{4}$/).map((s) => `val${s}Xk`);
const SECRET = /(?:tool[a-z]{4}Zq|val[a-z]{4}Xk)/g;

const toolMap = fc.dictionary(secretKey, fc.oneof(fc.constant<unknown>(true), fc.constant(false), secretString), {
  maxKeys: 4,
});
const primitiveValue = fc.constantFrom<unknown>(true, false, undefined, null, 'true', 1, 0);
const userValue = fc.oneof(
  { weight: 4, arbitrary: primitiveValue },
  { weight: 2, arbitrary: toolMap },
  { weight: 1, arbitrary: fc.constantFrom<unknown>([true], {}) },
  { weight: 1, arbitrary: secretString },
);
const policyValue = fc.oneof(fc.constantFrom<unknown>(true, false), toolMap);
const corruptEntry = fc.oneof(
  fc.jsonValue(),
  fc.record({ v: fc.constantFrom<unknown>(1, 2, '1'), target: fc.constantFrom<unknown>('local', REMOTE_TARGET, 5) }),
  fc.record({ v: fc.constant(1), target: fc.constant('local'), value: userValue }),
);
const origin = fc.constantFrom<InvocationOrigin>('statusBar', 'external');
const answer = fc.constantFrom<ConfirmAnswer>(true, true, false, 'hold', 'reject');
const machineIndex = fc.constantFrom(0, 1);

type Step =
  | { t: 'op'; m: number; kind: 'toggle' | 'enable' | 'disable'; origin: InvocationOrigin; answer: ConfirmAnswer }
  | { t: 'resolve'; m: number; answer: boolean | 'reject' }
  | { t: 'external'; m: number; value: unknown }
  | { t: 'writeFail'; m: number; policy: boolean }
  | { t: 'storageFail'; key: 'ack' | 'stash'; sync: boolean }
  | { t: 'policy'; m: number; value: unknown; clear: boolean }
  | { t: 'override'; m: number; value: unknown; clear: boolean }
  | { t: 'supported'; m: number; value: boolean }
  | { t: 'corrupt'; m: number; value: unknown }
  | { t: 'prefs'; m: number; mode: ConfirmMode }
  | { t: 'initialize'; m: number }
  | { t: 'restart'; m: number }
  | { t: 'retarget' };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 10,
    arbitrary: fc.record({
      t: fc.constant('op' as const),
      m: machineIndex,
      kind: fc.constantFrom('toggle' as const, 'enable' as const, 'disable' as const),
      origin,
      answer,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('resolve' as const),
      m: machineIndex,
      answer: fc.constantFrom<boolean | 'reject'>(true, false, 'reject'),
    }),
  },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('external' as const), m: machineIndex, value: userValue }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('writeFail' as const), m: machineIndex, policy: fc.boolean() }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('storageFail' as const),
      key: fc.constantFrom('ack' as const, 'stash' as const),
      sync: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant('policy' as const),
      m: machineIndex,
      value: policyValue,
      clear: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant('override' as const),
      m: machineIndex,
      value: userValue,
      clear: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('supported' as const), m: machineIndex, value: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('corrupt' as const), m: machineIndex, value: corruptEntry }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('prefs' as const),
      m: machineIndex,
      mode: fc.constantFrom<ConfirmMode>('firstTime', 'always', 'never'),
    }),
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('initialize' as const), m: machineIndex }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('restart' as const), m: machineIndex }) },
  { weight: 1, arbitrary: fc.constant<Step>({ t: 'retarget' }) },
);

// ---- the world -------------------------------------------------------------------------------------------------

interface Op {
  readonly kind: 'initialize' | 'toggle' | 'enable' | 'disable';
  readonly origin: InvocationOrigin;
  readonly promise: Promise<unknown>;
  probedUnderPolicy: boolean;
  confirmed: boolean;
  /** Set when the op attempted to write `true` (enable path); holds the user value just before that write. */
  enableWrite: { readonly prior: unknown } | undefined;
}

interface Machine {
  readonly name: string;
  readonly settings: FakeSettings;
  readonly confirm: FakeConfirm;
  readonly prefs: FakePreferences;
  readonly logger: FakeLogger;
  controller: AutoApproveController;
  /** Unsettled, non-coalesced operations of this machine, FIFO (the head is the one executing). */
  readonly pending: Op[];
  /** I2 bookkeeping: prior user value captured by our last successful enable, while nothing else touched it. */
  i2: { readonly prior: unknown; clean: boolean } | undefined;
}

const isProbeable = (value: unknown): boolean => value === undefined || value === null || typeof value !== 'object';

class World {
  readonly storage = new FakeStorage();
  readonly machines: Machine[];
  readonly violations: string[] = [];
  readonly secrets = new Set<string>();

  constructor(initial: readonly [unknown, unknown]) {
    this.machines = [
      this.createMachine('local', 'local', initial[0]),
      this.createMachine('remote', REMOTE_TARGET, initial[1]),
    ];
    initial.forEach((v) => {
      this.noteSecrets(v);
    });
  }

  noteSecrets(value: unknown): void {
    for (const match of JSON.stringify(value ?? null).matchAll(SECRET)) {
      this.secrets.add(match[0]);
    }
  }

  private createMachine(name: string, targetId: string, initial: unknown): Machine {
    const settings = new FakeSettings({ targetId, user: initial });
    const confirm = new FakeConfirm(true);
    const prefs = new FakePreferences('firstTime');
    const logger = new FakeLogger();
    const machine = { name, settings, confirm, prefs, logger, pending: [], i2: undefined } as unknown as Machine;
    this.instrument(machine);
    machine.controller = this.newController(machine);
    return machine;
  }

  newController(m: Machine): AutoApproveController {
    return new AutoApproveController({
      settings: m.settings,
      storage: this.scopedStorage(m),
      preferences: m.prefs,
      confirm: m.confirm,
      logger: m.logger,
    });
  }

  /** I3: a controller may only touch the ack key and its own target's stash key. */
  private scopedStorage(m: Machine): StoragePort {
    const check = (key: string): void => {
      if (key !== ACK_KEY && key !== stashKeyFor(m.settings.targetId)) {
        this.violations.push(`I3: ${m.name} touched foreign key ${key}`);
      }
    };
    return {
      get: (key) => {
        check(key);
        return this.storage.get(key);
      },
      update: (key, value) => {
        check(key);
        return this.storage.update(key, value);
      },
    };
  }

  private instrument(m: Machine): void {
    m.settings.onWriteAttempt = (value, identity) => {
      const head = m.pending[0];
      if (identity) {
        if (head && m.settings.hasPolicy) {
          head.probedUnderPolicy = true;
        }
        return;
      }
      if (!head) {
        this.violations.push(`${m.name}: write ${JSON.stringify(value)} outside any operation`);
        return;
      }
      if (value === true) {
        head.enableWrite = { prior: m.settings.userValue };
        if (head.origin === 'external' && !head.confirmed) {
          this.violations.push(`I7: ${m.name} external ${head.kind} wrote true without confirmation`);
        }
        if (head.probedUnderPolicy) {
          this.violations.push(`I8: ${m.name} ${head.kind} wrote true after a probe under policy`);
        }
      }
    };
    const confirmEnable = m.confirm.confirmEnable.bind(m.confirm);
    m.confirm.confirmEnable = () => {
      const head = m.pending[0];
      if (!head || head.kind === 'disable' || head.kind === 'initialize') {
        this.violations.push(`${m.name}: dialog shown outside an enable (${head?.kind ?? 'none'})`);
      }
      if (head?.probedUnderPolicy) {
        this.violations.push(`I8: ${m.name} dialog shown although the probe ran under policy`);
      }
      const result = confirmEnable();
      void result.then(
        (accepted) => {
          if (head && accepted) {
            head.confirmed = true;
          }
        },
        () => undefined,
      );
      return result;
    };
  }

  start(m: Machine, kind: Op['kind'], opOrigin: InvocationOrigin): void {
    const c = m.controller;
    const promise: Promise<unknown> =
      kind === 'initialize'
        ? c.initialize()
        : kind === 'toggle'
          ? c.toggle(opOrigin)
          : kind === 'enable'
            ? c.enable(opOrigin)
            : c.disable(opOrigin);
    if (m.pending.some((p) => p.promise === promise)) {
      return; // coalesced toggle
    }
    const op: Op = {
      kind,
      origin: opOrigin,
      promise,
      probedUnderPolicy: false,
      confirmed: false,
      enableWrite: undefined,
    };
    m.pending.push(op);
    promise.then(
      (outcome) => {
        this.settled(m, op, outcome as ToggleOutcome | undefined);
      },
      (e: unknown) => {
        this.violations.push(`I4: ${m.name} ${kind} rejected: ${String(e)}`);
      },
    );
  }

  private settled(m: Machine, op: Op, outcome: ToggleOutcome | undefined): void {
    if (m.pending[0] !== op) {
      this.violations.push(`FIFO: ${m.name} ${op.kind} settled out of order`);
    }
    m.pending.splice(m.pending.indexOf(op), 1);
    const key = stashKeyFor(m.settings.targetId);
    const fresh = m.settings.read();
    if (op.kind === 'initialize') {
      const entry = this.storage.peek(key);
      if (entry !== undefined && (fresh.globalValue !== true || !isValidStash(entry, m.settings.targetId))) {
        this.stashMayRemain(key, `I3: ${m.name} initialize kept a stale/invalid stash`);
      }
      return;
    }
    if (!outcome) {
      return;
    }
    const enablePath = op.kind === 'enable' || (op.kind === 'toggle' && op.enableWrite !== undefined);
    if (outcome.kind === 'changed' && enablePath) {
      if (fresh.effective !== true) {
        this.violations.push(`${m.name}: enable reported changed but effective is ${JSON.stringify(fresh.effective)}`);
      }
      m.i2 = op.enableWrite ? { prior: op.enableWrite.prior, clean: true } : undefined;
    }
    const disablePath = op.kind === 'disable' || (op.kind === 'toggle' && op.enableWrite === undefined);
    if (disablePath && outcome.kind === 'changed') {
      if (fresh.effective === true) {
        this.violations.push(`I1: ${m.name} disable reported changed but effective is still true`);
      }
      if (m.i2?.clean && !isDeepStrictEqual(m.settings.userValue, m.i2.prior)) {
        this.violations.push(
          `I2: ${m.name} restored ${JSON.stringify(m.settings.userValue)} instead of ${JSON.stringify(m.i2.prior)}`,
        );
      }
      m.i2 = undefined;
    }
    if (
      disablePath &&
      (outcome.kind === 'changed' || (outcome.kind === 'blocked' && outcome.reason === 'verify-failed'))
    ) {
      if (this.storage.peek(key) !== undefined) {
        this.stashMayRemain(key, `I3: ${m.name} stash survived a disable`);
      }
    }
  }

  /** A stash may only survive when the last update to its key was an injected storage failure. */
  stashMayRemain(key: string, message: string): void {
    const last = this.storage.updatesFor(key).at(-1);
    if (!last?.error) {
      this.violations.push(message);
    }
  }

  dirty(m: Machine): void {
    if (m.i2) {
      m.i2.clean = false;
    }
  }

  /** I5: state equals resolveState(fresh read, sticky). */
  checkState(m: Machine): void {
    const sticky = (m.controller as unknown as { stickyManaged: boolean }).stickyManaged;
    const expected = resolveState(m.settings.read(), sticky);
    if (!isDeepStrictEqual(m.controller.state, expected)) {
      this.violations.push(`I5: ${m.name} state ${JSON.stringify(m.controller.state)} ≠ ${JSON.stringify(expected)}`);
    }
  }

  async settle(): Promise<void> {
    await flushMicrotasks();
    await new Promise((resolve) => setImmediate(resolve));
  }

  async drain(m: Machine): Promise<void> {
    for (let i = 0; i < 50 && m.pending.length > 0; i++) {
      for (const held of m.confirm.held) {
        if (!held.settled) {
          held.resolve(false);
        }
      }
      await this.settle();
    }
    if (m.pending.length > 0) {
      this.violations.push(`I4: ${m.name} has operations that never settle`);
    }
  }

  async apply(s: Step): Promise<void> {
    switch (s.t) {
      case 'op': {
        const m = this.machine(s.m);
        m.confirm.answer(s.answer);
        this.start(m, s.kind, s.origin);
        break;
      }
      case 'resolve': {
        const held = this.machine(s.m).confirm.held.find((h) => !h.settled);
        if (s.answer === 'reject') {
          held?.reject(new Error('dialog closed'));
        } else {
          held?.resolve(s.answer);
        }
        break;
      }
      case 'external': {
        const m = this.machine(s.m);
        this.noteSecrets(s.value);
        this.dirty(m);
        m.settings.externalSet(s.value);
        const key = stashKeyFor(m.settings.targetId);
        if (m.settings.userValue !== true && this.storage.peek(key) !== undefined) {
          this.stashMayRemain(key, `I3: ${m.name} stash survived an external disable`);
        }
        break;
      }
      case 'writeFail':
        this.machine(s.m).settings.failNextWrite(s.policy ? POLICY_MESSAGE : 'EACCES: permission denied');
        break;
      case 'storageFail':
        this.storage.failNextUpdate(
          `storage failure (${s.key})`,
          (key) => (s.key === 'ack' ? key === ACK_KEY : key.startsWith(STORAGE_KEYS.stash)),
          s.sync,
        );
        break;
      case 'policy': {
        const m = this.machine(s.m);
        this.noteSecrets(s.value);
        this.dirty(m);
        if (s.clear) {
          m.settings.clearPolicy();
        } else {
          m.settings.setPolicy(s.value);
        }
        break;
      }
      case 'override': {
        const m = this.machine(s.m);
        this.noteSecrets(s.value);
        this.dirty(m);
        if (s.clear) {
          m.settings.clearOverride();
        } else {
          m.settings.setOverride(s.value);
        }
        break;
      }
      case 'supported': {
        const m = this.machine(s.m);
        this.dirty(m);
        m.settings.supported = s.value;
        m.settings.fire();
        break;
      }
      case 'corrupt': {
        const m = this.machine(s.m);
        this.noteSecrets(s.value);
        this.dirty(m);
        this.storage.seed(stashKeyFor(m.settings.targetId), s.value);
        break;
      }
      case 'prefs':
        this.machine(s.m).prefs.mode = s.mode;
        break;
      case 'initialize':
        this.start(this.machine(s.m), 'initialize', 'external');
        break;
      case 'restart': {
        const m = this.machine(s.m);
        m.controller.dispose();
        await this.drain(m);
        m.controller = this.newController(m);
        this.start(m, 'initialize', 'external');
        break;
      }
      case 'retarget': {
        const m = this.machine(1);
        this.dirty(m);
        m.settings.targetId = m.settings.targetId === REMOTE_TARGET ? 'remote:ssh-remote:' : REMOTE_TARGET;
        break;
      }
    }
    await this.settle();
  }

  machine(index: number): Machine {
    const m = this.machines[index];
    if (!m) {
      throw new Error(`no machine ${index}`);
    }
    return m;
  }
}

// ---- I4 spy ------------------------------------------------------------------------------------------------------

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

// ---- properties --------------------------------------------------------------------------------------------------

describe('controller chaos (model-based, seeded)', () => {
  it('TS-AI-08 TS-AI-09 TS-AI-11 TS-AI-12 TS-AI-15 TS-AI-17 random command sequences keep invariants I1–I5, I7, I8 after every step', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(userValue, userValue),
        fc.array(step, { minLength: 1, maxLength: 40 }),
        async (initial, steps) => {
          unhandled = [];
          const world = new World(initial);
          for (const m of world.machines) {
            world.start(m, 'initialize', 'external');
          }
          await world.settle();
          for (const s of steps) {
            await world.apply(s);
            for (const m of world.machines) {
              world.checkState(m);
            }
            expect(world.violations, `after step ${JSON.stringify(s)}`).toEqual([]);
          }
          for (const m of world.machines) {
            m.controller.dispose();
            await world.drain(m);
          }
          await world.settle();
          expect(world.violations).toEqual([]);
          expect(unhandled).toEqual([]);
          const secrets = [...world.secrets];
          for (const m of world.machines) {
            expect(m.logger.leaks(secrets), 'TS-AI-17 setting values leaked into logs').toEqual([]);
          }
        },
      ),
      fcParams({ numRuns: 150 }),
    );
  });

  it('TS-AI-10 I2 — enable→disable restores the exact prior value per machine, with two targets sharing storage', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          userValue.filter((v) => v !== true),
          userValue.filter((v) => v !== true),
        ),
        fc.array(
          fc.record({
            m: machineIndex,
            kind: fc.constantFrom('toggle' as const, 'enable' as const, 'disable' as const),
            origin,
          }),
          { minLength: 1, maxLength: 30 },
        ),
        async (initial, ops) => {
          const world = new World(initial);
          const priors = initial.map((v) => v);
          for (const op of ops) {
            const m = world.machine(op.m);
            const before = m.settings.userValue;
            world.start(m, op.kind, op.origin);
            await world.settle();
            const after = m.settings.userValue;
            if (before !== true && after === true) {
              priors[op.m] = before;
            } else if (before === true && after !== true) {
              expect(after).toEqual(priors[op.m]);
            }
            expect(world.violations).toEqual([]);
          }
          for (const [i, m] of world.machines.entries()) {
            await m.controller.disable();
            expect(m.settings.userValue, `machine ${i} final restore`).toEqual(priors[i]);
          }
        },
      ),
      fcParams(),
    );
  });

  it('TS-AI-13 I6 — N rapid toggles while one is pending share one promise, one state change, one real write', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 50 }),
        fc.array(origin, { minLength: 50, maxLength: 50 }),
        fc.constantFrom<unknown>(undefined, false, { a: true }),
        async (n, origins, initial) => {
          const h = createHarness({ user: initial, confirmAnswer: 'hold', confirmMode: 'always' });
          const promises = Array.from({ length: n }, (_, i) => h.controller.toggle(origins[i]));
          await flushMicrotasks();
          for (const p of promises) {
            expect(p).toBe(promises[0]);
          }
          expect(h.confirm.calls).toBe(1);
          h.confirm.lastHeld.resolve(true);
          const outcomes = await Promise.all(promises);
          expect(new Set(outcomes).size).toBe(1);
          expect(h.events).toHaveLength(1);
          expect(h.settings.changeWrites).toHaveLength(1);
        },
      ),
      fcParams(),
    );
  });

  it('TS-AI-14 I7 — enable/toggle from external always confirm exactly once before any non-identity write', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ConfirmMode>('firstTime', 'always', 'never'),
        fc.boolean(),
        fc.oneof(
          fc.constantFrom<unknown>(undefined, false, null, 'true'),
          toolMap.filter((m) => Object.values(m).includes(true)),
        ),
        fc.constantFrom('enable' as const, 'toggle' as const),
        fc.boolean(),
        async (mode, acknowledged, initial, kind, accept) => {
          const h = createHarness({ user: initial, confirmMode: mode, acknowledged, confirmAnswer: accept });
          const outcome = await (kind === 'enable' ? h.controller.enable('external') : h.controller.toggle('external'));
          expect(h.confirm.calls).toBe(1);
          const confirmAt = h.trace.indexOf('confirm');
          const firstChange = h.trace.indexOf('write:change');
          expect(confirmAt).toBeGreaterThanOrEqual(0);
          if (firstChange >= 0) {
            expect(firstChange).toBeGreaterThan(confirmAt);
          }
          expect(outcome.kind).toBe(accept ? 'changed' : 'cancelled');
        },
      ),
      fcParams(),
    );
  });

  it('TS-AI-15 I8 — under policy: no dialog for probe-able values, nothing but identity/rejected writes, value unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        policyValue,
        userValue,
        fc.array(
          fc.record({ kind: fc.constantFrom('toggle' as const, 'enable' as const, 'disable' as const), origin }),
          {
            minLength: 1,
            maxLength: 10,
          },
        ),
        fc.constantFrom<ConfirmMode>('firstTime', 'always', 'never'),
        async (policy, initial, ops, mode) => {
          const h = createHarness({ user: initial, confirmMode: mode });
          h.settings.setPolicy(policy);
          for (const op of ops) {
            const writesBefore = h.settings.writes.length;
            const outcome = await h.controller[op.kind](op.origin);
            expect(outcome.kind).not.toBe('changed');
            if (policy === true && op.kind === 'enable') {
              // Policy forcing true reads as `on`: enable does not even probe.
              expect(h.settings.writes.length).toBe(writesBefore);
            }
          }
          if (isProbeable(initial)) {
            expect(h.confirm.calls).toBe(0);
          }
          for (const w of h.settings.writes) {
            expect(w.identity || w.error !== undefined).toBe(true);
          }
          expect(h.settings.userValue).toEqual(initial);
        },
      ),
      fcParams(),
    );
  });

  it('TS-AI-16 stash fuzz — initialize then disable writes only false, undefined or a valid same-target stash value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(corruptEntry, fc.anything()),
        fc.constantFrom('local', REMOTE_TARGET),
        async (raw, target) => {
          const h = createHarness({ user: true, targetId: target });
          let seeded: unknown;
          try {
            seeded = structuredClone(raw);
          } catch {
            seeded = String(raw);
          }
          h.storage.seed(stashKeyFor(target), seeded);
          await expect(h.controller.initialize()).resolves.toBeUndefined();
          const outcome = await h.controller.disable();
          expect(outcome.kind).toBe('changed');
          const written = h.settings.changeWrites.map((w) => w.value);
          expect(written).toHaveLength(1);
          const valid = isValidStash(seeded, target) && (seeded as { value?: unknown }).value !== true;
          const allowed: unknown[] = [false];
          if (valid) {
            allowed.push((seeded as { value?: unknown }).value);
          }
          expect(allowed).toContainEqual(written[0]);
          expect(h.storage.data.has(stashKeyFor(target))).toBe(false);
        },
      ),
      fcParams(),
    );
  });
});
