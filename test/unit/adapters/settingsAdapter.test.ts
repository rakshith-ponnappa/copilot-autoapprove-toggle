import { beforeEach, describe, expect, it } from 'vitest';
import { computeTargetId, VsCodeSettingsAdapter } from '../../../src/adapters/settingsAdapter';
import { AUTO_APPROVE_SETTING_ID } from '../../../src/constants';
import { ConfigurationTarget, mock } from '../__mocks__/vscode';

beforeEach(() => {
  mock.reset();
});

describe('computeTargetId / targetId (§9: recomputed on each access)', () => {
  it.each([
    [undefined, undefined, 'local'],
    ['', [{ uri: { authority: 'x' } }], 'local'],
    ['wsl', [{ uri: { authority: 'wsl+Ubuntu' } }], 'remote:wsl:wsl+Ubuntu'],
    ['ssh-remote', undefined, 'remote:ssh-remote:'],
    ['ssh-remote', [], 'remote:ssh-remote:'],
    [
      'ssh-remote',
      [{ uri: { authority: 'ssh-remote+host' } }, { uri: { authority: 'other' } }],
      'remote:ssh-remote:ssh-remote+host',
    ],
  ])('TS-ADM-08 remoteName=%j folders=%j ⇒ %s', (remoteName, folders, expected) => {
    mock.state.remoteName = remoteName;
    mock.state.workspaceFolders = folders;
    expect(computeTargetId()).toBe(expected);
    expect(new VsCodeSettingsAdapter().targetId).toBe(expected);
  });

  it('TS-QA-56 a folder added to an empty remote window changes targetId between two reads', () => {
    mock.state.remoteName = 'ssh-remote';
    const adapter = new VsCodeSettingsAdapter();
    expect(adapter.targetId).toBe('remote:ssh-remote:');
    mock.state.workspaceFolders = [{ uri: { authority: 'ssh-remote+devbox' } }];
    expect(adapter.targetId).toBe('remote:ssh-remote:ssh-remote+devbox');
  });

  it('TS-ADM-08 local and remote windows produce distinct target ids', () => {
    const local = new VsCodeSettingsAdapter().targetId;
    mock.state.remoteName = 'wsl';
    mock.state.workspaceFolders = [{ uri: { authority: 'wsl+Ubuntu' } }];
    expect(new VsCodeSettingsAdapter().targetId).not.toBe(local);
  });
});

describe('VsCodeSettingsAdapter (TS-QA-42)', () => {
  it('TS-QA-42 read() maps get/inspect to the snapshot and uses a fresh configuration object per read', () => {
    const s = mock.setting(AUTO_APPROVE_SETTING_ID);
    s.defaultValue = false;
    s.globalValue = { a: true };
    const adapter = new VsCodeSettingsAdapter();
    expect(adapter.read()).toEqual({ effective: { a: true }, defaultValue: false, globalValue: { a: true } });
    s.globalValue = true;
    expect(adapter.read()).toEqual({ effective: true, defaultValue: false, globalValue: true });
    expect(mock.state.getConfigurationCalls).toEqual(['chat.tools.global', 'chat.tools.global']);
  });

  it('TS-QA-42 policy value is folded into defaultValue and wins as the effective value', () => {
    const s = mock.setting(AUTO_APPROVE_SETTING_ID);
    s.defaultValue = false;
    s.globalValue = true;
    s.policyValue = { value: false };
    expect(new VsCodeSettingsAdapter().read()).toEqual({ effective: false, defaultValue: false, globalValue: true });
  });

  it('TS-ADM-13 unregistered setting ⇒ defaultValue undefined (unsupported build)', () => {
    expect(new VsCodeSettingsAdapter().read()).toEqual({
      effective: undefined,
      defaultValue: undefined,
      globalValue: undefined,
    });
  });

  it.each([true, false, undefined, { a: true }])(
    'TS-QA-42 writeUserValue(%j) ⇒ update("autoApprove", value, ConfigurationTarget.Global)',
    async (value) => {
      mock.setting(AUTO_APPROVE_SETTING_ID).defaultValue = false;
      await new VsCodeSettingsAdapter().writeUserValue(value);
      expect(mock.state.updates).toEqual([
        { section: 'chat.tools.global', key: 'autoApprove', value, target: ConfigurationTarget.Global },
      ]);
    },
  );

  it('TS-QA-42 write errors propagate unchanged (the controller classifies them)', async () => {
    const error = new Error('Unable to write to User Settings because of system policy.');
    mock.state.nextUpdateError = error;
    await expect(new VsCodeSettingsAdapter().writeUserValue(true)).rejects.toBe(error);
  });

  it('TS-QA-42 onDidChange fires only for events affecting chat.tools.global.autoApprove; dispose unsubscribes', () => {
    const adapter = new VsCodeSettingsAdapter();
    let calls = 0;
    const sub = adapter.onDidChange(() => {
      calls++;
    });
    mock.fireConfigChange('editor.fontSize');
    mock.fireConfigChange('chat.tools.global.other');
    mock.fireConfigChange('copilotAutoApproveToggle.showStatusBarItem');
    expect(calls).toBe(0);
    mock.fireConfigChange(AUTO_APPROVE_SETTING_ID);
    expect(calls).toBe(1);
    sub.dispose();
    mock.fireConfigChange(AUTO_APPROVE_SETTING_ID);
    expect(calls).toBe(1);
    expect(mock.state.configEmitter.listenerCount).toBe(0);
  });
});
