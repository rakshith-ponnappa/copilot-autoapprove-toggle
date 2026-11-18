// Stryker mutation testing for the pure modules (TS-QA-54). Run with `npm run test:mutation`.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  mutate: ['src/core/**/*.ts', '!src/core/types.ts', 'src/ui/presentation.ts'],
  coverageAnalysis: 'perTest',
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  tempDirName: '.stryker-tmp',
  concurrency: 4,
  timeoutMS: 20000,
  cleanTempDir: true,
  // Large or irrelevant folders (downloaded VS Code builds contain sockets that cannot be copied into the sandbox).
  ignorePatterns: [
    '.vscode-test',
    '.uat',
    'artifacts',
    'playwright-report',
    'out',
    'coverage',
    'reports',
    'dist',
    '*.log',
  ],
};

export default config;
