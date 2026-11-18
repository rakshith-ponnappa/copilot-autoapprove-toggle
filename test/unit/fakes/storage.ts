import type { StoragePort } from '../../../src/core/types';

export interface UpdateRecord {
  readonly key: string;
  readonly value: unknown;
  /** `undefined` when the update succeeded, else the thrown message. */
  readonly error: string | undefined;
}

type FailureMatcher = (key: string, value: unknown) => boolean;

interface Failure {
  readonly matches: FailureMatcher;
  readonly message: string;
  /** Throw synchronously instead of returning a rejected thenable. */
  readonly sync: boolean;
}

/**
 * Map-backed model of `ExtensionContext.globalState` (a Memento): values are JSON-like copies, and writing
 * `undefined` deletes the key. Failures can be injected per update, optionally filtered by key.
 */
export class FakeStorage implements StoragePort {
  readonly data = new Map<string, unknown>();
  readonly updates: UpdateRecord[] = [];
  readonly gets: string[] = [];
  /** When set, `get()` throws this message. */
  getError: string | undefined;
  private readonly failures: Failure[] = [];

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.data.set(key, structuredClone(value));
    }
  }

  get(key: string): unknown {
    this.gets.push(key);
    if (this.getError !== undefined) {
      throw new Error(this.getError);
    }
    const value = this.data.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  update(key: string, value: unknown): PromiseLike<void> {
    const index = this.failures.findIndex((f) => f.matches(key, value));
    if (index >= 0) {
      const [failure] = this.failures.splice(index, 1);
      if (failure) {
        this.updates.push({ key, value, error: failure.message });
        if (failure.sync) {
          throw new Error(failure.message);
        }
        return Promise.reject(new Error(failure.message));
      }
    }
    this.updates.push({ key, value, error: undefined });
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, structuredClone(value));
    }
    return Promise.resolve();
  }

  /** The next update whose key/value matches (any by default) fails once. */
  failNextUpdate(message: string, matches: FailureMatcher = () => true, sync = false): void {
    this.failures.push({ matches, message, sync });
  }

  /** Stored value without recording a `get` (deep copy). */
  peek(key: string): unknown {
    const value = this.data.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** Seeds a raw value without recording an update. */
  seed(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  updatesFor(key: string): UpdateRecord[] {
    return this.updates.filter((u) => u.key === key);
  }
}
