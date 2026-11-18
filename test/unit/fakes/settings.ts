import { isDeepStrictEqual } from 'node:util';
import type { AutoApproveSnapshot, Disposable, SettingsPort } from '../../../src/core/types';
import type { CallTrace } from './deferred';

/** The English message VS Code throws when a write targets a policy-controlled setting. */
export const POLICY_MESSAGE =
  'Unable to write to User Settings because chat.tools.global.autoApprove is configured in system policy.';

export interface WriteRecord {
  readonly value: unknown;
  /** The value was deep-equal to the stored user value (absent === undefined) when the write was attempted. */
  readonly identity: boolean;
  /** `undefined` when the write succeeded, else the thrown message. */
  readonly error: string | undefined;
}

export interface FakeSettingsOptions {
  readonly targetId?: string;
  /** Initial user (settings.json) value; `undefined` = key absent. */
  readonly user?: unknown;
  readonly supported?: boolean;
  readonly trace?: CallTrace;
}

type Layer = { readonly value: unknown } | undefined;

/**
 * In-memory model of chat.tools.global.autoApprove as the extension API exposes it (SPEC §2):
 * - a policy value is folded into `defaultValue` and wins over everything; every write (identity included) throws.
 * - an `override` models another layer (e.g. remote/application settings) that silently wins: writes succeed,
 *   but `effective` does not follow.
 * - change events fire synchronously *inside* `writeUserValue`, before its promise resolves, like VS Code does for
 *   the current window; identity writes fire nothing.
 */
export class FakeSettings implements SettingsPort {
  /** Mutable: the real adapter recomputes it on each access (e.g. a folder is added to a remote window). */
  targetId: string;
  readonly writes: WriteRecord[] = [];
  /** Parallel to `writes`: the stored user value just before each write attempt. */
  readonly valuesBeforeWrite: unknown[] = [];
  readsCount = 0;
  supported: boolean;
  /** When set, `read()` throws this message. */
  readError: string | undefined;
  /** Called for every write attempt, before it is applied (chaos tests check invariants here). */
  onWriteAttempt: ((value: unknown, identity: boolean) => void) | undefined;
  private user: unknown;
  private policy: Layer;
  private override: Layer;
  /** Overrides only `defaultValue` (e.g. a policy default `true` while another layer reports `false`). */
  private forcedDefault: Layer;
  private readonly failures: (string | Error | undefined)[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly trace: CallTrace | undefined;

  constructor(options: FakeSettingsOptions = {}) {
    this.targetId = options.targetId ?? 'local';
    this.user = clone(options.user);
    this.supported = options.supported ?? true;
    this.trace = options.trace;
  }

  // ---- SettingsPort --------------------------------------------------------------------------------------------

  read(): AutoApproveSnapshot {
    this.readsCount++;
    if (this.readError !== undefined) {
      throw new Error(this.readError);
    }
    const defaultValue = this.supported
      ? this.forcedDefault
        ? this.forcedDefault.value
        : this.policy
          ? this.policy.value
          : false
      : undefined;
    let effective: unknown;
    if (this.policy) {
      effective = this.policy.value;
    } else if (this.override) {
      effective = this.override.value;
    } else {
      effective = this.user === undefined ? defaultValue : this.user;
    }
    return { effective: clone(effective), defaultValue: clone(defaultValue), globalValue: clone(this.user) };
  }

  writeUserValue(value: unknown): Promise<void> {
    const identity = isDeepStrictEqual(value, this.user);
    this.trace?.push(`write:${identity ? 'identity' : 'change'}`);
    this.onWriteAttempt?.(value, identity);
    const failure = this.failures.shift();
    let error: string | undefined;
    if (failure !== undefined) {
      error = typeof failure === 'string' ? failure : failure.message;
    } else if (this.policy) {
      error = POLICY_MESSAGE;
    }
    this.writes.push({ value: clone(value), identity, error });
    this.valuesBeforeWrite.push(clone(this.user));
    if (error !== undefined) {
      return Promise.reject(failure instanceof Error ? failure : new Error(error));
    }
    if (!identity) {
      this.user = clone(value);
      this.fire();
    }
    return Promise.resolve();
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  // ---- test controls -------------------------------------------------------------------------------------------

  /** Queue outcomes for the next writes, in order: a message/Error makes that write throw, `undefined` lets it pass. */
  failWrites(...outcomes: (string | Error | undefined)[]): void {
    this.failures.push(...outcomes);
  }

  failNextWrite(message: string | Error): void {
    this.failWrites(message);
  }

  /** The stored user value (deep copy); `undefined` means the key is absent from settings.json. */
  get userValue(): unknown {
    return clone(this.user);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Writes attempted by the code under test that were not identity writes. */
  get changeWrites(): WriteRecord[] {
    return this.writes.filter((w) => !w.identity);
  }

  /** Hand edit / another window / Settings UI. Fires an event only if the stored value changes. */
  externalSet(value: unknown): void {
    if (isDeepStrictEqual(value, this.user)) {
      return;
    }
    this.user = clone(value);
    this.fire();
  }

  setPolicy(value: unknown, fire = true): void {
    this.policy = { value: clone(value) };
    if (fire) {
      this.fire();
    }
  }

  clearPolicy(fire = true): void {
    this.policy = undefined;
    if (fire) {
      this.fire();
    }
  }

  get hasPolicy(): boolean {
    return this.policy !== undefined;
  }

  setOverride(value: unknown, fire = true): void {
    this.override = { value: clone(value) };
    if (fire) {
      this.fire();
    }
  }

  clearOverride(fire = true): void {
    this.override = undefined;
    if (fire) {
      this.fire();
    }
  }

  get hasOverride(): boolean {
    return this.override !== undefined;
  }

  forceDefault(value: unknown, fire = true): void {
    this.forcedDefault = { value: clone(value) };
    if (fire) {
      this.fire();
    }
  }

  /** Fires a change event (also used when a non-user layer changes). */
  fire(): void {
    this.trace?.push('event');
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
