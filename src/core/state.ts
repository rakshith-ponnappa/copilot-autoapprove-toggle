import type { AutoApproveSnapshot, AutoApproveState } from './types';

/** True for `{}`-style objects (prototype `Object.prototype` or `null`); false for arrays, null, class instances. */
export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Number of own enumerable string keys whose value is strictly `true`; 0 for anything that is not a plain object. */
export function countEnabledTools(value: unknown): number {
  if (!isPlainObject(value)) {
    return 0;
  }
  // Object.entries reads own data properties, so keys like "__proto__" or "constructor" are treated as ordinary tools.
  return Object.entries(value).filter(([, enabled]) => enabled === true).length;
}

/** States are frozen: they are shared with API callers and command results, and must never be mutated. */
export function resolveState(snapshot: AutoApproveSnapshot, stickyManaged: boolean): AutoApproveState {
  return Object.freeze(computeState(snapshot, stickyManaged));
}

function computeState(snapshot: AutoApproveSnapshot, stickyManaged: boolean): AutoApproveState {
  if (snapshot.defaultValue === undefined) {
    return { mode: 'unsupported', customToolCount: 0, managed: false, userSettingOn: false };
  }
  const userSettingOn = snapshot.globalValue === true;
  const effectiveOn = snapshot.effective === true;
  // The schema default is `false`, so a `true` default can only be a policy forcing auto-approve on.
  const managed = (userSettingOn && !effectiveOn) || snapshot.defaultValue === true || stickyManaged;
  if (effectiveOn) {
    return { mode: 'on', customToolCount: 0, managed, userSettingOn };
  }
  const customToolCount = countEnabledTools(snapshot.effective);
  if (customToolCount > 0) {
    return { mode: 'custom', customToolCount, managed, userSettingOn };
  }
  return { mode: 'off', customToolCount: 0, managed, userSettingOn };
}

export function statesEqual(a: AutoApproveState, b: AutoApproveState): boolean {
  return (
    a.mode === b.mode &&
    a.customToolCount === b.customToolCount &&
    a.managed === b.managed &&
    a.userSettingOn === b.userSettingOn
  );
}
