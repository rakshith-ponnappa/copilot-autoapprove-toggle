// Downloads VS Code (cached in .vscode-test/) and installs the packaged VSIX into an isolated extensions dir.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import {
  E2E_EXTENSIONS_DIR,
  E2E_HOME,
  E2E_ROOT,
  E2E_STATE_FILE,
  type E2eState,
  fixExecutablePath,
  isolatedEnv,
  newestVsix,
  VSCODE_VERSION,
} from './paths';

export default async function globalSetup(): Promise<void> {
  const vsix = newestVsix();
  if (!vsix) {
    throw new Error('No VSIX in artifacts/. Run `npm run package` first (pretest:e2e does this).');
  }

  const executablePath = fixExecutablePath(await downloadAndUnzipVSCode(VSCODE_VERSION));
  rmSync(E2E_ROOT, { recursive: true, force: true });
  rmSync(E2E_HOME, { recursive: true, force: true });
  mkdirSync(E2E_EXTENSIONS_DIR, { recursive: true });
  mkdirSync(E2E_HOME, { recursive: true });

  const cli = resolveCliPathFromVSCodeExecutablePath(executablePath);
  const installUserData = join(E2E_ROOT, 'install-ud');
  const args = [
    `--extensions-dir=${E2E_EXTENSIONS_DIR}`,
    `--user-data-dir=${installUserData}`,
    '--locale=en',
    '--install-extension',
    vsix,
    '--force',
  ];
  const shell = process.platform === 'win32';
  const result = spawnSync(shell ? `"${cli}"` : cli, args, {
    encoding: 'utf8',
    env: isolatedEnv(E2E_HOME),
    shell,
    timeout: 180_000,
  });
  if (result.status !== 0) {
    throw new Error(`Installing ${vsix} failed (${String(result.status)}):\n${result.stdout}\n${result.stderr}`);
  }
  console.log(`[e2e] VS Code ${VSCODE_VERSION}: ${executablePath}`);
  console.log(`[e2e] installed ${vsix} into ${E2E_EXTENSIONS_DIR}`);

  const state: E2eState = { executablePath, version: VSCODE_VERSION, vsix };
  writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2));
}
