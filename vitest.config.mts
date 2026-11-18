import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Adapter/extension unit tests import 'vscode'; it only exists inside the extension host, so alias a minimal fake.
const vscodeMock = fileURLToPath(new URL('./test/unit/__mocks__/vscode.ts', import.meta.url));

/** TS-QA-53: gated modules (pure logic). Adapters, the status bar and extension.ts are reported for information only. */
const GATED = { lines: 95, branches: 95, functions: 95, statements: 95 };

export default defineConfig({
  resolve: {
    alias: { vscode: vscodeMock },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/core/types.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        'src/core/**/*.ts': GATED,
        'src/ui/presentation.ts': GATED,
      },
    },
  },
});
