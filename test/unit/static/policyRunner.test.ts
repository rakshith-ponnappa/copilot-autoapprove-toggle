import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, ROOT } from './files';

describe('policy runner (TS-ADM-05)', () => {
  it('TS-ADM-05 off-CI it prints exactly the SKIPPED line and exits 0 without launching VS Code', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, CI: '', POLICY_PHASE: 'locked' };
    const started = Date.now();
    const result = spawnSync(process.execPath, [join(ROOT, 'test/policy/run.mjs')], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('SKIPPED: policy tests run only in Linux CI\n');
    expect(result.stderr).toBe('');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('TS-ADM-05 the skip guard requires both Linux and CI=true before anything is spawned', () => {
    const source = read('test/policy/run.mjs');
    const guard = source.indexOf("process.platform !== 'linux' || process.env.CI !== 'true'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf('spawnSync('));
  });

  it('TS-ADM-05 CI runs canary then locked and always removes the policy file', () => {
    const ci = read('.github/workflows/ci.yml');
    const canary = ci.indexOf('"ChatToolsAutoApprove": true');
    const locked = ci.indexOf('"ChatToolsAutoApprove": false');
    const cleanup = ci.indexOf('sudo rm -f /etc/vscode/policy.json');
    expect(canary).toBeGreaterThan(-1);
    expect(locked).toBeGreaterThan(canary);
    expect(cleanup).toBeGreaterThan(locked);
    expect(ci).toMatch(/if:\s*always\(\)\s*\n\s*run:\s*sudo rm -f \/etc\/vscode\/policy\.json\s*$/m);
  });
});
