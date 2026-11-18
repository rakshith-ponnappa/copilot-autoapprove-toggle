import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  OFF_STATE,
  readUserSettingsText,
  runOutcome,
  setConfirmMode,
  waitFor,
  spyWindow,
  useIntegrationSandbox,
  userSettingsPath,
} from '../support/harness';

/** Observable marker written into the broken file so tests can wait for VS Code to (re)load it instead of sleeping. */
const SENTINEL = 7;

function sentinel(): unknown {
  return vscode.workspace.getConfiguration('editor').inspect('tabSize')?.globalValue;
}

/** Appends the sentinel and then a JSON syntax error (a property without a value). */
function breakSettings(valid: string): string {
  return valid.replace(/\}\s*$/, `,\n  "editor.tabSize": ${SENTINEL},\n  "editor.fontSize": ,\n}\n`);
}

describe('errors (integration)', () => {
  let api: ExtensionApi;
  let pristine: string;

  before(async () => {
    api = await getApi();
    pristine = readUserSettingsText();
  });

  // Registered before the sandbox hooks so the file is repaired before they write settings again.
  afterEach(async () => {
    if (readUserSettingsText() !== pristine) {
      writeFileSync(userSettingsPath(), pristine);
      await waitFor(() => sentinel() === undefined, 'VS Code to reload the repaired settings.json');
    }
  });

  useIntegrationSandbox();

  it('TS-USR-17 a broken settings.json gives a clear write-failed warning before any modal', async () => {
    const broken = breakSettings(pristine);
    assert.notEqual(broken, pristine);
    writeFileSync(userSettingsPath(), broken);
    await waitFor(() => sentinel() === SENTINEL, 'VS Code to load the broken settings.json');

    const spy = spyWindow('Turn On');
    const outcome = await runOutcome(COMMANDS.enable);

    assert.equal(outcome.kind, 'blocked');
    assert.equal(outcome.reason, 'write-failed');
    const detail = outcome.detail;
    assert.ok(detail && /settings/i.test(detail), `raw VS Code error carried as detail: ${String(detail)}`);
    assert.equal(spy.modals().length, 0, 'the identity probe failed first, so the modal was never shown');
    const toasts = spy.warnings.filter((call) => !call.modal);
    assert.equal(toasts.length, 1, 'one warning notification');
    assert.ok(toasts[0]?.message.includes(detail), "the notification includes VS Code's raw error text");
    assert.deepEqual(toasts[0]?.items, ['Open Setting', 'Show Log']);
    assert.equal(readUserSettingsText(), broken, 'settings.json unchanged');
    assert.deepEqual(api.getState(), OFF_STATE);
  });

  it('TS-USR-18 coalesced status-bar clicks that are blocked show exactly one warning', async () => {
    const spy = spyWindow('Turn On');
    const nonce = api.testing?.statusBarNonce;
    assert.ok(nonce);
    // Preconditions: ack stored, confirm "never" (written while settings.json is still valid).
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    await setConfirmMode('never');
    const valid = readUserSettingsText();
    writeFileSync(userSettingsPath(), breakSettings(valid));
    await waitFor(() => sentinel() === SENTINEL, 'VS Code to load the broken settings.json');
    spy.warnings.length = 0;
    spy.statusMessages.length = 0;

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => runOutcome(COMMANDS.toggle, nonce)));
    assert.ok(outcomes.every((o) => o.kind === 'blocked' && o.reason === 'write-failed'));
    assert.equal(spy.warnings.length, 1, 'one warning for five coalesced clicks');
    assert.equal(spy.modals().length, 0);
    assert.equal(spy.statusMessages.length, 0);
    assert.deepEqual(api.getState(), OFF_STATE);
  });
});
