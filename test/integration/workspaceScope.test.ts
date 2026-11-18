import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';
import { AUTO_APPROVE_SETTING_ID, CONFIG_CONFIRM_BEFORE_ENABLING, CONFIG_SECTION } from '../../src/constants';
import type { ExtensionApi } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  OFF_STATE,
  readUserSettings,
  runOutcome,
  setUserAutoApprove,
  spyWindow,
  useIntegrationSandbox,
  userDataDir,
} from '../support/harness';

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the integration suite opens the fixture workspace');
  return folder.uri.fsPath;
}

/** sha256 of every file under `dir`, keyed by relative path. */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        out[relative(dir, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
      }
    }
  };
  walk(dir);
  return out;
}

function withoutAutoApprove(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => key !== AUTO_APPROVE_SETTING_ID));
}

describe('workspace scope and footprint (integration)', () => {
  useIntegrationSandbox();
  let api: ExtensionApi;

  before(async () => {
    api = await getApi();
  });

  it('TS-ADM-10 workspace settings cannot turn auto-approve on or weaken the warning', async () => {
    const workspaceSettings = readFileSync(join(workspaceRoot(), '.vscode', 'settings.json'), 'utf8');
    assert.match(workspaceSettings, /"chat\.tools\.global\.autoApprove": true/, 'hostile fixture is in place');
    assert.match(workspaceSettings, /"copilotAutoApproveToggle\.confirmBeforeEnabling": "never"/);

    assert.deepEqual(api.getState(), OFF_STATE);
    assert.equal(inspectAutoApprove().effective, false);
    const confirmMode = vscode.workspace.getConfiguration(CONFIG_SECTION).get(CONFIG_CONFIRM_BEFORE_ENABLING);
    assert.equal(confirmMode, 'firstTime', 'application-scoped setting ignores the workspace value');

    // Behavioural proof: an external enable still asks (and declining leaves it off).
    const spy = spyWindow(undefined);
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'cancelled');
    assert.equal(spy.modals().length, 1);
  });

  it('TS-ADM-11 a full cycle only ever changes chat.tools.global.autoApprove in user settings.json', async () => {
    spyWindow('Turn On');
    const userSettingsBefore = withoutAutoApprove(readUserSettings());
    const workspaceBefore = hashTree(workspaceRoot());
    const userDirBefore = readdirSync(join(userDataDir(), 'User')).sort();

    const check = (step: string): void => {
      assert.deepEqual(withoutAutoApprove(readUserSettings()), userSettingsBefore, `${step}: other user settings`);
      assert.deepEqual(hashTree(workspaceRoot()), workspaceBefore, `${step}: workspace files untouched`);
    };

    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    check('enable');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    check('disable');
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    check('enable again');
    await setUserAutoApprove(undefined);
    check('external disable');

    const created = readdirSync(join(userDataDir(), 'User'))
      .sort()
      .filter((name) => !userDirBefore.includes(name));
    assert.deepEqual(created, [], 'no new files in the profile User folder (keybindings, tasks, snippets…)');
  });
});
