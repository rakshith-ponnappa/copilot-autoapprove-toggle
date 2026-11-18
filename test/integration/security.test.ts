import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { AutoApproveState, ExtensionApi } from '../../src/core/types';
import {
  COMMANDS,
  getApi,
  inspectAutoApprove,
  OFF_STATE,
  readUserSettingsText,
  runOutcome,
  setConfirmMode,
  setUserAutoApprove,
  spyWindow,
  useIntegrationSandbox,
} from '../support/harness';

const FORGED_ORIGINS: readonly [string, unknown[]][] = [
  ['no argument', []],
  ["'statusBar'", ['statusBar']],
  ["{ origin: 'statusBar' }", [{ origin: 'statusBar' }]],
  ['a random UUID', [randomUUID()]],
  ["''", ['']],
  ['null', [null]],
];

describe('security: forged callers (integration)', () => {
  useIntegrationSandbox();
  let api: ExtensionApi;

  before(async () => {
    api = await getApi();
  });

  it('TS-AI-18 forged origins never skip the modal (ack stored, confirm "never", modal declined)', async () => {
    const spy = spyWindow('Turn On');
    // Precondition: acknowledgement stored.
    assert.equal((await runOutcome(COMMANDS.enable)).kind, 'changed');
    assert.equal((await runOutcome(COMMANDS.disable)).kind, 'changed');
    await setConfirmMode('never');
    spy.answer = undefined;
    const settingsBefore = readUserSettingsText();

    for (const command of [COMMANDS.toggle, COMMANDS.enable]) {
      for (const [label, args] of FORGED_ORIGINS) {
        spy.warnings.length = 0;
        const outcome = await runOutcome(command, ...args);
        assert.equal(outcome.kind, 'cancelled', `${command} with ${label}`);
        assert.equal(spy.modals().length, 1, `${command} with ${label} showed the modal`);
        assert.equal(inspectAutoApprove().globalValue, undefined, `${command} with ${label} wrote nothing`);
      }
    }
    assert.equal(readUserSettingsText(), settingsBefore, 'settings.json byte-identical');
    assert.deepEqual(api.getState(), OFF_STATE);
  });

  it('TS-AI-18 the API is read-only: only getState() (+ test-mode nonce); mutating a returned state has no effect', async () => {
    assert.deepEqual(Object.keys(api).sort(), ['getState', 'testing']);
    assert.throws(() => {
      (api as unknown as Record<string, unknown>).getState = () => undefined;
    }, TypeError);

    const state = api.getState() as { -readonly [K in keyof AutoApproveState]: AutoApproveState[K] };
    let afterMutation: AutoApproveState;
    try {
      try {
        state.mode = 'on';
        state.managed = true;
        state.customToolCount = 99;
      } catch {
        // A frozen state object is an acceptable way to be immutable.
      }
      afterMutation = { ...api.getState() };
    } finally {
      // If the mutation leaked into the extension, force a recompute so later tests start from a real state.
      await setUserAutoApprove(true);
      await setUserAutoApprove(undefined);
    }
    assert.deepEqual(afterMutation, OFF_STATE, 'later reads are unaffected by mutating an earlier result');
  });
});
