import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { AUTO_APPROVE_SETTING_ID, COMMANDS, CONTEXT_KEY_MODE, OUTPUT_CHANNEL_NAME } from '../../../src/constants';
import type { ExtensionApi, ToggleOutcome } from '../../../src/core/types';
import { activate, deactivate } from '../../../src/extension';
import {
  ConfigurationTarget,
  ExtensionMode,
  type FakeCommand,
  type FakeOutputChannel,
  type FakeStatusBarItem,
  mock,
  SET_CONTEXT,
  window,
} from '../__mocks__/vscode';
import { ACK_KEY, FakeStorage, flushMicrotasks, LOCAL_STASH, stashKeyFor } from '../fakes';

const CONFIRM_KEY = 'copilotAutoApproveToggle.confirmBeforeEnabling';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const POLICY_ERROR =
  'Unable to write to User Settings because chat.tools.global.autoApprove is configured in system policy.';
const BLOCKED_TEXT = {
  unsupported: 'Auto-approve is not available in this VS Code version (VS Code 1.104 or later is required).',
  managed: "Auto-approve is controlled by your organization's policy.",
  writeFailed: 'Could not change the auto-approve setting.',
  verifyFailed:
    "The setting was saved, but auto-approve didn't change. Another settings layer, such as an organization policy, controls it.",
};

interface Env {
  /** User value; `undefined` = absent. */
  readonly user?: unknown;
  readonly supported?: boolean;
  readonly policy?: { readonly value: unknown };
  readonly mode?: ExtensionMode;
  readonly confirm?: 'firstTime' | 'always' | 'never';
  readonly acknowledged?: boolean;
  readonly storage?: FakeStorage;
}

interface Activated {
  readonly api: ExtensionApi;
  readonly context: { readonly subscriptions: { dispose(): unknown }[]; readonly globalState: FakeStorage };
  readonly item: FakeStatusBarItem;
  readonly channel: FakeOutputChannel;
  readonly storage: FakeStorage;
}

async function activateWith(env: Env = {}): Promise<Activated> {
  const setting = mock.setting(AUTO_APPROVE_SETTING_ID);
  if (env.supported !== false) {
    setting.defaultValue = false;
  }
  if (env.user !== undefined) {
    setting.globalValue = env.user;
  }
  if (env.policy) {
    setting.policyValue = env.policy;
  }
  if (env.confirm) {
    mock.setting(CONFIRM_KEY).globalValue = env.confirm;
  }
  const storage = env.storage ?? new FakeStorage();
  if (env.acknowledged) {
    storage.seed(ACK_KEY, true);
  }
  const context = {
    subscriptions: [] as { dispose(): unknown }[],
    globalState: storage,
    extensionMode: env.mode ?? ExtensionMode.Production,
  };
  const api = await activate(context as unknown as vscodeTypes.ExtensionContext);
  const item = mock.state.statusBarItems.at(-1);
  const channel = mock.state.outputChannels.at(-1);
  if (!item || !channel) {
    throw new Error('activate() did not create the status bar item and output channel');
  }
  return { api, context, item, channel, storage };
}

const nonceOf = (item: FakeStatusBarItem): unknown => (item.command as FakeCommand).arguments?.[0];
const lastContextKey = (): unknown => mock.contextKeyValues(CONTEXT_KEY_MODE).at(-1);
const modalWarnings = () => mock.state.warnings.filter((w) => (w.options as { modal?: boolean } | undefined)?.modal);
const toastWarnings = () => mock.state.warnings.filter((w) => w.options === undefined);
const userValue = (): unknown => mock.setting(AUTO_APPROVE_SETTING_ID).globalValue;
const autoApproveUpdates = () => mock.state.updates.filter((u) => u.key === 'autoApprove');

async function settle(): Promise<void> {
  await flushMicrotasks();
  await new Promise((resolve) => setImmediate(resolve));
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
let activated: Activated[] = [];

beforeEach(() => {
  mock.reset();
  unhandled = [];
  activated = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  await settle();
  for (const a of activated) {
    for (const d of a.context.subscriptions) {
      d.dispose();
    }
  }
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

async function start(env: Env = {}): Promise<Activated> {
  const a = await activateWith(env);
  activated.push(a);
  return a;
}

// ---- API surface -----------------------------------------------------------------------------------------------

describe('ExtensionApi (TS-QA-55)', () => {
  it.each([
    ['Production', ExtensionMode.Production],
    ['Development', ExtensionMode.Development],
  ])('TS-QA-55 %s mode exports exactly { getState }, frozen, nonce unreachable', async (_name, mode) => {
    const { api, item } = await start({ mode });
    expect(Object.keys(api)).toEqual(['getState']);
    expect(Object.isFrozen(api)).toBe(true);
    expect('testing' in api).toBe(false);
    expect(JSON.stringify(api)).not.toContain(String(nonceOf(item)));
    expect(api.getState()).toEqual({ mode: 'off', customToolCount: 0, managed: false, userSettingOn: false });
  });

  it('TS-QA-55 Test mode adds a frozen testing.statusBarNonce equal to the status bar command argument', async () => {
    const { api, item } = await start({ mode: ExtensionMode.Test });
    expect(Object.keys(api).sort()).toEqual(['getState', 'testing']);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.testing)).toBe(true);
    expect(api.testing?.statusBarNonce).toMatch(UUID);
    expect(api.testing?.statusBarNonce).toBe(nonceOf(item));
  });

  it('TS-QA-55 getState() follows the current state and returns a frozen object that cannot be mutated', async () => {
    const { api } = await start({ confirm: 'never', acknowledged: true });
    const before = api.getState();
    expect(Object.isFrozen(before)).toBe(true);
    expect(() => {
      (before as { mode: string }).mode = 'on';
    }).toThrow(TypeError);
    expect(api.getState().mode).toBe('off');
    mock.setting(AUTO_APPROVE_SETTING_ID).globalValue = true;
    mock.fireConfigChange(AUTO_APPROVE_SETTING_ID);
    expect(api.getState()).toMatchObject({ mode: 'on', userSettingOn: true });
  });

  it('TS-QA-44 nonce is a UUID that differs per activation and never reaches logs or context keys', async () => {
    const first = await start({ confirm: 'never', acknowledged: true });
    await mock.invoke(COMMANDS.toggle, nonceOf(first.item));
    const nonce1 = String(nonceOf(first.item));
    for (const d of first.context.subscriptions) {
      d.dispose();
    }
    activated = [];
    const second = await start();
    const nonce2 = String(nonceOf(second.item));
    expect(nonce1).toMatch(UUID);
    expect(nonce2).toMatch(UUID);
    expect(nonce1).not.toBe(nonce2);
    const logs = [...first.channel.lines, ...second.channel.lines].map((l) => l.message).join('\n');
    expect(logs).not.toContain(nonce1);
    expect(logs).not.toContain(nonce2);
    expect(JSON.stringify(mock.state.executed.filter((c) => c.id === SET_CONTEXT))).not.toContain(nonce1);
  });

  it('TS-QA-45 deactivate() is a no-op; disposing subscriptions unregisters commands and disposes the UI', async () => {
    const a = await start();
    expect(deactivate).not.toThrow();
    expect([...mock.state.commands.keys()].sort()).toEqual(Object.values(COMMANDS).sort());
    for (const d of a.context.subscriptions) {
      d.dispose();
    }
    activated = [];
    expect(mock.state.commands.size).toBe(0);
    expect(a.item.disposed).toBe(true);
    expect(a.channel.disposed).toBe(true);
    expect(mock.state.configEmitter.listenerCount).toBe(0);
  });

  it('TS-QA-51 activation logs its duration and initial state to the extension output channel', async () => {
    const { channel } = await start({ user: { a: true } });
    expect(channel.name).toBe(OUTPUT_CHANNEL_NAME);
    expect(channel.lines.map((l) => l.message)).toContainEqual(
      expect.stringMatching(/^Activated in \d+ ms \(state: custom\)\.$/),
    );
  });
});

// ---- origin ----------------------------------------------------------------------------------------------------

describe('command origin (TS-QA-45 / TS-AI-18)', () => {
  it('TS-QA-45 status bar click (nonce arg) with confirmBeforeEnabling=never ⇒ statusBar origin, no dialog', async () => {
    const { item } = await start({ confirm: 'never' });
    const outcome = (await mock.invoke(COMMANDS.toggle, nonceOf(item))) as ToggleOutcome;
    expect(outcome.kind).toBe('changed');
    expect(modalWarnings()).toHaveLength(0);
    expect(userValue()).toBe(true);
  });

  it.each([
    ['no argument', []],
    ['"statusBar"', ['statusBar']],
    ['{ origin: "statusBar" }', [{ origin: 'statusBar' }]],
    ['a random UUID', [randomUUID()]],
    ['empty string', ['']],
    ['null', [null]],
  ])('TS-AI-18 toggle with %s ⇒ external origin: the risk warning is always shown', async (_name, args) => {
    await start({ confirm: 'never', acknowledged: true });
    const outcome = (await mock.invoke(COMMANDS.toggle, ...args)) as ToggleOutcome;
    expect(modalWarnings()).toHaveLength(1);
    expect(outcome.kind).toBe('cancelled');
    expect(userValue()).toBeUndefined();
  });

  it('TS-AI-18 the nonce in a later argument position is not accepted', async () => {
    const { item } = await start({ confirm: 'never', acknowledged: true });
    await mock.invoke(COMMANDS.enable, undefined, nonceOf(item));
    expect(modalWarnings()).toHaveLength(1);
  });

  it('TS-USR-07 palette enable with the user accepting "Turn On" ⇒ changed', async () => {
    await start({ confirm: 'never', acknowledged: true });
    mock.state.warningAnswers.push('Turn On');
    const outcome = (await mock.invoke(COMMANDS.enable)) as ToggleOutcome;
    expect(outcome.kind).toBe('changed');
    expect(userValue()).toBe(true);
  });

  it('TS-QA-24 disable command never shows the risk warning', async () => {
    await start({ user: true });
    const outcome = (await mock.invoke(COMMANDS.disable)) as ToggleOutcome;
    expect(outcome.kind).toBe('changed');
    expect(modalWarnings()).toHaveLength(0);
    expect(userValue()).toBe(false);
  });
});

// ---- feedback --------------------------------------------------------------------------------------------------

describe('result UI (TS-QA-45 / TS-USR-15 / TS-USR-18)', () => {
  it('TS-USR-15 changed ⇒ one status bar message with a 3000 ms timeout and no toast', async () => {
    const { item } = await start({ confirm: 'never' });
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    await settle();
    expect(mock.state.statusMessages).toEqual([
      { text: '$(check) Auto-approve is now on for all tools.', timeout: 3000 },
    ]);
    expect(mock.state.warnings).toHaveLength(0);
  });

  it('TS-USR-15 unchanged ⇒ quiet status message', async () => {
    await start({ user: false });
    await mock.invoke(COMMANDS.disable);
    expect(mock.state.statusMessages).toEqual([{ text: 'No change: auto-approve is off.', timeout: 3000 }]);
  });

  it('TS-USR-15 cancelled ⇒ silent', async () => {
    await start();
    await mock.invoke(COMMANDS.enable);
    await settle();
    expect(mock.state.statusMessages).toHaveLength(0);
    expect(toastWarnings()).toHaveLength(0);
  });

  it.each([2, 5])(
    'TS-USR-18 %i rapid status bar toggles ⇒ one state change and exactly one status message',
    async (clicks) => {
      const { item, api } = await start({ confirm: 'never', acknowledged: true });
      const results = Array.from({ length: clicks }, () => mock.invoke(COMMANDS.toggle, nonceOf(item)));
      const outcomes = (await Promise.all(results)) as ToggleOutcome[];
      await settle();
      expect(new Set(outcomes).size).toBe(1);
      expect(outcomes[0]?.kind).toBe('changed');
      expect(api.getState().mode).toBe('on');
      expect(autoApproveUpdates().filter((u) => u.value === true)).toHaveLength(1);
      expect(mock.state.statusMessages).toHaveLength(1);
      expect(mock.contextKeyValues(CONTEXT_KEY_MODE)).toEqual(['off', 'on']);
    },
  );

  it('TS-USR-18 rapid toggles with a failing write ⇒ exactly one warning', async () => {
    const { item } = await start({ confirm: 'never', acknowledged: true });
    mock.state.nextUpdateError = new Error('EACCES: permission denied');
    const outcomes = (await Promise.all([
      mock.invoke(COMMANDS.toggle, nonceOf(item)),
      mock.invoke(COMMANDS.toggle, nonceOf(item)),
    ])) as ToggleOutcome[];
    await settle();
    expect(outcomes[0]).toBe(outcomes[1]);
    expect(outcomes[0]).toMatchObject({ kind: 'blocked', reason: 'write-failed' });
    expect(toastWarnings()).toHaveLength(1);
    expect(mock.state.statusMessages).toHaveLength(0);
  });

  it('TS-QA-28 a new toggle after the first settles shows its own feedback', async () => {
    const { item } = await start({ confirm: 'never', acknowledged: true });
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    await settle();
    expect(mock.state.statusMessages.map((m) => m.text)).toEqual([
      '$(check) Auto-approve is now on for all tools.',
      '$(check) Auto-approve is now off.',
    ]);
  });

  it('TS-QA-45 write-failed ⇒ warning "<base> <raw detail>" with Open Setting + Show Log; Show Log opens the channel', async () => {
    const { item, channel } = await start({ confirm: 'never' });
    mock.state.nextUpdateError = new Error('EACCES: permission denied');
    mock.state.warningAnswers.push('Show Log');
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    await settle();
    expect(toastWarnings()).toEqual([
      {
        message: `${BLOCKED_TEXT.writeFailed} EACCES: permission denied`,
        options: undefined,
        items: ['Open Setting', 'Show Log'],
      },
    ]);
    expect(channel.shown).toBe(1);
  });

  it('TS-QA-45 managed (policy write rejected) ⇒ warning with Open Setting only; picking it opens the setting', async () => {
    await start({ user: true });
    mock.state.nextUpdateError = new Error(POLICY_ERROR);
    mock.state.warningAnswers.push('Open Setting');
    await mock.invoke(COMMANDS.disable);
    await settle();
    expect(toastWarnings()).toEqual([
      { message: `${BLOCKED_TEXT.managed} ${POLICY_ERROR}`, options: undefined, items: ['Open Setting'] },
    ]);
    expect(mock.state.executed).toContainEqual({
      id: 'workbench.action.openSettings',
      args: [AUTO_APPROVE_SETTING_ID],
    });
  });

  it('TS-QA-45 policy-locked enable (guard) ⇒ base managed message with no detail and no dialog', async () => {
    await start({ policy: { value: false }, user: true });
    await mock.invoke(COMMANDS.enable);
    await settle();
    expect(modalWarnings()).toHaveLength(0);
    expect(toastWarnings().map((w) => w.message)).toEqual([BLOCKED_TEXT.managed]);
    expect(autoApproveUpdates()).toHaveLength(0);
  });

  it('TS-QA-45 verify-failed (another layer wins) ⇒ base message only, with Show Log', async () => {
    const { item } = await start({ confirm: 'never' });
    mock.setting(AUTO_APPROVE_SETTING_ID).workspaceValue = false;
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    await settle();
    expect(toastWarnings()).toEqual([
      { message: BLOCKED_TEXT.verifyFailed, options: undefined, items: ['Open Setting', 'Show Log'] },
    ]);
  });

  it('TS-QA-45 dismissing the warning does nothing; a failing warning API is logged, not thrown', async () => {
    const { channel } = await start({ supported: false });
    await mock.invoke(COMMANDS.enable);
    await settle();
    expect(channel.shown).toBe(0);
    expect(mock.state.executed.filter((c) => c.id === 'workbench.action.openSettings')).toHaveLength(0);
    mock.state.warningAnswers.push(new Error('notifications unavailable'));
    await mock.invoke(COMMANDS.enable);
    await settle();
    expect(channel.lines).toContainEqual({
      level: 'error',
      message: 'Could not show the warning: notifications unavailable',
    });
  });
});

// ---- other commands --------------------------------------------------------------------------------------------

describe('openSetting / showLog (TS-QA-45 / TS-USR-16)', () => {
  it('TS-USR-16 openSetting runs workbench.action.openSettings with the setting id', async () => {
    await start();
    await mock.invoke(COMMANDS.openSetting);
    expect(mock.state.executed).toContainEqual({
      id: 'workbench.action.openSettings',
      args: [AUTO_APPROVE_SETTING_ID],
    });
  });

  it('TS-QA-45 openSetting failure is logged and the handler resolves', async () => {
    const { channel } = await start();
    mock.state.executeErrors.set('workbench.action.openSettings', new Error('no settings editor'));
    await expect(mock.invoke(COMMANDS.openSetting)).resolves.toBeUndefined();
    expect(channel.lines).toContainEqual({ level: 'error', message: 'Could not open the setting: no settings editor' });
  });

  it('TS-USR-16 showLog reveals the output channel', async () => {
    const { channel } = await start();
    await mock.invoke(COMMANDS.showLog);
    expect(channel.shown).toBe(1);
  });
});

describe('handlers never throw (TS-QA-45)', () => {
  it.each([COMMANDS.toggle, COMMANDS.enable, COMMANDS.disable])(
    'TS-QA-45 %s resolves undefined and logs when feedback rendering throws',
    async (command) => {
      const { channel, item } = await start({ user: false, confirm: 'never' });
      vi.spyOn(window, 'setStatusBarMessage').mockImplementation(() => {
        throw new Error('render failed');
      });
      vi.spyOn(window, 'showWarningMessage').mockImplementation(() => {
        throw new Error('render failed');
      });
      await expect(mock.invoke(command, nonceOf(item))).resolves.toBeUndefined();
      const name = command.split('.')[1];
      expect(channel.lines).toContainEqual({ level: 'error', message: `${name} command failed: render failed` });
    },
  );

  it.each([COMMANDS.toggle, COMMANDS.enable, COMMANDS.disable])(
    'TS-QA-34 %s with unreadable settings ⇒ blocked warning, no throw',
    async (command) => {
      await start({ user: true });
      mock.state.readError = new Error('settings.json is not valid JSON');
      const outcome = (await mock.invoke(command)) as ToggleOutcome | undefined;
      await settle();
      expect(outcome?.kind).toBe('blocked');
      expect(toastWarnings()).toHaveLength(1);
    },
  );
});

// ---- context key -----------------------------------------------------------------------------------------------

describe('context key (TS-QA-45)', () => {
  it.each<[string, Env, string]>([
    ['off', {}, 'off'],
    ['on', { user: true }, 'on'],
    ['custom', { user: { a: true, b: false } }, 'custom'],
    ['unsupported', { supported: false, user: true }, 'unsupported'],
    ['managed (policy false, user true)', { user: true, policy: { value: false } }, 'managed'],
    ['managed beats on (policy true)', { policy: { value: true } }, 'managed'],
  ])('TS-QA-45 %s ⇒ %s', async (_name, env, expected) => {
    await start(env);
    expect(mock.contextKeyValues(CONTEXT_KEY_MODE)).toEqual([expected]);
  });

  it('TS-QA-45 context key and status bar follow external changes', async () => {
    const { item } = await start();
    mock.setting(AUTO_APPROVE_SETTING_ID).globalValue = { x: true };
    mock.fireConfigChange(AUTO_APPROVE_SETTING_ID);
    expect(lastContextKey()).toBe('custom');
    expect(item.text).toBe('$(filter) Auto-Approve: 1 tool');
  });

  it('TS-QA-48 setContext is only ever called with the extension mode key', async () => {
    const { item } = await start({ confirm: 'never' });
    await mock.invoke(COMMANDS.toggle, nonceOf(item));
    const keys = new Set(mock.state.executed.filter((c) => c.id === SET_CONTEXT).map((c) => c.args[0]));
    expect([...keys]).toEqual([CONTEXT_KEY_MODE]);
  });

  it('TS-QA-45 a failing setContext is logged, never thrown', async () => {
    mock.state.executeErrors.set(SET_CONTEXT, new Error('context service gone'));
    const { channel } = await start();
    await settle();
    expect(channel.lines).toContainEqual({
      level: 'error',
      message: 'Could not update the context key: context service gone',
    });
  });
});

// ---- unsupported -----------------------------------------------------------------------------------------------

describe('unsupported build (TS-ADM-13)', () => {
  it('TS-ADM-13 N/A item → Open Setting, context key unsupported, every toggle command warns and writes nothing', async () => {
    const { item, api } = await start({ supported: false });
    expect(item.text).toBe('$(circle-slash) Auto-Approve: N/A');
    expect((item.command as FakeCommand).command).toBe(COMMANDS.openSetting);
    expect(lastContextKey()).toBe('unsupported');
    for (const command of [COMMANDS.toggle, COMMANDS.enable, COMMANDS.disable]) {
      const outcome = (await mock.invoke(command)) as ToggleOutcome;
      expect(outcome).toMatchObject({ kind: 'blocked', reason: 'unsupported' });
    }
    await settle();
    expect(toastWarnings()).toHaveLength(3);
    for (const w of toastWarnings()) {
      expect(w).toEqual({ message: BLOCKED_TEXT.unsupported, options: undefined, items: ['Open Setting'] });
    }
    expect(modalWarnings()).toHaveLength(0);
    expect(mock.state.updates).toHaveLength(0);
    expect(api.getState().mode).toBe('unsupported');
    await mock.invoke(COMMANDS.openSetting);
    expect(mock.state.executed).toContainEqual({
      id: 'workbench.action.openSettings',
      args: [AUTO_APPROVE_SETTING_ID],
    });
  });
});

// ---- remote ----------------------------------------------------------------------------------------------------

describe('remote window (TS-QA-56)', () => {
  it('TS-QA-56 stash lands only at the remote key; the local stash is untouched; disable restores', async () => {
    const storage = new FakeStorage();
    const localStash = { v: 1, target: 'local', value: 'local-prior' };
    storage.seed(LOCAL_STASH, localStash);
    mock.state.remoteName = 'ssh-remote';
    mock.state.workspaceFolders = [{ uri: { authority: 'ssh-remote+devbox' } }];
    const remoteKey = stashKeyFor('remote:ssh-remote:ssh-remote+devbox');

    await start({ storage, user: false });
    mock.state.warningAnswers.push('Turn On');
    expect(((await mock.invoke(COMMANDS.enable)) as ToggleOutcome).kind).toBe('changed');
    const detail = (modalWarnings()[0]?.options as { detail: string }).detail;
    expect(detail).toContain('in every workspace on this machine (in a remote window: on that remote machine)');
    expect(storage.peek(remoteKey)).toEqual({ v: 1, target: 'remote:ssh-remote:ssh-remote+devbox', value: false });
    expect(storage.peek(LOCAL_STASH)).toEqual(localStash);

    expect(((await mock.invoke(COMMANDS.disable)) as ToggleOutcome).kind).toBe('changed');
    expect(userValue()).toBe(false);
    expect(storage.peek(remoteKey)).toBeUndefined();
    expect(storage.peek(LOCAL_STASH)).toEqual(localStash);
    expect(storage.updates.map((u) => u.key).filter((k) => k !== ACK_KEY)).toEqual([remoteKey, remoteKey]);
    expect(mock.state.updates.every((u) => u.target === ConfigurationTarget.Global)).toBe(true);
  });
});
