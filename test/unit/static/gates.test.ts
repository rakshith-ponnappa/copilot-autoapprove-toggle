import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { read, ROOT } from './files';

/** Default export of a root config file (dynamic import keeps the ESM configs out of the type-checked graph). */
async function loadConfig(file: string): Promise<unknown> {
  const url = pathToFileURL(join(ROOT, file)).href;
  return ((await import(url)) as { default: unknown }).default;
}

interface CoverageOptions {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly thresholds: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

describe('quality gates (TS-QA-53 / TS-QA-54 / TS-QA-47)', () => {
  it('TS-QA-53 coverage thresholds are ≥ 95% on src/core/** (minus types.ts) and src/ui/presentation.ts', async () => {
    const coverage = ((await loadConfig('vitest.config.mts')) as { test: { coverage: CoverageOptions } }).test.coverage;
    expect(coverage.include).toEqual(['src/**/*.ts']);
    expect(coverage.exclude).toEqual(['src/core/types.ts']);
    expect(Object.keys(coverage.thresholds).sort()).toEqual(['src/core/**/*.ts', 'src/ui/presentation.ts']);
    for (const gated of Object.values(coverage.thresholds)) {
      for (const metric of ['lines', 'branches', 'functions', 'statements']) {
        expect(gated[metric], metric).toBeGreaterThanOrEqual(95);
      }
    }
  });

  it('TS-QA-54 Stryker mutates the pure modules with the Vitest runner and breaks below 80%', async () => {
    const config = (await loadConfig('stryker.config.mjs')) as {
      testRunner: string;
      checkers: string[];
      mutate: string[];
      thresholds: { high: number; low: number; break: number };
      reporters: string[];
    };
    expect(config.testRunner).toBe('vitest');
    expect(config.checkers).toContain('typescript');
    expect(config.mutate).toEqual(['src/core/**/*.ts', '!src/core/types.ts', 'src/ui/presentation.ts']);
    expect(config.thresholds.break).toBeGreaterThanOrEqual(80);
    expect(config.reporters).toEqual(expect.arrayContaining(['html', 'clear-text']));
  });

  it('TS-QA-47 CI integration matrix covers Linux, macOS and Windows on stable plus the 1.104.0 minimum', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/os:\s*\[ubuntu-latest,\s*macos-latest,\s*windows-latest\]/);
    expect(ci).toMatch(/vscode:\s*\[stable\]/);
    expect(ci).toMatch(/-\s*os:\s*ubuntu-latest\s*\n\s*vscode:\s*1\.104\.0/);
    expect(ci).toContain('VSCODE_TEST_VERSION: ${{ matrix.vscode }}');
  });
});
