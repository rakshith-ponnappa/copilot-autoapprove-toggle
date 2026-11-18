import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import { AUTO_APPROVE_SETTING_ID } from '../../src/constants';
import type { ExtensionApi } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  logBarrier,
  OFF_STATE,
  ON_STATE,
  readExtensionLog,
  readUserSettings,
  runOutcome,
  setConfirmMode,
  setShowStatusBarItem,
  setUserAutoApprove,
  spyWindow,
  useIntegrationSandbox,
} from '../support/harness';

const TURN_ON = 'Turn On';

function nonceOf(api: ExtensionApi): string {
  assert.ok(api.testing, 'ExtensionApi.testing is only exported in ExtensionMode.Test');
  return api.testing.statusBarNonce;
}

/** settings.json must agree with getState() (the setting key is removed, never left as `false`, after a restore). */
function assertFileMatches(api: ExtensionApi): void {
  const settings = readUserSettings();
  if (api.getState().mode === 'on') {
    assert.equal(settings[AUTO_APPROVE_SETTING_ID], true);
  } else {
    assert.ok(!(AUTO_APPROVE_SETTING_ID in settings), 'the key is absent from settings.json');
  }
}

describe('commands (integration)', () => {
  useIntegrationSandbox();
  let api: ExtensionApi;

  before(async () => {
    api = await getApi();
  });

  it('TS-USR-07 palette and keybinding invocations always show the modal, even with ack + confirm "never"', async () => {
    const spy = spyWindow(TURN_ON);
    // Store the acknowledgement first (any accepted turn-on stores it), then turn it off again.
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    await setConfirmMode('never');
    spy.warnings.length = 0;

    const viaPalette = await runOutcome(COMMANDS.enable);
    assert.equal(viaPalette.kind, 'changed');
    assert.equal(spy.modals().length, 1, 'enable from the palette asked once');
    assert.deepEqual(api.getState(), ON_STATE);
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');

    spy.warnings.length = 0;
    const viaKeybinding = await runOutcome(COMMANDS.toggle); // a keybinding sends no arguments
    assert.equal(viaKeybinding.kind, 'changed');
    assert.equal(spy.modals().length, 1, 'toggle from a keybinding asked once');
    assert.deepEqual(api.getState(), ON_STATE);
  });

  it('TS-USR-09 toggle command works both ways and getState() matches settings.json', async () => {
    const spy = spyWindow(TURN_ON);
    const first = await runOutcome(COMMANDS.toggle);
    assert.equal(first.kind, 'changed');
    assert.deepEqual(first.state, ON_STATE);
    assert.deepEqual(api.getState(), ON_STATE);
    assert.equal(inspectAutoApprove().globalValue, true);
    assertFileMatches(api);

    const second = await runOutcome(COMMANDS.toggle);
    assert.equal(second.kind, 'changed');
    assert.deepEqual(api.getState(), OFF_STATE);
    assert.equal(inspectAutoApprove().globalValue, undefined, 'prior value (absent) restored, not false');
    assertFileMatches(api);
    assert.equal(spy.modals().length, 1, 'only the turn-on asked; turning off never asks');
  });

  it('TS-USR-06 status-bar origin (test nonce) honours confirmBeforeEnabling: never ⇒ no modal, always ⇒ modal', async () => {
    const spy = spyWindow(TURN_ON);
    const nonce = nonceOf(api);

    await setConfirmMode('never');
    assert.equal((await runOutcome(COMMANDS.toggle, nonce)).kind, 'changed');
    assert.equal(inspectAutoApprove().globalValue, true);
    assert.equal(spy.modals().length, 0, 'never: no extension dialog');
    assert.equal((await runOutcome(COMMANDS.toggle, nonce)).kind, 'changed');
    assert.equal(inspectAutoApprove().globalValue, undefined);
    assert.equal(spy.modals().length, 0, 'turning off never asks');

    await setConfirmMode('always');
    assert.equal((await runOutcome(COMMANDS.enable, nonce)).kind, 'changed');
    assert.equal(spy.modals().length, 1, 'always: asks on the status-bar turn-on');
    assert.equal((await runOutcome(COMMANDS.disable, nonce)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.enable, nonce)).kind, 'changed');
    assert.equal(spy.modals().length, 2, 'always: asks again on every turn-on');
  });

  it('TS-USR-04 status-bar origin in firstTime mode skips the warning once the risk was acknowledged', async () => {
    const spy = spyWindow(TURN_ON);
    const nonce = nonceOf(api);
    // Acknowledge (an accepted turn-on from any origin stores it), then turn off.
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable, nonce)).kind, 'changed');
    spy.warnings.length = 0;

    assert.equal((await runOutcome(COMMANDS.toggle, nonce)).kind, 'changed');
    assert.deepEqual(api.getState(), ON_STATE);
    assert.equal(spy.modals().length, 0);
  });

  it('TS-USR-11 a per-tool map is preserved: custom(2) → on → exact map restored', async () => {
    const spy = spyWindow(TURN_ON);
    const map = { toolA: true, toolB: true };
    await setUserAutoApprove(map);
    assert.deepEqual(api.getState(), { mode: 'custom', customToolCount: 2, managed: false, userSettingOn: false });

    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.deepEqual(api.getState(), ON_STATE);
    assert.equal(spy.modals().length, 1);

    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    assert.deepEqual(inspectAutoApprove().globalValue, map);
    assert.deepEqual(readUserSettings()[AUTO_APPROVE_SETTING_ID], map);
    assert.deepEqual(api.getState(), { mode: 'custom', customToolCount: 2, managed: false, userSettingOn: false });
  });

  it('TS-USR-11 toggle from custom turns everything on, toggle again restores the map', async () => {
    spyWindow(TURN_ON);
    const map = { toolA: true, toolC: false };
    await setUserAutoApprove(map);
    assert.equal((await runOutcome(COMMANDS.toggle)).kind, 'changed');
    assert.equal(inspectAutoApprove().globalValue, true);
    assert.equal((await runOutcome(COMMANDS.toggle)).kind, 'changed');
    assert.deepEqual(inspectAutoApprove().globalValue, map);
  });

  it('TS-USR-15 feedback is quiet: changed/unchanged ⇒ one 3 s status message, cancelled ⇒ nothing', async () => {
    const spy = spyWindow(TURN_ON);
    assert.equal((await runOutcome(COMMANDS.toggle)).kind, 'changed');
    assert.equal(spy.statusMessages.length, 1);
    const [first] = spy.statusMessages;
    assert.ok(first);
    assert.equal(first.timeout, 3000);
    assert.match(first.text, /on/i);

    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'unchanged');
    assert.equal(spy.statusMessages.length, 2);
    assert.equal(spy.statusMessages[1]?.timeout, 3000);
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    assert.equal(spy.statusMessages.length, 3);

    spy.answer = undefined;
    const before = spy.warnings.length;
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'cancelled');
    assert.equal(spy.statusMessages.length, 3, 'cancel shows no status message');
    assert.equal(spy.warnings.length, before + 1, 'only the declined modal itself');
    assert.equal(spy.modals().length, spy.warnings.length, 'no non-modal warning toast at all');
    assert.equal(spy.infos.length, 0, 'never an information toast');
    assert.equal(spy.errors.length, 0);
  });

  it('TS-AI-13 rapid toggles coalesce: five concurrent toggles = one change, one modal, one feedback', async () => {
    const spy = spyWindow(TURN_ON);
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => runOutcome(COMMANDS.toggle)));
    assert.deepEqual(
      outcomes.map((o) => o.kind),
      ['changed', 'changed', 'changed', 'changed', 'changed'],
    );
    assert.ok(
      outcomes.every((o) => o.state.mode === 'on'),
      'all callers see the single resulting state',
    );
    assert.equal(spy.modals().length, 1, 'one dialog');
    assert.equal(spy.statusMessages.length, 1, 'feedback shown once for the coalesced toggle');
    assert.equal(inspectAutoApprove().globalValue, true);
    assert.deepEqual(api.getState(), ON_STATE);
  });

  it('TS-USR-18 double and quintuple status-bar clicks: one state change, exactly one status message', async () => {
    const spy = spyWindow(TURN_ON);
    const nonce = nonceOf(api);
    // Preconditions: ack stored, confirm "never".
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    await setConfirmMode('never');

    for (const clicks of [2, 5]) {
      spy.warnings.length = 0;
      spy.statusMessages.length = 0;
      let writes = 0;
      const listener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(AUTO_APPROVE_SETTING_ID)) {
          writes += 1;
        }
      });
      try {
        const expected = api.getState().mode === 'on' ? 'off' : 'on';
        const outcomes = await Promise.all(Array.from({ length: clicks }, () => runOutcome(COMMANDS.toggle, nonce)));
        assert.ok(
          outcomes.every((o) => o.kind === 'changed' && o.state.mode === expected),
          `${clicks} clicks: one coalesced toggle to ${expected}`,
        );
        assert.equal(writes, 1, `${clicks} clicks: exactly one settings change`);
        assert.equal(spy.statusMessages.length, 1, `${clicks} clicks: exactly one status bar message`);
        assert.equal(spy.warnings.length, 0, `${clicks} clicks: no dialog or warning`);
      } finally {
        listener.dispose();
      }
    }
  });

  it('TS-USR-16 Open Setting and Show Log run without errors', async () => {
    const before = readExtensionLog();
    await vscode.commands.executeCommand(COMMANDS.openSetting);
    await vscode.commands.executeCommand(COMMANDS.showLog);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const logged = await logBarrier(before.length);
    assert.ok(!/\[error\]/i.test(logged), 'no error lines logged');
  });

  it('TS-USR-14 showStatusBarItem can be switched live without errors or state changes', async () => {
    const before = readExtensionLog();
    await setShowStatusBarItem(false);
    await setShowStatusBarItem(true);
    await setShowStatusBarItem(undefined);
    assert.deepEqual(api.getState(), OFF_STATE);
    const logged = await logBarrier(before.length);
    assert.ok(!/\[error\]/i.test(logged), 'no error lines logged');
  });
});
