#!/usr/bin/env node
// `npm run test:policy` entry point (TS-ADM-05).
//
// Policy tests need a machine-wide policy file (/etc/vscode/policy.json) that only a disposable Linux CI runner may
// own; macOS/Windows builds always read native policy (MDM/registry), which tests must never touch. Anywhere else this
// prints a loud SKIPPED line and exits 0 WITHOUT downloading or launching VS Code — never a silent pass.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_MESSAGE = 'SKIPPED: policy tests run only in Linux CI';

if (process.platform !== 'linux' || process.env.CI !== 'true') {
  console.log(SKIP_MESSAGE);
  process.exit(0);
}

const phase = process.env.POLICY_PHASE;
if (phase !== 'canary' && phase !== 'locked') {
  console.error(`POLICY_PHASE must be "canary" or "locked" (got ${JSON.stringify(phase)}).`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs');
console.log(`Running policy suite, phase ${phase}.`);
const result = spawnSync(process.execPath, [cli, '--label', 'policy', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
