import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Mutex } from '../../src/core/mutex';
import { deferred, flushMicrotasks } from './fakes';
import { fcParams } from './fakes/fc';

type TaskKind = 'resolve' | 'reject' | 'throwSync';

describe('Mutex (serial queue)', () => {
  it('TS-QA-29 runs tasks FIFO with max concurrency 1, even when earlier tasks are slower', async () => {
    const mutex = new Mutex();
    const gates = [deferred<undefined>(), deferred<undefined>(), deferred<undefined>()];
    const started: number[] = [];
    const finished: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const results = gates.map((gate, i) =>
      mutex.run(async () => {
        started.push(i);
        running++;
        maxRunning = Math.max(maxRunning, running);
        await gate.promise;
        running--;
        finished.push(i);
        return i;
      }),
    );
    await flushMicrotasks();
    expect(started).toEqual([0]);
    gates[2]?.resolve(undefined);
    gates[1]?.resolve(undefined);
    await flushMicrotasks();
    expect(started).toEqual([0]);
    gates[0]?.resolve(undefined);
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2]);
    expect(finished).toEqual([0, 1, 2]);
    expect(maxRunning).toBe(1);
  });

  it('TS-QA-29 a rejection or synchronous throw rejects only its own promise and the queue continues', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const a = mutex.run(() => {
      order.push('a');
      return Promise.reject(new Error('a failed'));
    });
    const b = mutex.run((): Promise<string> => {
      order.push('b');
      throw new Error('b threw synchronously');
    });
    const c = mutex.run(() => {
      order.push('c');
      return Promise.resolve('c ok');
    });
    await expect(a).rejects.toThrow('a failed');
    await expect(b).rejects.toThrow('b threw synchronously');
    await expect(c).resolves.toBe('c ok');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('TS-QA-29 does not start a task before run() returns (always asynchronous)', async () => {
    const mutex = new Mutex();
    let ran = false;
    const p = mutex.run(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(false);
    await p;
    expect(ran).toBe(true);
  });

  it('TS-QA-29 property: FIFO, concurrency 1, failures isolated, under random scheduling', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.constantFrom<TaskKind>('resolve', 'reject', 'throwSync'), { minLength: 1, maxLength: 12 }),
        async (s, kinds) => {
          const mutex = new Mutex();
          const started: number[] = [];
          let running = 0;
          let maxRunning = 0;
          const promises = kinds.map((kind, i) =>
            mutex.run(async () => {
              started.push(i);
              running++;
              maxRunning = Math.max(maxRunning, running);
              if (kind === 'throwSync') {
                running--;
                throw new Error(`task ${i}`);
              }
              // A scheduler-controlled delay: fast-check decides when (and in which order) these resolve.
              await s.schedule(Promise.resolve(), `task ${i}`);
              running--;
              if (kind === 'reject') {
                throw new Error(`task ${i}`);
              }
              return i;
            }),
          );
          // waitFor keeps releasing scheduled delays until every queued task has settled.
          const results = await s.waitFor(Promise.allSettled(promises));
          expect(started).toEqual(kinds.map((_, i) => i));
          expect(maxRunning).toBe(1);
          results.forEach((result, i) => {
            if (kinds[i] === 'resolve') {
              expect(result).toEqual({ status: 'fulfilled', value: i });
            } else {
              expect(result.status).toBe('rejected');
            }
          });
        },
      ),
      fcParams(),
    );
  });
});
