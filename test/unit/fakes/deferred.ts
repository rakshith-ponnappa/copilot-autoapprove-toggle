/** A promise whose settlement the test controls; used instead of real sleeps. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      settled = true;
      resolveFn(value);
    },
    reject(reason: unknown) {
      settled = true;
      rejectFn(reason);
    },
  };
}

/** Lets every already-queued microtask and promise continuation run (several hops deep). */
export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/** Shared, ordered record of calls across fakes, for "X happens before Y" assertions. */
export class CallTrace {
  readonly entries: string[] = [];

  push(entry: string): void {
    this.entries.push(entry);
  }

  indexOf(prefix: string): number {
    return this.entries.findIndex((entry) => entry.startsWith(prefix));
  }
}
