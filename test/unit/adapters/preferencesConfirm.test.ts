import { beforeEach, describe, expect, it } from 'vitest';
import { VsCodeConfirmAdapter } from '../../../src/adapters/confirmAdapter';
import { VsCodeLoggerAdapter } from '../../../src/adapters/loggerAdapter';
import { VsCodePreferencesAdapter } from '../../../src/adapters/preferencesAdapter';
import { OUTPUT_CHANNEL_NAME } from '../../../src/constants';
import { mock } from '../__mocks__/vscode';

const CONFIRM_KEY = 'copilotAutoApproveToggle.confirmBeforeEnabling';
const SHOW_KEY = 'copilotAutoApproveToggle.showStatusBarItem';

beforeEach(() => {
  mock.reset();
});

describe('VsCodePreferencesAdapter (TS-QA-43)', () => {
  it.each([
    ['firstTime', 'firstTime'],
    ['always', 'always'],
    ['never', 'never'],
    ['bogus', 'firstTime'],
    ['Never', 'firstTime'],
    [undefined, 'firstTime'],
    [3, 'firstTime'],
    [null, 'firstTime'],
    [true, 'firstTime'],
    [['never'], 'firstTime'],
  ])('TS-QA-43 confirmBeforeEnabling %j ⇒ %s', (value, expected) => {
    mock.setting(CONFIRM_KEY).globalValue = value;
    expect(new VsCodePreferencesAdapter().confirmBeforeEnabling()).toBe(expected);
  });

  it('TS-QA-43 confirmBeforeEnabling is read fresh on every call', () => {
    const prefs = new VsCodePreferencesAdapter();
    mock.setting(CONFIRM_KEY).globalValue = 'never';
    expect(prefs.confirmBeforeEnabling()).toBe('never');
    mock.setting(CONFIRM_KEY).globalValue = 'always';
    expect(prefs.confirmBeforeEnabling()).toBe('always');
  });

  it.each([
    [undefined, true],
    [true, true],
    [false, false],
    ['false', true],
    [0, true],
  ])('TS-USR-14 showStatusBarItem %j ⇒ visible %s (only boolean false hides)', (value, expected) => {
    mock.setting(SHOW_KEY).globalValue = value;
    expect(new VsCodePreferencesAdapter().showStatusBarItem()).toBe(expected);
  });
});

describe('VsCodeConfirmAdapter (TS-QA-43)', () => {
  it.each([
    ['Turn On', true],
    [undefined, false],
    ['Cancel', false],
    ['turn on', false],
    ['Turn On ', false],
  ])('TS-QA-43 answer %j ⇒ %s', async (answer, expected) => {
    mock.state.warningAnswers.push(answer);
    await expect(new VsCodeConfirmAdapter().confirmEnable()).resolves.toBe(expected);
  });

  it('TS-QA-43 shows one modal warning with a detail and exactly one affirmative button', async () => {
    mock.state.warningAnswers.push(undefined);
    await new VsCodeConfirmAdapter().confirmEnable();
    expect(mock.state.warnings).toHaveLength(1);
    const [call] = mock.state.warnings;
    expect(call?.message).toBe('Turn on auto-approve for all agent tools?');
    expect(call?.options).toMatchObject({ modal: true });
    expect(call?.items).toEqual(['Turn On']);
  });

  it('TS-USR-10 detail explains scope, risk and that VS Code asks once more', async () => {
    await new VsCodeConfirmAdapter().confirmEnable();
    const detail = (mock.state.warnings[0]?.options as { detail: string }).detail;
    expect(detail).toContain('terminal commands and file edits');
    expect(detail).toContain('without asking for approval');
    expect(detail).toContain('until you turn it off');
    expect(detail).toContain('VS Code will also ask you once more');
  });

  it('TS-QA-56 confirm copy names the remote machine', async () => {
    mock.state.remoteName = 'ssh-remote';
    await new VsCodeConfirmAdapter().confirmEnable();
    const detail = (mock.state.warnings[0]?.options as { detail: string }).detail;
    expect(detail).toContain('in every workspace on this machine (in a remote window: on that remote machine)');
  });

  it('TS-QA-34 a dialog API failure rejects (the controller treats it as cancelled)', async () => {
    mock.state.warningAnswers.push(new Error('dialog unavailable'));
    await expect(new VsCodeConfirmAdapter().confirmEnable()).rejects.toThrow('dialog unavailable');
  });
});

describe('VsCodeLoggerAdapter (TS-QA-35)', () => {
  it('TS-QA-35 writes to one log output channel by level; show() preserves focus; dispose disposes the channel', () => {
    const logger = new VsCodeLoggerAdapter();
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.show();
    const [channel] = mock.state.outputChannels;
    expect(mock.state.outputChannels).toHaveLength(1);
    expect(channel?.name).toBe(OUTPUT_CHANNEL_NAME);
    expect(channel?.options).toEqual({ log: true });
    expect(channel?.lines).toEqual([
      { level: 'info', message: 'i' },
      { level: 'warn', message: 'w' },
      { level: 'error', message: 'e' },
    ]);
    expect(channel?.shown).toBe(1);
    expect(channel?.lastPreserveFocus).toBe(true);
    logger.dispose();
    expect(channel?.disposed).toBe(true);
  });
});
