// Paths and process helpers shared by the Playwright global setup, teardown and fixtures. Never imports `vscode`.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..', '..');
export const SANDBOX = join(ROOT, '.vscode-test');
/** Short on purpose: macOS keeps VS Code's IPC socket inside --user-data-dir and rejects paths over 103 chars. */
export const E2E_ROOT = join(SANDBOX, 'e2e');
export const E2E_EXTENSIONS_DIR = join(E2E_ROOT, 'ext');
export const E2E_HOME = join(SANDBOX, 'home', 'e2e');
export const E2E_STATE_FILE = join(E2E_ROOT, 'state.json');
export const ARTIFACTS_DIR = join(ROOT, 'artifacts');

export interface E2eState {
  readonly executablePath: string;
  readonly version: string;
  readonly vsix: string;
}

const requestedVersion = process.env.VSCODE_TEST_VERSION;
export const VSCODE_VERSION = requestedVersion !== undefined && requestedVersion !== '' ? requestedVersion : 'stable';

/**
 * @vscode/test-electron 2.5.x reports `Contents/MacOS/Electron` on macOS, but current builds ship `Contents/MacOS/Code`.
 */
export function fixExecutablePath(reported: string): string {
  if (existsSync(reported)) {
    return reported;
  }
  const renamed = join(dirname(reported), 'Code');
  return existsSync(renamed) ? renamed : reported;
}

export function newestVsix(): string | undefined {
  if (!existsSync(ARTIFACTS_DIR)) {
    return undefined;
  }
  return readdirSync(ARTIFACTS_DIR)
    .filter((name) => name.endsWith('.vsix'))
    .map((name) => join(ARTIFACTS_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/**
 * Environment for every VS Code process we start: temp HOME (+ USERPROFILE on Windows) and none of the parent's
 * VSCODE_* / ELECTRON_* variables (inside a VS Code terminal those would make the CLI talk to the real VS Code).
 */
export function isolatedEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(VSCODE_|ELECTRON_)/i.test(key)) {
      env[key] = value;
    }
  }
  env.HOME = home;
  if (process.platform === 'win32') {
    env.USERPROFILE = home;
  }
  return env;
}
