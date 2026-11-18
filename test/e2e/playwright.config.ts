import { defineConfig } from '@playwright/test';

// UI end-to-end tests: Playwright `_electron` drives a downloaded VS Code with the packaged VSIX installed into an
// isolated profile (see globalSetup.ts and vscode.ts). One VS Code at a time: tests share the downloaded build.
export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.e2e.ts',
  globalSetup: require.resolve('./globalSetup'),
  globalTeardown: require.resolve('./globalTeardown'),
  outputDir: '../../test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  timeout: 120_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: '../../playwright-report', open: 'never' }]],
});
