/**
 * Runs async operations one at a time, in call order. A rejection is delivered only to the caller whose
 * operation failed; the queue always moves on to the next operation.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    // The tail never rejects, so one failed operation cannot wedge the queue or leak an unhandled rejection.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
