import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  OFF_STATE,
  ON_STATE,
  readExtensionLog,
  runOutcome,
  setUserAutoApprove,
  sleep,
  spyWindow,
  useIntegrationSandbox,
  waitFor,
} from '../support/harness';

describe('external settings changes (integration)', () => {
  useIntegrationSandbox();
  let api: ExtensionApi;

  before(async () => {
    api = await getApi();
  });

  it('TS-USR-13 follows edits made elsewhere: true → 1-tool map → removed', async () => {
    await setUserAutoApprove(true);
    assert.deepEqual(api.getState(), ON_STATE, 'state follows within the same event');

    await setUserAutoApprove({ someTool: true, otherTool: false });
    assert.deepEqual(api.getState(), { mode: 'custom', customToolCount: 1, managed: false, userSettingOn: false });

    await setUserAutoApprove(undefined);
    assert.deepEqual(api.getState(), OFF_STATE);
  });

  it('TS-USR-13 an external turn-off clears the stash: a later disable does not resurrect the old map', async () => {
    const spy = spyWindow('Turn On');
    const map = { toolA: true };
    await setUserAutoApprove(map);
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed'); // stashes the map
    // Another window/hand edit turns it off (removes the key) — the stash is now stale.
    await setUserAutoApprove(undefined);
    assert.deepEqual(api.getState(), OFF_STATE);
    // Turn on again from a clean slate, then off: must restore "absent", not the stale map.
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    const inspected = vscode.workspace.getConfiguration('chat.tools.global').inspect('autoApprove');
    assert.equal(inspected?.globalValue, undefined, 'stale stash was cleared by the external change');
    assert.equal(spy.modals().length, 2);
  });

  it('TS-QA-52 50 unrelated settings changes cause no recompute, no log lines and no state events', async () => {
    const before = api.getState();
    await sleep(200); // let any trailing log writes from earlier tests land
    const logBefore = readExtensionLog();
    const editor = vscode.workspace.getConfiguration('editor');
    try {
      for (let i = 0; i < 50; i++) {
        await editor.update('fontSize', 10 + (i % 10), vscode.ConfigurationTarget.Global);
      }
    } finally {
      await editor.update('fontSize', undefined, vscode.ConfigurationTarget.Global);
    }
    await sleep(500);
    assert.strictEqual(api.getState(), before, 'same state object: nothing was recomputed and replaced');
    assert.equal(readExtensionLog(), logBefore, 'no log lines');
  });

  it('TS-USR-13 rapid external flips settle on the final value', async () => {
    for (const value of [true, undefined, true, { a: true, b: true }, undefined, true]) {
      await setUserAutoApprove(value);
    }
    await waitFor(() => api.getState().mode === 'on', 'state on');
    assert.deepEqual(api.getState(), ON_STATE);
  });
});
