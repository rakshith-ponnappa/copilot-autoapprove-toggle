#!/usr/bin/env node
// Live user testing (UAT) sandbox launcher — see docs/UAT.md.
//
//   npm run uat                       build + package, download VS Code, install the VSIX, launch the sandbox
//   npm run uat -- --reset            wipe .uat/ first (fresh profile)
//   npm run uat -- --version 1.104.0  use a specific VS Code (`stable` | `insiders` | x.y.z), default `stable`
//   npm run uat -- --no-launch        prepare everything but do not launch
//
// `--dev [--inspect-port 9333]` is used by F5 ("Run Extension" in .vscode/launch.json): it starts an isolated
// Extension Development Host from source (dist/extension.js) with the extension-host inspector enabled.
//
// Isolation (SPEC §1 rule 2): VS Code is downloaded with @vscode/test-electron (the system `code` CLI is never used),
// and every launch/CLI call gets its own --user-data-dir and --extensions-dir under the project, a temp HOME
// (USERPROFILE on Windows, because VS Code reads ~/.vscode/argv.json regardless of --user-data-dir), --locale=en and
// in-memory secret storage (never the OS keychain). Your real VS Code profile is never read or written.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const VSCODE_CACHE = path.join(ROOT, '.vscode-test');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const UAT_DOC = path.join(ROOT, 'docs', 'UAT.md');

const USAGE = `Usage: node scripts/uat.mjs [options]   (or: npm run uat -- [options])

Options:
  --reset               Delete the sandbox first (fresh profile, no stored acknowledgement)
  --version <v>         VS Code version: stable (default), insiders, or x.y.z (e.g. 1.104.0)
  --no-launch           Build, package, download and install, but do not launch VS Code
  --dev                 Launch an isolated Extension Development Host from source (used by F5)
  --inspect-port <n>    Extension host inspector port for --dev (default 9333)
  -h, --help            Show this help`;

class UsageError extends Error {}

function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        reset: { type: 'boolean', default: false },
        version: { type: 'string', default: 'stable' },
        'no-launch': { type: 'boolean', default: false },
        dev: { type: 'boolean', default: false },
        'inspect-port': { type: 'string', default: '9333' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const version = values.version.trim();
  if (!/^(stable|insiders|\d+\.\d+\.\d+(-insider)?)$/.test(version)) {
    throw new UsageError(`Invalid --version "${values.version}". Use stable, insiders or x.y.z (e.g. 1.104.0).`);
  }
  const inspectPort = Number(values['inspect-port']);
  if (!Number.isInteger(inspectPort) || inspectPort < 1024 || inspectPort > 65535) {
    throw new UsageError(`Invalid --inspect-port "${values['inspect-port']}". Use an integer between 1024 and 65535.`);
  }

  return {
    reset: values.reset,
    version,
    launch: !values['no-launch'],
    dev: values.dev,
    inspectPort,
    help: values.help,
  };
}

/** All sandbox paths live inside the project; nothing here may ever point at the real profile. */
function sandboxFor(dev) {
  const base = dev ? VSCODE_CACHE : path.join(ROOT, '.uat');
  const dirs = dev
    ? {
        userData: path.join(base, 'dev-profile'),
        extensions: path.join(base, 'dev-extensions'),
        home: path.join(base, 'dev-home'),
        workspace: path.join(base, 'dev-workspace'),
      }
    : {
        userData: path.join(base, 'user-data'),
        extensions: path.join(base, 'extensions'),
        home: path.join(base, 'home'),
        workspace: path.join(base, 'workspace'),
      };
  // --reset wipes only what belongs to this sandbox (never the cached VS Code downloads in .vscode-test/).
  const resetTargets = dev ? Object.values(dirs) : [base];
  for (const dir of [...Object.values(dirs), ...resetTargets]) {
    assertInsideProject(dir);
  }
  return { ...dirs, resetTargets };
}

function assertInsideProject(target) {
  const relative = path.relative(ROOT, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use ${target}: sandbox paths must be inside ${ROOT}.`);
  }
}

function rel(target) {
  return path.relative(process.cwd(), target) || '.';
}

/** Arguments shared by every VS Code invocation (CLI and GUI). */
function isolationArgs(sandbox) {
  return [`--user-data-dir=${sandbox.userData}`, `--extensions-dir=${sandbox.extensions}`, '--locale=en'];
}

/**
 * Environment for VS Code processes: temp HOME/USERPROFILE, and none of the variables that would make the child talk
 * to (or behave like) the VS Code instance this script may have been started from.
 */
function isolatedEnv(sandbox) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(VSCODE_|ELECTRON_)/i.test(key) || /^NODE_OPTIONS$/i.test(key)) {
      continue;
    }
    env[key] = value;
  }
  env.HOME = sandbox.home;
  if (IS_WINDOWS) {
    env.USERPROFILE = sandbox.home;
  }
  return env;
}

/** cmd.exe quoting for shell spawns on Windows (needed for npm.cmd / code.cmd). */
function quoteForCmd(arg) {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function run(command, args, { env = process.env, capture = false } = {}) {
  const useShell = IS_WINDOWS && /\.(cmd|bat)$|^npm$/i.test(command);
  const finalCommand = useShell ? quoteForCmd(command) : command;
  const finalArgs = useShell ? args.map(quoteForCmd) : args;
  return new Promise((resolve, reject) => {
    const child = spawn(finalCommand, finalArgs, {
      cwd: ROOT,
      env,
      shell: useShell,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (error) => {
      reject(new Error(`Could not start "${command}": ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const how = signal ? `signal ${signal}` : `exit code ${String(code)}`;
        const output = capture ? `\n${stderr || stdout}`.trimEnd() : '';
        reject(new Error(`"${command} ${args.join(' ')}" failed with ${how}.${output}`));
      }
    });
  });
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return {
    id: `${String(manifest.publisher)}.${String(manifest.name)}`.toLowerCase(),
    version: String(manifest.version),
    engine: String(manifest.engines?.vscode ?? ''),
  };
}

/** `vsce package --out artifacts/` writes a FILE named "artifacts" when the directory does not exist yet. */
function ensureArtifactsDir() {
  if (fs.existsSync(ARTIFACTS) && !fs.statSync(ARTIFACTS).isDirectory()) {
    throw new Error(`${rel(ARTIFACTS)} exists but is not a directory (stale vsce output?). Delete it and retry.`);
  }
  fs.mkdirSync(ARTIFACTS, { recursive: true });
}

function newestVsix() {
  const candidates = fs.existsSync(ARTIFACTS)
    ? fs
        .readdirSync(ARTIFACTS)
        .filter((name) => name.endsWith('.vsix'))
        .map((name) => path.join(ARTIFACTS, name))
        .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  if (candidates.length === 0) {
    throw new Error(`No .vsix found in ${rel(ARTIFACTS)} after "npm run package".`);
  }
  return candidates[0].file;
}

function resetSandbox(sandbox) {
  for (const target of sandbox.resetTargets) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
      throw new Error(
        `Could not delete ${rel(target)} (${error instanceof Error ? error.message : String(error)}). ` +
          'Close the sandbox VS Code window first, then retry.',
        { cause: error },
      );
    }
  }
  console.log(`uat: reset ${sandbox.resetTargets.map(rel).join(', ')}`);
}

function prepareDirs(sandbox, dev) {
  for (const dir of [sandbox.userData, sandbox.extensions, sandbox.home, sandbox.workspace]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const readme = path.join(sandbox.workspace, 'README.md');
  if (!fs.existsSync(readme)) {
    const body = dev
      ? [
          '# Extension Development Host sandbox',
          '',
          'This window runs the extension from source in an isolated profile (`.vscode-test/dev-profile`).',
          'Your real VS Code settings are never touched. Delete `.vscode-test/dev-*` to start fresh.',
        ]
      : [
          '# Copilot Auto-Approve Toggle — UAT sandbox',
          '',
          `Follow the checklist in \`${path.relative(sandbox.workspace, UAT_DOC).split(path.sep).join('/')}\``,
          '(`docs/UAT.md` in the project) and record Pass / Fail / N/A for every check.',
          '',
          'This VS Code is isolated: its user settings are `.uat/user-data/User/settings.json`, its extensions live in',
          '`.uat/extensions`, and HOME points at `.uat/home`. Your real VS Code profile is never touched.',
          '',
          'Reset everything with `npm run uat -- --reset`.',
        ];
    fs.writeFileSync(readme, `${body.join('\n')}\n`);
  }
}

async function downloadVSCode(version) {
  console.log(`uat: resolving VS Code ${version} (cache: ${rel(VSCODE_CACHE)}) …`);
  let executable;
  try {
    executable = await downloadAndUnzipVSCode({ version, cachePath: VSCODE_CACHE });
  } catch (error) {
    throw new Error(
      `Could not download VS Code ${version}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Check the version number and your network connection.',
      { cause: error },
    );
  }
  return resolveExecutable(executable);
}

/**
 * @vscode/test-electron 2.5 assumes the macOS binary is `Contents/MacOS/Electron`; newer VS Code builds ship it as
 * `Contents/MacOS/Code` (or `Code - Insiders`). Fall back to whatever single binary that folder contains.
 */
function resolveExecutable(executable) {
  if (fs.existsSync(executable)) {
    return executable;
  }
  const dir = path.dirname(executable);
  if (process.platform === 'darwin' && fs.existsSync(dir)) {
    const binaries = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
    const preferred = ['Code', 'Code - Insiders', 'Electron'].find((name) => binaries.includes(name));
    const candidate = preferred ?? (binaries.length === 1 ? binaries[0] : undefined);
    if (candidate) {
      return path.join(dir, candidate);
    }
  }
  throw new Error(`Downloaded VS Code executable not found at ${executable}. Try --reset or delete ${rel(dir)}.`);
}

async function installVsix(executable, vsix, sandbox, manifest) {
  // Drop the default --user-data-dir/--extensions-dir that test-electron appends; ours are passed explicitly.
  const [cli] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const env = isolatedEnv(sandbox);
  console.log(`uat: installing ${rel(vsix)} into ${rel(sandbox.extensions)} …`);
  try {
    await run(cli, ['--install-extension', vsix, '--force', ...isolationArgs(sandbox)], { env, capture: true });
  } catch (error) {
    throw new Error(
      `Installing the VSIX failed. If you chose an older --version, VS Code refuses extensions whose ` +
        `engines.vscode (${manifest.engine}) it does not satisfy — that is expected.\n` +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }

  const { stdout } = await run(cli, ['--list-extensions', '--show-versions', ...isolationArgs(sandbox)], {
    env,
    capture: true,
  });
  const expected = `${manifest.id}@${manifest.version}`;
  if (!stdout.toLowerCase().split(/\r?\n/).includes(expected)) {
    throw new Error(`VSIX installed but "${expected}" is not listed in ${rel(sandbox.extensions)}:\n${stdout}`);
  }
  console.log(`uat: installed ${expected}`);
}

/** Flags that keep the sandbox quiet and away from OS-level shared state. */
const QUIET_FLAGS = [
  '--use-inmemory-secretstorage',
  '--disable-telemetry',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
];

function launchDetached(executable, sandbox) {
  const args = [sandbox.workspace, ...isolationArgs(sandbox), ...QUIET_FLAGS];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: sandbox.workspace,
      env: isolatedEnv(sandbox),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', (error) => {
      reject(new Error(`Could not launch VS Code (${executable}): ${error.message}`));
    });
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid);
    });
  });
}

async function runDevHost(executable, sandbox, inspectPort) {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'extension.js'))) {
    await run('npm', ['run', 'compile']);
  }
  const args = [
    sandbox.workspace,
    `--extensionDevelopmentPath=${ROOT}`,
    `--inspect-extensions=${String(inspectPort)}`,
    '--disable-extensions',
    ...isolationArgs(sandbox),
    ...QUIET_FLAGS,
  ];
  const child = spawn(executable, args, { cwd: sandbox.workspace, env: isolatedEnv(sandbox), stdio: 'inherit' });
  console.log(`uat: dev host started (PID ${String(child.pid)}), extension host inspector on port ${inspectPort}`);
  const stop = () => {
    if (child.exitCode === null && child.pid !== undefined) {
      child.kill();
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const code = await new Promise((resolve, reject) => {
    child.once('error', (error) => {
      reject(new Error(`Could not launch VS Code (${executable}): ${error.message}`));
    });
    child.once('exit', (exitCode) => {
      resolve(exitCode ?? 0);
    });
  });
  process.exitCode = code;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const sandbox = sandboxFor(options.dev);
  if (options.reset) {
    resetSandbox(sandbox);
  }
  prepareDirs(sandbox, options.dev);

  if (options.dev) {
    const executable = await downloadVSCode(options.version);
    await runDevHost(executable, sandbox, options.inspectPort);
    return;
  }

  const manifest = readManifest();
  await run('npm', ['run', 'build']);
  ensureArtifactsDir();
  await run('npm', ['run', 'package']);
  const vsix = newestVsix();

  const executable = await downloadVSCode(options.version);
  await installVsix(executable, vsix, sandbox, manifest);

  console.log('');
  console.log(`Sandbox ready (VS Code ${options.version}):`);
  console.log(`  user data   ${rel(sandbox.userData)}`);
  console.log(`  extensions  ${rel(sandbox.extensions)}`);
  console.log(`  HOME        ${rel(sandbox.home)}`);
  console.log(`  workspace   ${rel(sandbox.workspace)}`);

  if (options.launch) {
    const pid = await launchDetached(executable, sandbox);
    console.log(`  launched    VS Code PID ${String(pid)} (close the window, or kill ${String(pid)}, to stop it)`);
  } else {
    console.log('  launch      skipped (--no-launch)');
  }
  console.log('');
  console.log(`Checklist: ${UAT_DOC}`);
  console.log('Reset:     npm run uat -- --reset');
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`uat: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error(`uat: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
