import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { countEnabledTools, isPlainObject, resolveState, statesEqual } from '../../src/core/state';
import type { AutoApproveState } from '../../src/core/types';
import { present } from '../../src/ui/presentation';
import { S } from './fakes';

const off = (managed = false, userSettingOn = false): AutoApproveState => ({
  mode: 'off',
  customToolCount: 0,
  managed,
  userSettingOn,
});

describe('resolveState — boundaries (§3.1)', () => {
  it('TS-QA-01 unsupported wins over everything (sticky, user true, effective true)', () => {
    expect(resolveState(S(true, undefined, true), true)).toEqual({
      mode: 'unsupported',
      customToolCount: 0,
      managed: false,
      userSettingOn: false,
    });
    expect(resolveState(S({ a: true }, undefined, { a: true }), false).mode).toBe('unsupported');
  });

  it.each([
    [true, 'on', 0],
    [false, 'off', 0],
    [undefined, 'off', 0],
    [{}, 'off', 0],
    [{ a: false }, 'off', 0],
    [{ a: true }, 'custom', 1],
    [{ a: true, b: true, c: false }, 'custom', 2],
  ] as const)('TS-QA-02 mode boundary table: eff=%j ⇒ %s (count %d)', (eff, mode, count) => {
    const state = resolveState(S(eff), false);
    expect(state.mode).toBe(mode);
    expect(state.customToolCount).toBe(count);
  });

  const globs: readonly unknown[] = [true, 'true', { a: true }, false, undefined];
  const effs: readonly unknown[] = [true, false];
  const defs: readonly unknown[] = [false, true];
  const cases = globs.flatMap((glob) =>
    effs.flatMap((eff) => defs.flatMap((def) => [false, true].map((sticky) => ({ glob, eff, def, sticky })))),
  );

  it.each(cases)('TS-QA-03 managed/userSettingOn truth table: %j', ({ glob, eff, def, sticky }) => {
    const state = resolveState(S(eff, def, glob), sticky);
    const userSettingOn = glob === true;
    expect(state.userSettingOn).toBe(userSettingOn);
    expect(state.managed).toBe((userSettingOn && eff !== true) || def === true || sticky);
    expect(state.mode).toBe(eff === true ? 'on' : 'off');
  });

  it('TS-QA-03 policy forcing true (def true, eff true) is on + managed', () => {
    expect(resolveState(S(true, true, undefined), false)).toEqual({
      mode: 'on',
      customToolCount: 0,
      managed: true,
      userSettingOn: false,
    });
  });

  it('TS-QA-03 custom map keeps the managed flag (derived from user true + map effective)', () => {
    expect(resolveState(S({ a: true }, false, true), false)).toEqual({
      mode: 'custom',
      customToolCount: 1,
      managed: true,
      userSettingOn: true,
    });
  });
});

describe('resolveState — adversarial values', () => {
  it.each([[{ x: 'true' }], [[true]], ['true'], [1], [null], [{}], [{ a: { b: true } }]])(
    'TS-AI-04 adversarial effective %j ⇒ off',
    (eff) => {
      expect(resolveState(S(eff), false)).toEqual(off());
    },
  );

  it('TS-AI-04 only own values === true count in a mixed map', () => {
    expect(resolveState(S({ a: true, x: 'true', n: 1 }), false)).toEqual({
      mode: 'custom',
      customToolCount: 1,
      managed: false,
      userSettingOn: false,
    });
  });

  it.each([[[true]], ['true'], [1], [{ a: true }]])('TS-AI-04 glob=%j is not userSettingOn', (glob) => {
    expect(resolveState(S(false, false, glob), false).userSettingOn).toBe(false);
  });

  it('TS-AI-04 def = null is supported (only undefined means unsupported)', () => {
    expect(resolveState(S(false, null, undefined), false)).toEqual(off());
    expect(resolveState(S(true, null, true), false).mode).toBe('on');
  });

  it('TS-AI-05 __proto__ own key from JSON counts as a tool and does not pollute Object.prototype', () => {
    const eff: unknown = JSON.parse('{"__proto__":true}');
    expect(resolveState(S(eff), false)).toMatchObject({ mode: 'custom', customToolCount: 1 });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.getPrototypeOf(eff)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('true');
  });

  it('TS-AI-05 constructor/toString keys count as ordinary tools', () => {
    const eff: unknown = JSON.parse('{"constructor":true,"toString":true}');
    expect(resolveState(S(eff), false)).toMatchObject({ mode: 'custom', customToolCount: 2 });
  });

  it('TS-AI-05 null-prototype map counts', () => {
    const eff = Object.create(null) as Record<string, unknown>;
    eff.a = true;
    expect(resolveState(S(eff), false)).toMatchObject({ mode: 'custom', customToolCount: 1 });
  });

  it('TS-AI-05 inherited, non-enumerable, symbol keys and class instances ⇒ off', () => {
    const inherited: unknown = Object.create({ a: true });
    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, 'a', { value: true, enumerable: false });
    const symbolKeyed = { [Symbol('true')]: true };
    class Tools {
      a = true;
    }
    for (const eff of [inherited, nonEnumerable, symbolKeyed, new Tools(), new Map([['a', true]])]) {
      expect(resolveState(S(eff), false)).toEqual(off());
    }
  });

  it('TS-AI-05 inputs are not mutated', () => {
    const eff = { a: true, b: false };
    const snapshot = Object.freeze(S(Object.freeze(eff), false, Object.freeze({ a: true })));
    expect(() => resolveState(snapshot, false)).not.toThrow();
    expect(eff).toEqual({ a: true, b: false });
  });

  it('TS-AI-06 huge map: 100 000 keys (50 000 true) resolves fast and renders', () => {
    const eff: Record<string, boolean> = {};
    for (let i = 0; i < 100_000; i++) {
      eff[`tool_${i}`] = i % 2 === 0;
    }
    let best = Number.POSITIVE_INFINITY;
    let state = off();
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      state = resolveState(S(eff), false);
      best = Math.min(best, performance.now() - started);
    }
    expect(state).toMatchObject({ mode: 'custom', customToolCount: 50_000 });
    expect(best).toBeLessThan(100);
    expect(present(state).text).toBe('$(filter) Auto-Approve: 50000 tools');
  });

  it('TS-AI-06 deeply nested value (10 000 levels) ⇒ off without stack overflow', () => {
    let deep: unknown = true;
    for (let i = 0; i < 10_000; i++) {
      deep = { a: deep };
    }
    const state = resolveState(S(deep), false);
    expect(state).toEqual(off());
    expect(present(state).text).toBe('$(shield) Auto-Approve: Off');
  });
});

describe('state helpers', () => {
  it.each([
    [{}, true],
    [Object.create(null), true],
    [[], false],
    [null, false],
    [undefined, false],
    ['x', false],
    [1, false],
    [new Date(0), false],
    [Object.create({}), false],
  ])('TS-AI-05 isPlainObject(%j) === %s', (value, expected) => {
    expect(isPlainObject(value)).toBe(expected);
  });

  it('TS-AI-04 countEnabledTools is 0 for non-objects and counts strict true only', () => {
    expect(countEnabledTools(true)).toBe(0);
    expect(countEnabledTools([true, true])).toBe(0);
    expect(countEnabledTools({ a: true, b: 'true', c: 1, d: true })).toBe(2);
  });

  it('TS-QA-31 statesEqual compares each of the four fields', () => {
    const base: AutoApproveState = { mode: 'custom', customToolCount: 2, managed: false, userSettingOn: false };
    expect(statesEqual(base, { ...base })).toBe(true);
    expect(statesEqual(base, { ...base, mode: 'off' })).toBe(false);
    expect(statesEqual(base, { ...base, customToolCount: 3 })).toBe(false);
    expect(statesEqual(base, { ...base, managed: true })).toBe(false);
    expect(statesEqual(base, { ...base, userSettingOn: true })).toBe(false);
  });
});

describe('resolveState — frozen results (§9)', () => {
  it.each([
    ['unsupported', S(true, undefined, true)],
    ['on', S(true, false, true)],
    ['custom', S({ a: true }, false, { a: true })],
    ['off', S(false)],
  ])('TS-AI-02 %s result is frozen and cannot be mutated', (_mode, snapshot) => {
    const r = resolveState(snapshot, false);
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r as { mode: string }).mode = 'on';
    }).toThrow(TypeError);
    expect(resolveState(snapshot, false)).toEqual(r);
  });
});
