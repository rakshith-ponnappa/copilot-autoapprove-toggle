import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  OFF_STATE,
  ON_STATE,
  logBarrier,
  runOutcome,
  spyWindow,
  useIntegrationSandbox,
} from '../../support/harness';

describe('empty window (integration, no folder open)', () => {
  useIntegrationSandbox();

  it('TS-USR-12 toggles on and off with no folder open; target is local; no errors logged', async () => {
    assert.equal(vscode.workspace.workspaceFolders, undefined, 'this run opens no folder');
    assert.equal(vscode.env.remoteName, undefined, 'local window ⇒ settings target "local"');
    const api = await getApi();
    const spy = spyWindow('Turn On');

    const on = await runOutcome(COMMANDS.toggle);
    assert.equal(on.kind, 'changed');
    assert.deepEqual(api.getState(), ON_STATE);
    assert.equal(inspectAutoApprove().globalValue, true);

    const off = await runOutcome(COMMANDS.toggle);
    assert.equal(off.kind, 'changed');
    assert.deepEqual(api.getState(), OFF_STATE);
    assert.equal(inspectAutoApprove().globalValue, undefined);

    assert.equal(spy.modals().length, 1);
    const logged = await logBarrier(0);
    assert.match(logged, /Activated in \d+ ms/);
    assert.ok(!/\[(error|warning)\]/i.test(logged), 'no warnings or errors in the extension log');
  });
});
