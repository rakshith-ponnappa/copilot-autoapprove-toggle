import fc, { type Parameters as FcParameters, type Plugin } from 'fast-check';

/** Default fixed seed so every local run is reproducible; override with FC_SEED to replay a reported failure. */
export const DEFAULT_FC_SEED = 20261118;

let announced = false;

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * fast-check parameters shared by every property test: fixed seed (FC_SEED), ≥ 200 runs locally and FC_NUM_RUNS in
 * CI, and the seed + counterexample path printed on failure (fast-check includes them in the thrown message).
 */
export function fcParams<T = unknown>(overrides: FcParameters<T> = {}): FcParameters<T> {
  const seed = envInt('FC_SEED') ?? DEFAULT_FC_SEED;
  const numRuns = envInt('FC_NUM_RUNS') ?? overrides.numRuns ?? 200;
  const path = process.env.FC_PATH;
  if (!announced) {
    announced = true;
    // Written straight to stdout: Vitest buffers console output per test and may not show it for passing tests.
    process.stdout.write(
      `[fast-check] FC_SEED=${String(seed)} FC_NUM_RUNS=${String(numRuns)}${path ? ` FC_PATH=${path}` : ''}\n`,
    );
  }
  return {
    verbose: fc.VerbosityLevel.Verbose,
    ...overrides,
    ...(path ? { path } : {}),
    seed,
    numRuns,
    plugins: [...(overrides.plugins ?? []), reproPlugin<T>()],
  };
}

/** Rethrows a failure with the exact env vars that replay it. */
function reproPlugin<T>(): Plugin<T> {
  return () => ({
    onAllRunsComplete: (details) => {
      if (details.failed) {
        throw new Error(
          `Property failed — reproduce with FC_SEED=${String(details.seed)} ` +
            `FC_PATH=${String(details.counterexamplePath)}.\n` +
            `Counterexample: ${JSON.stringify(details.counterexample, replacer)}\n` +
            `Error: ${details.errorInstance instanceof Error ? details.errorInstance.message : String(details.errorInstance)}`,
        );
      }
    },
  });
}

function replacer(_key: string, value: unknown): unknown {
  if (value === undefined) {
    return '<undefined>';
  }
  if (typeof value === 'function') {
    return '<function>';
  }
  if (typeof value === 'symbol' || typeof value === 'bigint') {
    return String(value);
  }
  return value;
}
