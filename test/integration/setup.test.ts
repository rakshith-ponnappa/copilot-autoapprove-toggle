import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import { AUTO_APPROVE_KEY, AUTO_APPROVE_SECTION } from '../../src/constants';
import {
  COMMANDS,
  describeValue,
  getApi,
  inspectAutoApprove,
  machinePolicyReason,
  OFF_STATE,
  useIntegrationSandbox,
} from '../support/harness';

describe('setup guard (integration)', () => {
  useIntegrationSandbox();

  it('TS-ADM-06 a machine policy (simulated) is detected and produces a clear skip message', () => {
    for (const defaultValue of [true, { someTool: true }, null, undefined, 'true']) {
      const reason = machinePolicyReason({ defaultValue });
      assert.ok(reason, `defaultValue ${describeValue(defaultValue)} is treated as managed`);
      assert.match(reason, /^SKIPPED: machine policy detected/);
    }
    assert.equal(machinePolicyReason({ defaultValue: false }), undefined, 'schema default false = unmanaged');
  });

  it('TS-ADM-06 this machine is unmanaged (otherwise the suite would have been skipped before this test)', async () => {
    assert.equal(machinePolicyReason(inspectAutoApprove()), undefined);
    assert.deepEqual((await getApi()).getState(), OFF_STATE);
  });

  it(`TS-ADM-14 VS Code ${vscode.version} satisfies engines ^1.104.0 and registers the setting`, async () => {
    const extension = vscode.extensions.all.find((e) => e.id.toLowerCase().includes('copilot-autoapprove-toggle'));
    const engine = (extension?.packageJSON as { engines?: { vscode?: string } } | undefined)?.engines?.vscode;
    assert.equal(engine, '^1.104.0');
    const [major = 0, minor = 0] = vscode.version.split('.').map(Number);
    assert.ok(major > 1 || (major === 1 && minor >= 104), `VS Code ${vscode.version} >= 1.104.0`);
    const inspected = vscode.workspace.getConfiguration(AUTO_APPROVE_SECTION).inspect(AUTO_APPROVE_KEY);
    assert.equal(inspected?.defaultValue, false, `${AUTO_APPROVE_SECTION}.${AUTO_APPROVE_KEY} is registered`);
    assert.ok((await vscode.commands.getCommands(true)).includes(COMMANDS.toggle));
  });
});
