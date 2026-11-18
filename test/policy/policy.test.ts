// Policy suite — Linux CI only (started by test/policy/run.mjs). The CI job writes /etc/vscode/policy.json itself:
//   POLICY_PHASE=canary  {"ChatToolsAutoApprove": true}   proves the policy file is really applied (TS-ADM-01/04)
//   POLICY_PHASE=locked  {"ChatToolsAutoApprove": false}  the real admin scenario (TS-ADM-02/03)
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import type { ExtensionApi, ToggleOutcome } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  readUserSettingsText,
  restoreAllSpies,
  runOutcome,
  sleep,
  spyWindow,
  userSettingsPath,
  waitFor,
} from '../support/harness';

const phase = process.env.POLICY_PHASE;

function assertBlockedManaged(outcome: ToggleOutcome, what: string): void {
  assert.equal(outcome.kind, 'blocked', `${what}: ${JSON.stringify(outcome)}`);
  assert.equal(outcome.reason, 'managed', `${what}: ${JSON.stringify(outcome)}`);
}

describe(`policy (${phase ?? 'POLICY_PHASE unset'})`, () => {
  let api: ExtensionApi;
  let pristine: string;

  before(async () => {
    api = await getApi();
    pristine = readUserSettingsText();
  });

  afterEach(async () => {
    restoreAllSpies();
    if (readUserSettingsText() !== pristine) {
      writeFileSync(userSettingsPath(), pristine);
      await waitFor(() => inspectAutoApprove().globalValue === undefined, 'user settings to reload');
    }
  });

  it('TS-ADM-05 POLICY_PHASE (canary|locked) reached the extension host', () => {
    assert.ok(phase === 'canary' || phase === 'locked', `POLICY_PHASE must be canary or locked, got ${String(phase)}`);
  });

  if (phase === 'canary') {
    it('TS-ADM-01 canary: the policy file is applied (defaultValue true, no user value, state on + managed)', () => {
      const inspected = inspectAutoApprove();
      assert.equal(inspected.defaultValue, true, 'policy folded into defaultValue — /etc/vscode/policy.json is read');
      assert.equal(inspected.globalValue, undefined, 'nothing in user settings');
      assert.equal(inspected.effective, true);
      assert.deepEqual(api.getState(), { mode: 'on', customToolCount: 0, managed: true, userSettingOn: false });
    });

    it('TS-ADM-04 policy forcing true is Managed: enable unchanged, toggle/disable blocked, never a modal', async () => {
      const spy = spyWindow('Turn On');
      assert.equal(api.getState().managed, true, 'managed from the start, no interaction needed');

      const enable = await runOutcome(COMMANDS.enable);
      assert.equal(enable.kind, 'unchanged', 'already on: no probe, no dialog');
      assertBlockedManaged(await runOutcome(COMMANDS.toggle), 'toggle');
      assertBlockedManaged(await runOutcome(COMMANDS.disable), 'disable');

      assert.equal(spy.modals().length, 0, 'the modal confirm was never shown');
      assert.equal(readUserSettingsText(), pristine, 'settings.json byte-identical');
      assert.equal(api.getState().managed, true);
      assert.equal(inspectAutoApprove().effective, true);
    });
  }

  if (phase === 'locked') {
    it('TS-ADM-02 locked: enable is refused by the identity probe without a dialog; nothing written', async () => {
      const inspected = inspectAutoApprove();
      assert.equal(inspected.defaultValue, false, 'a policy false looks like the default');
      assert.equal(inspected.globalValue, undefined);
      const spy = spyWindow('Turn On');

      const enable = await runOutcome(COMMANDS.enable);
      assertBlockedManaged(enable, 'enable');
      const detail = enable.kind === 'blocked' ? enable.detail : undefined;
      assert.match(detail ?? '', /polic/i, 'raw VS Code error passed through as detail (English build)');
      assert.equal(spy.modals().length, 0, 'the modal confirm was never shown');
      const toasts = spy.warnings.filter((call) => !call.modal);
      assert.equal(toasts.length, 1, 'only the non-modal blocked warning');
      assert.deepEqual(toasts[0]?.items, ['Open Setting']);
      assert.equal(api.getState().managed, true, 'state is managed after the refusal');

      assertBlockedManaged(await runOutcome(COMMANDS.toggle), 'toggle');
      assert.equal(spy.modals().length, 0);
      const disable = await runOutcome(COMMANDS.disable);
      assert.equal(disable.kind, 'unchanged', 'nothing to turn off');
      assert.equal(readUserSettingsText(), pristine, 'settings.json byte-identical');
      assert.equal(inspectAutoApprove().effective, false);
    });

    it('TS-ADM-03 locked with a leftover user true: managed + userSettingOn; disable blocked; file unchanged', async () => {
      const withTrue = pristine.replace(/\}\s*$/, ',\n  "chat.tools.global.autoApprove": true\n}\n');
      writeFileSync(userSettingsPath(), withTrue); // a hand edit; the API would refuse this write
      await waitFor(() => inspectAutoApprove().globalValue === true, 'VS Code to load the hand-edited settings.json');
      await waitFor(() => api.getState().userSettingOn, 'state to follow');
      assert.deepEqual(api.getState(), { mode: 'off', customToolCount: 0, managed: true, userSettingOn: true });

      const spy = spyWindow('Turn On');
      assertBlockedManaged(await runOutcome(COMMANDS.disable), 'disable');
      assertBlockedManaged(await runOutcome(COMMANDS.enable), 'enable');
      assert.equal(spy.modals().length, 0);
      await sleep(200);
      assert.equal(readUserSettingsText(), withTrue, 'settings.json unchanged');
    });
  }
});
