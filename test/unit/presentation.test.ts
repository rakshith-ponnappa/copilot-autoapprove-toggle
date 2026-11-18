import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/constants';
import type { AutoApproveMode, AutoApproveState, BlockedReason, ToggleOutcome } from '../../src/core/types';
import {
  contextKeyMode,
  describeOutcome,
  present,
  STATUS_MESSAGE_TIMEOUT_MS,
  toolCountLabel,
} from '../../src/ui/presentation';

const OPEN_SETTING = `[Open setting](command:${COMMANDS.openSetting})`;
const OPEN_SETTINGS_JSON = '[Open settings.json](command:workbench.action.openSettingsJson)';
const OPEN_REMOTE_SETTINGS = '(command:workbench.action.openRemoteSettingsFile)';
const LEFTOVER = 'Your settings.json still contains `true` — remove it';

const st = (mode: AutoApproveMode, extra: Partial<AutoApproveState> = {}): AutoApproveState => ({
  mode,
  customToolCount: mode === 'custom' ? 3 : 0,
  managed: false,
  userSettingOn: mode === 'on',
  ...extra,
});

const ALL_STATES: AutoApproveState[] = (['on', 'off', 'custom', 'unsupported'] as const).flatMap((mode) =>
  [false, true].flatMap((managed) => [false, true].map((userSettingOn) => st(mode, { managed, userSettingOn }))),
);

describe('present — rows (§3.3)', () => {
  it('TS-QA-36 on row', () => {
    const vm = present(st('on'));
    expect(vm.text).toBe('$(unlock) Auto-Approve: On');
    expect(vm.backgroundColorId).toBe('statusBarItem.warningBackground');
    expect(vm.command).toBe(COMMANDS.toggle);
    const parts = vm.tooltipMarkdown.split('\n\n');
    expect(parts[0]).toBe('**Auto-Approve: On**');
    expect(parts[1]).toMatch(/\.$/);
    expect(vm.tooltipMarkdown).toContain('Click to turn off');
    expect(vm.tooltipMarkdown).toContain('VS Code asks once more on the first tool call after each turn-on');
    expect(vm.tooltipMarkdown).toMatch(/trust/i);
  });

  it('TS-QA-36 off row', () => {
    const vm = present(st('off'));
    expect(vm.text).toBe('$(shield) Auto-Approve: Off');
    expect(vm.backgroundColorId).toBeUndefined();
    expect(vm.command).toBe(COMMANDS.toggle);
    expect(vm.tooltipMarkdown.startsWith('**Auto-Approve: Off**')).toBe(true);
    expect(vm.tooltipMarkdown).toContain('Click to turn on');
    expect(vm.tooltipMarkdown).not.toContain('Click to turn off');
    expect(vm.tooltipMarkdown).not.toContain('asks once more');
    const explanation =
      "Global auto-approve is off. Tools ask unless you've allowed them individually or a chat session uses a Bypass/Autopilot permission level.";
    expect(vm.tooltipMarkdown.split('\n\n')[1]).toBe(explanation);
    expect(vm.ariaLabel).toBe(`Copilot Auto-Approve: Off. ${explanation}`);
  });

  it.each([
    [1, '1 tool'],
    [2, '2 tools'],
    [10, '10 tools'],
  ])('TS-QA-37 custom count %d ⇒ "%s" in text and aria label', (count, label) => {
    const vm = present(st('custom', { customToolCount: count }));
    expect(vm.text).toBe(`$(filter) Auto-Approve: ${label}`);
    expect(vm.backgroundColorId).toBeUndefined();
    expect(vm.command).toBe(COMMANDS.toggle);
    expect(vm.ariaLabel).toContain(`Auto-Approve: ${label}.`);
    expect(vm.tooltipMarkdown).toContain('Click to turn on');
    if (count === 1) {
      expect(vm.ariaLabel).not.toContain('1 tools');
    }
  });

  it.each([
    [0, '0 tools'],
    [1, '1 tool'],
    [21, '21 tools'],
  ])('TS-QA-37 toolCountLabel(%d) === "%s"', (count, label) => {
    expect(toolCountLabel(count)).toBe(label);
  });

  it.each([
    ['off', false],
    ['off', true],
    ['custom', false],
    ['custom', true],
  ] as const)('TS-QA-38 managed + mode %s + userSettingOn %s ⇒ Managed row', (mode, userSettingOn) => {
    const vm = present(st(mode, { managed: true, userSettingOn }));
    expect(vm.text).toBe('$(lock) Auto-Approve: Managed');
    expect(vm.backgroundColorId).toBeUndefined();
    expect(vm.command).toBe(COMMANDS.openSetting);
    expect(vm.tooltipMarkdown).toContain("Controlled by your organization's policy.");
    expect(vm.tooltipMarkdown).not.toContain('remote settings');
    expect(vm.tooltipMarkdown.includes(LEFTOVER)).toBe(userSettingOn);
    expect(vm.tooltipMarkdown.includes(OPEN_SETTINGS_JSON)).toBe(userSettingOn);
  });

  it.each([false, true])(
    'TS-QA-38 managed + mode on (policy forces on), userSettingOn %s ⇒ On (Managed) row (§9)',
    (userSettingOn) => {
      const vm = present(st('on', { managed: true, userSettingOn }));
      expect(vm.text).toBe('$(lock) Auto-Approve: On (Managed)');
      expect(vm.backgroundColorId).toBe('statusBarItem.warningBackground');
      expect(vm.command).toBe(COMMANDS.openSetting);
      expect(vm.tooltipMarkdown).toContain("Your organization's policy turns auto-approve on for all tools.");
      expect(vm.tooltipMarkdown).not.toContain('Click to turn');
    },
  );

  it('TS-QA-38 remote window: the leftover-true guidance links the remote settings file instead (§9)', () => {
    const vm = present(st('off', { managed: true, userSettingOn: true }), { remote: true });
    expect(vm.tooltipMarkdown).toContain(LEFTOVER);
    expect(vm.tooltipMarkdown).toContain(OPEN_REMOTE_SETTINGS);
    expect(vm.tooltipMarkdown).not.toContain(OPEN_SETTINGS_JSON);
    expect(present(st('off', { managed: true, userSettingOn: true }), { remote: false }).tooltipMarkdown).toContain(
      OPEN_SETTINGS_JSON,
    );
  });

  it('TS-QA-38 remote option does not change non-managed rows', () => {
    for (const mode of ['on', 'off', 'custom'] as const) {
      expect(present(st(mode), { remote: true })).toEqual(present(st(mode)));
    }
  });

  it.each([false, true])(
    'TS-QA-39 unsupported (+ managed + userSettingOn=%s) wins: N/A, openSetting, no managed text',
    (userSettingOn) => {
      const vm = present(st('unsupported', { managed: true, userSettingOn }));
      expect(vm.text).toBe('$(circle-slash) Auto-Approve: N/A');
      expect(vm.command).toBe(COMMANDS.openSetting);
      expect(vm.backgroundColorId).toBeUndefined();
      expect(vm.tooltipMarkdown).not.toMatch(/organization|Managed|settings\.json/);
      expect(vm.tooltipMarkdown).toContain('1.104');
    },
  );

  it('TS-QA-39 precedence: unsupported > managed > mode', () => {
    expect(present(st('unsupported', { managed: true })).text).toContain('N/A');
    expect(present(st('custom', { managed: true })).text).toContain('Managed');
    expect(present(st('on', { managed: true })).text).toContain('On (Managed)');
    expect(present(st('custom')).text).toContain('3 tools');
  });

  it.each(ALL_STATES)('TS-QA-40 "[Open setting]" link is present in every state: %j', (state) => {
    for (const remote of [false, true]) {
      const md = present(state, { remote }).tooltipMarkdown;
      expect(md).toContain(OPEN_SETTING);
      expect(md.endsWith(OPEN_SETTING)).toBe(true);
    }
  });

  it.each(ALL_STATES)('TS-QA-41 accessibility: plain-sentence aria label, theme colour ids only: %j', (state) => {
    const vm = present(state);
    expect(vm.ariaLabel).not.toMatch(/\$\(/);
    expect(vm.ariaLabel).not.toMatch(/[*`[\]]|\]\(|command:/);
    expect(vm.ariaLabel).toMatch(/^Copilot Auto-Approve: .+\. .+\.$/);
    expect(vm.ariaLabel).toContain(vm.text.replace(/^\$\([a-z-]+\) /, ''));
    expect([undefined, 'statusBarItem.warningBackground']).toContain(vm.backgroundColorId);
  });

  it('TS-QA-41 status words appear in the aria label for every state', () => {
    expect(present(st('on')).ariaLabel).toContain('On');
    expect(present(st('off')).ariaLabel).toContain('Off');
    expect(present(st('custom', { customToolCount: 1 })).ariaLabel).toContain('1 tool');
    expect(present(st('off', { managed: true })).ariaLabel).toContain('Managed');
    expect(present(st('unsupported')).ariaLabel).toContain('N/A');
  });
});

describe('present — exact tooltips (TS-QA-40)', () => {
  const paragraphs = (state: AutoApproveState): string[] => present(state).tooltipMarkdown.split('\n\n');

  it('TS-QA-40 unsupported tooltip: title, explanation, Open setting — nothing else', () => {
    expect(paragraphs(st('unsupported'))).toEqual([
      '**Auto-Approve: N/A**',
      'This VS Code version does not support global tool auto-approve (VS Code 1.104 or later is required).',
      OPEN_SETTING,
    ]);
  });

  it('TS-QA-40 policy-forced on tooltip warns that tools run without asking', () => {
    expect(paragraphs(st('on', { managed: true, userSettingOn: false }))).toEqual([
      '**Auto-Approve: On (Managed)**',
      "Your organization's policy turns auto-approve on for all tools.",
      'Agent tools run without asking for approval, in every workspace.',
      OPEN_SETTING,
    ]);
  });

  it('TS-QA-40 managed (no leftover user true) tooltip has no extra guidance', () => {
    expect(paragraphs(st('off', { managed: true, userSettingOn: false }))).toEqual([
      '**Auto-Approve: Managed**',
      "Controlled by your organization's policy.",
      OPEN_SETTING,
    ]);
  });
});

describe('contextKeyMode (§3.4)', () => {
  it.each([
    [st('unsupported', { managed: true }), 'unsupported'],
    [st('on', { managed: true }), 'managed'],
    [st('off', { managed: true }), 'managed'],
    [st('custom', { managed: true }), 'managed'],
    [st('on'), 'on'],
    [st('off'), 'off'],
    [st('custom'), 'custom'],
  ] as const)('TS-QA-45 context key precedence: %j ⇒ %s', (state, expected) => {
    expect(contextKeyMode(state)).toBe(expected);
  });
});

describe('describeOutcome (§3.4 result UI)', () => {
  it('TS-USR-15 changed/unchanged ⇒ quiet status bar message; cancelled ⇒ nothing', () => {
    expect(STATUS_MESSAGE_TIMEOUT_MS).toBe(3000);
    expect(describeOutcome({ kind: 'changed', state: st('on') })).toEqual({
      kind: 'statusMessage',
      text: '$(check) Auto-approve is now on for all tools.',
    });
    expect(describeOutcome({ kind: 'changed', state: st('custom', { customToolCount: 1 }) })).toEqual({
      kind: 'statusMessage',
      text: '$(check) Auto-approve is now on for 1 tool.',
    });
    expect(describeOutcome({ kind: 'changed', state: st('off') })).toEqual({
      kind: 'statusMessage',
      text: '$(check) Auto-approve is now off.',
    });
    expect(describeOutcome({ kind: 'unchanged', state: st('on') })).toEqual({
      kind: 'statusMessage',
      text: 'No change: auto-approve is on for all tools.',
    });
    expect(describeOutcome({ kind: 'unchanged', state: st('unsupported') })).toEqual({
      kind: 'statusMessage',
      text: 'No change: auto-approve is off.',
    });
    expect(describeOutcome({ kind: 'cancelled', state: st('off') })).toEqual({ kind: 'none' });
  });

  const reasons: readonly [BlockedReason, readonly string[]][] = [
    ['unsupported', ['openSetting']],
    ['managed', ['openSetting']],
    ['write-failed', ['openSetting', 'showLog']],
    ['verify-failed', ['openSetting', 'showLog']],
  ];

  it.each(reasons)('TS-QA-45 blocked/%s ⇒ warning with actions %j; raw detail appended verbatim', (reason, actions) => {
    const withoutDetail = describeOutcome({ kind: 'blocked', reason, state: st('off') });
    expect(withoutDetail.kind).toBe('warning');
    if (withoutDetail.kind !== 'warning') {
      return;
    }
    expect(withoutDetail.actions).toEqual(actions);
    expect(withoutDetail.text.length).toBeGreaterThan(10);
    const raw = 'EACCES: permission denied, open settings.json';
    const withDetail = describeOutcome({ kind: 'blocked', reason, detail: raw, state: st('off') });
    expect(withDetail).toEqual({ kind: 'warning', text: `${withoutDetail.text} ${raw}`, actions });
  });

  it('TS-QA-45 empty detail adds nothing', () => {
    const outcome: ToggleOutcome = { kind: 'blocked', reason: 'managed', detail: '', state: st('off') };
    const feedback = describeOutcome(outcome);
    expect(feedback.kind === 'warning' && feedback.text.endsWith(' ')).toBe(false);
  });

  it('TS-QA-45 blocked messages are distinct per reason and mention the cause', () => {
    const texts = reasons.map(([reason]) => {
      const f = describeOutcome({ kind: 'blocked', reason, state: st('off') });
      return f.kind === 'warning' ? f.text : '';
    });
    expect(new Set(texts).size).toBe(4);
    expect(texts[0]).toContain('1.104');
    expect(texts[1]).toMatch(/policy/);
  });
});
