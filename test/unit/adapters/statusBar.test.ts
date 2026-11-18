import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../src/constants';
import type { AutoApproveState } from '../../../src/core/types';
import { present } from '../../../src/ui/presentation';
import { AutoApproveStatusBar } from '../../../src/ui/statusBar';
import {
  type FakeCommand,
  type FakeStatusBarItem,
  MarkdownString,
  mock,
  StatusBarAlignment,
  ThemeColor,
} from '../__mocks__/vscode';

const NONCE = '6f1c1d1e-1111-4222-8333-944444444444';
const SHOW_KEY = 'copilotAutoApproveToggle.showStatusBarItem';

const st = (mode: AutoApproveState['mode'], extra: Partial<AutoApproveState> = {}): AutoApproveState => ({
  mode,
  customToolCount: mode === 'custom' ? 2 : 0,
  managed: false,
  userSettingOn: mode === 'on',
  ...extra,
});

const STATES: readonly AutoApproveState[] = [
  st('off'),
  st('on'),
  st('custom'),
  st('unsupported'),
  st('off', { managed: true }),
  st('off', { managed: true, userSettingOn: true }),
  st('on', { managed: true, userSettingOn: false }),
];

let visible = true;
let remote = false;
let bar: AutoApproveStatusBar | undefined;

function create(state: AutoApproveState): FakeStatusBarItem {
  bar = new AutoApproveStatusBar(state, { nonce: NONCE, isVisible: () => visible, isRemote: () => remote });
  const item = mock.state.statusBarItems.at(-1);
  if (!item) {
    throw new Error('no status bar item created');
  }
  return item;
}

beforeEach(() => {
  mock.reset();
  visible = true;
  remote = false;
});

afterEach(() => {
  bar?.dispose();
  bar = undefined;
});

describe('AutoApproveStatusBar (TS-QA-44)', () => {
  it('TS-QA-44 item id, name, alignment and priority', () => {
    const item = create(st('off'));
    expect(item.id).toBe('copilotAutoApproveToggle.status');
    expect(item.name).toBe('Copilot Auto-Approve');
    expect(item.alignment).toBe(StatusBarAlignment.Right);
    expect(item.priority).toBe(100);
    expect(item.visible).toBe(true);
  });

  it.each(STATES)('TS-QA-44 renders the presentation view model for %j', (state) => {
    for (const isRemote of [false, true]) {
      remote = isRemote;
      const item = create(state);
      const vm = present(state, { remote: isRemote });
      expect(item.text).toBe(vm.text);
      expect(item.accessibilityInformation).toEqual({ label: vm.ariaLabel });
      expect(item.tooltip).toBeInstanceOf(MarkdownString);
      const tooltip = item.tooltip as MarkdownString;
      expect(tooltip.value).toBe(vm.tooltipMarkdown);
      expect(tooltip.supportThemeIcons).toBe(true);
      expect(tooltip.isTrusted).toEqual({
        enabledCommands: [
          COMMANDS.openSetting,
          COMMANDS.toggle,
          'workbench.action.openSettingsJson',
          'workbench.action.openRemoteSettingsFile',
        ],
      });
      expect(tooltip.isTrusted).not.toBe(true);
      if (vm.backgroundColorId) {
        expect(item.backgroundColor).toBeInstanceOf(ThemeColor);
        expect(item.backgroundColor?.id).toBe(vm.backgroundColorId);
      } else {
        expect(item.backgroundColor).toBeUndefined();
      }
      bar?.dispose();
    }
  });

  it.each(STATES)('TS-QA-44 command carries the nonce only for the toggle command: %j', (state) => {
    const item = create(state);
    const vm = present(state);
    const command = item.command as FakeCommand;
    expect(command.command).toBe(vm.command);
    expect(command.title).toBe(vm.ariaLabel);
    if (vm.command === COMMANDS.toggle) {
      expect(command.arguments).toEqual([NONCE]);
    } else {
      expect(command.command).toBe(COMMANDS.openSetting);
      expect(command).not.toHaveProperty('arguments');
    }
  });

  it.each(STATES)('TS-QA-44 the nonce never appears in text, tooltip or aria label: %j', (state) => {
    remote = true;
    const item = create(state);
    const visibleText = [item.text, (item.tooltip as MarkdownString).value, item.accessibilityInformation?.label];
    for (const text of visibleText) {
      expect(text).not.toContain(NONCE);
    }
  });

  it('TS-QA-44 update() re-renders in place without creating another item', () => {
    const item = create(st('off'));
    bar?.update(st('on'));
    expect(mock.state.statusBarItems).toHaveLength(1);
    expect(item.text).toBe('$(unlock) Auto-Approve: On');
    expect(item.backgroundColor?.id).toBe('statusBarItem.warningBackground');
    bar?.update(st('unsupported'));
    expect(item.text).toBe('$(circle-slash) Auto-Approve: N/A');
    expect(item.backgroundColor).toBeUndefined();
    expect((item.command as FakeCommand).command).toBe(COMMANDS.openSetting);
  });

  it('TS-QA-38 remote window: managed leftover-true tooltip links the remote settings file', () => {
    remote = true;
    const item = create(st('off', { managed: true, userSettingOn: true }));
    expect((item.tooltip as MarkdownString).value).toContain('command:workbench.action.openRemoteSettingsFile');
  });
});

describe('showStatusBarItem live (TS-USR-14)', () => {
  it('TS-USR-14 hidden at creation when the preference is off', () => {
    visible = false;
    const item = create(st('off'));
    expect(item.visible).toBe(false);
  });

  it('TS-USR-14 a change to showStatusBarItem re-applies visibility; unrelated changes do not', () => {
    mock.setting(SHOW_KEY).globalValue = true;
    const item = create(st('off'));
    visible = false;
    mock.fireConfigChange('editor.fontSize');
    expect(item.visible).toBe(true);
    mock.fireConfigChange(SHOW_KEY);
    expect(item.visible).toBe(false);
    visible = true;
    mock.fireConfigChange(SHOW_KEY);
    expect(item.visible).toBe(true);
  });

  it('TS-USR-14 update() keeps the item hidden while the preference is off', () => {
    visible = false;
    const item = create(st('off'));
    bar?.update(st('on'));
    expect(item.visible).toBe(false);
  });

  it('TS-QA-33 dispose() removes the config listener and disposes the item', () => {
    const item = create(st('off'));
    expect(mock.state.configEmitter.listenerCount).toBe(1);
    bar?.dispose();
    expect(item.disposed).toBe(true);
    expect(mock.state.configEmitter.listenerCount).toBe(0);
    bar = undefined;
  });
});
