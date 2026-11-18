import { describe, expect, it } from 'vitest';
import { read, stripComments } from './files';

/** Every place that launches VS Code for tests, UAT or F5 debugging. */
const LAUNCHERS = ['.vscode-test.mjs', 'test/e2e/vscode.ts', 'test/e2e/globalSetup.ts', 'scripts/uat.mjs'] as const;

describe('test/UAT harness isolation (TS-ADM-15)', () => {
  it.each(LAUNCHERS)('TS-ADM-15 %s passes --user-data-dir, --extensions-dir and --locale=en', (file) => {
    const source = stripComments(read(file));
    expect(source).toContain('--user-data-dir=');
    expect(source).toContain('--extensions-dir=');
    expect(source).toContain('--locale=en');
  });

  it.each([
    ['.vscode-test.mjs', /HOME:\s*homeDir/, /USERPROFILE:\s*homeDir/],
    ['test/e2e/paths.ts', /env\.HOME\s*=/, /env\.USERPROFILE\s*=/],
    ['scripts/uat.mjs', /env\.HOME\s*=/, /env\.USERPROFILE\s*=/],
  ])('TS-ADM-15 %s overrides HOME (and USERPROFILE on Windows)', (file, home, userProfile) => {
    const source = stripComments(read(file));
    expect(source).toMatch(home);
    expect(source).toMatch(userProfile);
  });

  it('TS-ADM-15 profiles live under the project sandbox (or OS temp for the macOS socket-length fallback)', () => {
    const source = stripComments(read('.vscode-test.mjs'));
    expect(source).toMatch(/const sandbox = join\(root, '\.vscode-test'\)/);
    expect(source).toMatch(/join\(sandbox, 'home', label\)/);
  });

  it.each([...LAUNCHERS, 'test/e2e/globalTeardown.ts', 'test/policy/run.mjs'])(
    'TS-ADM-15 %s never spawns the system `code` CLI or kills by process name',
    (file) => {
      const source = stripComments(read(file));
      expect(source).not.toMatch(
        /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*['"]code(?:\.cmd)?['"]/,
      );
      expect(source).not.toMatch(/\b(?:pkill|killall|taskkill\s+\/IM)\b/);
    },
  );

  it('TS-ADM-15 F5 "Run Extension" uses scripts/uat.mjs --dev, never a plain extensionHost launch', () => {
    const launch = read('.vscode/launch.json');
    expect(launch).not.toMatch(/"type"\s*:\s*"extensionHost"/);
    const json = JSON.parse(stripComments(launch).replace(/,(\s*[}\]])/g, '$1')) as {
      configurations: { name: string; program?: string; args?: string[] }[];
      compounds: { name: string; configurations: string[] }[];
    };
    const run = json.compounds.find((c) => c.name === 'Run Extension');
    expect(run).toBeDefined();
    const launcher = json.configurations.find((c) => run?.configurations.includes(c.name) && c.program);
    expect(launcher?.program).toBe('${workspaceFolder}/scripts/uat.mjs');
    expect(launcher?.args).toContain('--dev');
  });
});
