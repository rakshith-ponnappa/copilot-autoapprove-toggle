// Last line of defence against orphans: any process still running with an e2e profile path is killed by PID.
import { execFileSync } from 'node:child_process';
import { E2E_ROOT } from './paths';

export function findLeftoverPids(): number[] {
  if (process.platform === 'win32') {
    return [];
  }
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => line.includes(E2E_ROOT))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

export default function globalTeardown(): void {
  const pids = findLeftoverPids();
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  if (pids.length > 0) {
    console.warn(`[e2e] killed ${pids.length} leftover VS Code process(es) by PID: ${pids.join(', ')}`);
  }
}
