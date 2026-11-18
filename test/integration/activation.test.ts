import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import { EXTENSION_ID } from '../../src/constants';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  OFF_STATE,
  runOutcome,
  spyWindow,
  useIntegrationSandbox,
  waitForLog,
} from '../support/harness';

describe('activation and wiring (integration)', () => {
  useIntegrationSandbox();

  it('TS-QA-45 activates on startup and exports a frozen read-only API (getState + test-mode nonce only)', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const api = await getApi();
    assert.ok(extension.isActive);
    // `testing` exists only because the host runs in ExtensionMode.Test (SPEC §9); production exports { getState }.
    assert.deepEqual(Object.keys(api).sort(), ['getState', 'testing']);
    assert.ok(Object.isFrozen(api), 'the exported API object is frozen');
    assert.ok(api.testing && Object.isFrozen(api.testing));
    assert.match(api.testing.statusBarNonce, /^[0-9a-f-]{36}$/);
    assert.deepEqual(api.getState(), OFF_STATE);
    assert.equal(inspectAutoApprove().globalValue, undefined, 'fresh isolated profile has no user value');
  });

  it('TS-QA-45 registers all five commands', async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const command of Object.values(COMMANDS)) {
      assert.ok(all.has(command), `${command} is registered`);
    }
  });

  it('TS-QA-45 contributes palette when-clauses keyed on copilotAutoApproveToggle.mode', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const menus = (extension?.packageJSON as { contributes: { menus: { commandPalette: unknown } } }).contributes.menus
      .commandPalette;
    assert.deepEqual(menus, [
      {
        command: COMMANDS.enable,
        when: 'copilotAutoApproveToggle.mode != on && copilotAutoApproveToggle.mode != unsupported',
      },
      { command: COMMANDS.disable, when: 'copilotAutoApproveToggle.mode == on' },
    ]);
  });

  it("TS-USR-07 harness check: a window stub installed by the test reaches the extension's modal confirm", async () => {
    // Shared API object => the extension's confirm adapter calls our stub instead of opening a real dialog.
    const spy = spyWindow(undefined);
    const outcome = await runOutcome(COMMANDS.enable);
    spy.restore();
    assert.equal(outcome.kind, 'cancelled');
    assert.equal(spy.modals().length, 1, 'the modal confirm went through the stub');
    assert.equal(inspectAutoApprove().globalValue, undefined, 'nothing written after cancel');
  });

  it('TS-QA-51 activation logs its duration (reported; hard ceiling 250 ms)', async () => {
    await getApi();
    const log = await waitForLog(/Activated in (\d+) ms/);
    const ms = Number(/Activated in (\d+) ms/.exec(log)?.[1]);
    // Timing on shared runners is noisy: report it, and only fail on a clear regression.
    console.log(`      activation took ${ms} ms on ${process.platform}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(`::notice title=Activation cost::${process.platform}: ${ms} ms`);
    }
    assert.ok(ms <= 250, `activation took ${ms} ms (ceiling 250 ms)`);
  });
});
