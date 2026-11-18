import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveState } from '../../src/core/state';
import type { AutoApproveSnapshot, AutoApproveState } from '../../src/core/types';
import { fcParams } from './fakes/fc';

/** Independent oracle written from SPEC §3.1 (deliberately not sharing code with src/core/state.ts). */
function oracle(s: AutoApproveSnapshot, sticky: boolean): AutoApproveState {
  if (s.defaultValue === undefined) {
    return { mode: 'unsupported', customToolCount: 0, managed: false, userSettingOn: false };
  }
  const userSettingOn = s.globalValue === true;
  const managed = (userSettingOn && s.effective !== true) || s.defaultValue === true || sticky;
  if (s.effective === true) {
    return { mode: 'on', customToolCount: 0, managed, userSettingOn };
  }
  let count = 0;
  const e = s.effective;
  if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
    const proto: unknown = Reflect.getPrototypeOf(e);
    if (proto === Object.prototype || proto === null) {
      for (const key of Reflect.ownKeys(e)) {
        const desc = Reflect.getOwnPropertyDescriptor(e, key);
        if (typeof key === 'string' && desc?.enumerable && desc.value === true) {
          count++;
        }
      }
    }
  }
  return count > 0
    ? { mode: 'custom', customToolCount: count, managed, userSettingOn }
    : { mode: 'off', customToolCount: 0, managed, userSettingOn };
}

const toolKey = fc.oneof(
  fc.string(),
  fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'a', 'run_in_terminal'),
);
const toolValue = fc.oneof(fc.constantFrom<unknown>(true, false, 'true', 1, 0, null, {}, []), fc.jsonValue());
/** Maps biased towards per-tool shapes, built with JSON.parse so `__proto__` becomes an own key, as in settings.json. */
const toolMap = fc
  .array(fc.tuple(toolKey, toolValue), { maxLength: 30 })
  .map((entries) => JSON.parse(JSON.stringify(Object.fromEntries(entries))) as unknown);
/** Raw JSON text with duplicate and prototype-like keys, parsed exactly like settings.json content. */
const protoMap = fc
  .array(fc.tuple(toolKey, toolValue), { maxLength: 10 })
  .map(
    (entries) =>
      JSON.parse(`{${entries.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')}}`) as unknown,
  );

const settingValue = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom<unknown>(true, false, undefined, null, 'true', 1, [true], {}) },
  { weight: 3, arbitrary: toolMap },
  { weight: 2, arbitrary: protoMap },
  { weight: 1, arbitrary: fc.jsonValue() },
  { weight: 1, arbitrary: fc.anything() },
);
const defaultValue = fc.oneof(fc.constantFrom<unknown>(undefined, false, true, null), fc.anything());
const snapshot = fc.record({ effective: settingValue, defaultValue, globalValue: settingValue });

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const desc = Reflect.getOwnPropertyDescriptor(value, key);
      if (desc && 'value' in desc) {
        deepFreeze(desc.value as unknown, seen);
      }
    }
    Object.freeze(value);
  }
  return value;
}

describe('resolveState properties', () => {
  it('TS-AI-01 total: never throws, well-formed result for arbitrary input', () => {
    fc.assert(
      fc.property(snapshot, fc.boolean(), (s, sticky) => {
        const r = resolveState(s, sticky);
        expect(['on', 'off', 'custom', 'unsupported']).toContain(r.mode);
        expect(Number.isInteger(r.customToolCount) && r.customToolCount >= 0).toBe(true);
        expect(r.customToolCount > 0).toBe(r.mode === 'custom');
        expect(typeof r.managed).toBe('boolean');
        expect(typeof r.userSettingOn).toBe('boolean');
        if (r.mode === 'unsupported') {
          expect(r).toEqual({ mode: 'unsupported', customToolCount: 0, managed: false, userSettingOn: false });
        }
        expect(Object.keys(r).sort()).toEqual(['customToolCount', 'managed', 'mode', 'userSettingOn']);
        expect(Object.isFrozen(r)).toBe(true);
      }),
      fcParams(),
    );
  });

  it('TS-AI-02 pure: deep-frozen inputs are not mutated and repeated calls agree', () => {
    fc.assert(
      fc.property(
        fc.record({ effective: settingValue, defaultValue, globalValue: settingValue }),
        fc.boolean(),
        (s, sticky) => {
          let before: unknown;
          try {
            before = structuredClone(s);
          } catch {
            fc.pre(false);
          }
          const frozen = deepFreeze(s);
          const a = resolveState(frozen, sticky);
          const b = resolveState(frozen, sticky);
          expect(b).toEqual(a);
          expect(frozen).toEqual(before);
          expect(Object.getPrototypeOf({})).toBe(Object.prototype);
        },
      ),
      fcParams(),
    );
  });

  it('TS-AI-03 matches an independent oracle from §3.1 (maps of true/false/"true"/1/null/{} values)', () => {
    fc.assert(
      fc.property(snapshot, fc.boolean(), (s, sticky) => {
        expect(resolveState(s, sticky)).toEqual(oracle(s, sticky));
      }),
      fcParams({ numRuns: 500 }),
    );
  });

  it('TS-AI-03 custom count equals the number of own `true` values in a JSON-parsed map', () => {
    fc.assert(
      fc.property(fc.dictionary(toolKey, fc.constantFrom<unknown>(true, false, 'true', 1, null)), (dict) => {
        const map = JSON.parse(JSON.stringify(dict)) as Record<string, unknown>;
        const expected = Object.values(map).filter((v) => v === true).length;
        const r = resolveState({ effective: map, defaultValue: false, globalValue: map }, false);
        expect(r.customToolCount).toBe(expected);
        expect(r.mode).toBe(expected > 0 ? 'custom' : 'off');
      }),
      fcParams(),
    );
  });
});

describe('property harness', () => {
  it('TS-AI-01 a failing property reports the FC_SEED/FC_PATH needed to replay it', () => {
    const failing = fc.property(fc.integer(), (n) => n < 5);
    expect(() => {
      fc.assert(failing, fcParams({ numRuns: 50 }));
    }).toThrow(/reproduce with FC_SEED=-?\d+ FC_PATH=\S+\./);
  });
});
