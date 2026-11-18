// @vscode/test-cli configuration for the integration and policy suites (SPEC §1 rule 2, §4).
//
// Every VS Code instance launched from here is isolated from the developer's real VS Code:
//   - its own --user-data-dir and --extensions-dir under .vscode-test/p/<short>/ (wiped on every run),
//   - a temp HOME (and USERPROFILE on Windows) under .vscode-test/home/<label>/, because VS Code reads and creates
//     ~/.vscode/argv.json regardless of --user-data-dir,
//   - --locale=en and --disable-extensions (the extension under development still loads).
// VS Code downloads are cached in .vscode-test/ (the @vscode/test-electron default when run from the project root).
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = dirname(fileURLToPath(import.meta.url));
const sandbox = join(root, '.vscode-test');
const version = process.env.VSCODE_TEST_VERSION || 'stable';
const fixtureWorkspace = join(root, 'test', 'support', 'fixtures', 'workspace');

/** User settings every isolated profile starts with. Keeps the window quiet and dialogs inside the window. */
const SEED_USER_SETTINGS = {
  'window.dialogStyle': 'custom',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off',
};

/**
 * Creates a fresh, isolated profile for one label (`short` keeps the macOS IPC socket path short) and returns the launch arguments and environment for it.
 * Wiping the profile makes every run start like a first install (no stored acknowledgement, no stash).
 */
function isolatedProfile(label, short) {
  const profileDir = join(profilesRoot, short);
  const userDataDir = join(profileDir, 'ud');
  const extensionsDir = join(profileDir, 'ext');
  const homeDir = join(sandbox, 'home', label);
  for (const dir of [profileDir, homeDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [join(userDataDir, 'User'), extensionsDir, homeDir]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(userDataDir, 'User', 'settings.json'), `${JSON.stringify(SEED_USER_SETTINGS, null, 2)}\n`);
  return {
    launchArgs: [
      // Chromium flag unknown to VS Code's argv parser: it would swallow a following positional argument (test-cli
      // appends the workspace folder last), so it must come first, followed only by `--` options.
      ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-extensions',
      '--locale=en',
      '--disable-telemetry',
      '--use-inmemory-secretstorage',
    ],
    env: {
      // Drop inherited VSCODE_* variables (e.g. when run from a VS Code terminal) so nothing talks to a real instance.
      // @vscode/test-cli re-adds its own VSCODE_TEST_OPTIONS afterwards; Node omits `undefined` values when spawning.
      ...Object.fromEntries(
        Object.keys(process.env)
          .filter((key) => /^VSCODE_/i.test(key))
          .map((key) => [key, undefined]),
      ),
      VSCODE_PORTABLE: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
      HOME: homeDir,
      ...(process.platform === 'win32' ? { USERPROFILE: homeDir } : {}),
      // Lets the suites find the isolated settings.json and logs without guessing.
      AAT_USER_DATA_DIR: userDataDir,
      AAT_TEST_LABEL: label,
    },
  };
}

/**
 * @vscode/test-electron 2.5.x resolves the macOS executable as `Contents/MacOS/Electron`, but current VS Code builds
 * ship `Contents/MacOS/Code` (spawn ENOENT). Download (or reuse the cached copy) ourselves and pass the real path.
 */
async function resolveExecutable() {
  const reported = await downloadAndUnzipVSCode(version);
  if (existsSync(reported)) {
    return reported;
  }
  const renamed = join(dirname(reported), 'Code');
  return existsSync(renamed) ? renamed : reported;
}

const useInstallation = { fromPath: await resolveExecutable() };

/**
 * On macOS VS Code puts its IPC socket (`<version>-main.sock`) inside --user-data-dir and refuses paths longer than
 * 103 characters, so profiles live in a short `.vscode-test/p/` folder, or in the OS temp dir if even that is too long.
 * (Linux uses $XDG_RUNTIME_DIR and Windows named pipes, so only macOS is affected.)
 */
const profilesRoot = (() => {
  const local = join(sandbox, 'p');
  const longest = join(local, 'empty', 'ud', '1.146-main.sock');
  return process.platform === 'darwin' && longest.length > 103
    ? join(realpathSync(tmpdir()), 'aat-vscode-test')
    : local;
})();

// failZero: a run where no test executed (e.g. env not propagated, files not found) is a failure, never a pass.
const mocha = { ui: 'bdd', timeout: 20_000, color: true, failZero: true };

export default defineConfig([
  {
    label: 'integration',
    version,
    files: 'out/test/integration/*.test.js',
    workspaceFolder: fixtureWorkspace,
    mocha,
    useInstallation,
    ...isolatedProfile('integration', 'int'),
  },
  {
    // TS-USR-12: same harness, no folder open. Runs as part of `npm run test:integration`.
    label: 'integration-empty-window',
    version,
    files: 'out/test/integration/emptyWindow/**/*.test.js',
    mocha,
    useInstallation,
    ...isolatedProfile('integration-empty-window', 'empty'),
  },
  {
    // Linux CI only; started through test/policy/run.mjs, which refuses to run anywhere else.
    label: 'policy',
    version,
    files: 'out/test/policy/**/*.test.js',
    workspaceFolder: fixtureWorkspace,
    mocha,
    useInstallation,
    ...isolatedProfile('policy', 'pol'),
  },
]);
