import type { ConfirmPort } from '../../../src/core/types';
import { type CallTrace, type Deferred, deferred } from './deferred';

/**
 * - `true` / `false`: the user picked Turn On / dismissed.
 * - `reject`: the dialog API threw.
 * - `hold`: the dialog stays open until the test settles `confirm.held[i]`.
 */
export type ConfirmAnswer = boolean | 'reject' | 'hold';

export class FakeConfirm implements ConfirmPort {
  calls = 0;
  /** Deferreds for dialogs opened with the `hold` answer, in call order. */
  readonly held: Deferred<boolean>[] = [];
  private readonly script: ConfirmAnswer[] = [];

  constructor(
    /** Answer used when the script is empty. */
    public fallback: ConfirmAnswer = true,
    private readonly trace?: CallTrace,
  ) {}

  /** Queue answers for the next dialogs, in order. */
  answer(...answers: ConfirmAnswer[]): void {
    this.script.push(...answers);
  }

  confirmEnable(): Promise<boolean> {
    this.calls++;
    this.trace?.push('confirm');
    const next = this.script.shift() ?? this.fallback;
    if (next === 'reject') {
      return Promise.reject(new Error('dialog service unavailable'));
    }
    if (next === 'hold') {
      const d = deferred<boolean>();
      this.held.push(d);
      return d.promise;
    }
    return Promise.resolve(next);
  }

  /** The most recent held dialog. */
  get lastHeld(): Deferred<boolean> {
    const last = this.held.at(-1);
    if (!last) {
      throw new Error('no dialog is being held open');
    }
    return last;
  }
}
