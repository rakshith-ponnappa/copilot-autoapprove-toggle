import { COMMANDS } from '../constants';
import type {
  AutoApproveState,
  BlockedReason,
  StatusBarBackground,
  StatusBarViewModel,
  ToggleOutcome,
} from '../core/types';

const OPEN_SETTING_LINK = `[Open setting](command:${COMMANDS.openSetting})`;
const OPEN_SETTINGS_JSON_LINK = '[Open settings.json](command:workbench.action.openSettingsJson)';
const OPEN_REMOTE_SETTINGS_LINK = '[Open remote settings.json](command:workbench.action.openRemoteSettingsFile)';

export interface PresentOptions {
  /** True in a remote window, where user-settings writes land in the remote machine's settings file. */
  readonly remote?: boolean;
}

interface Presentation {
  readonly icon: string;
  readonly label: string;
  readonly explanation: string;
  readonly extra: readonly string[];
  readonly background: StatusBarBackground | undefined;
  readonly command: string;
}

export function toolCountLabel(count: number): string {
  return count === 1 ? '1 tool' : `${count} tools`;
}

function describe(state: AutoApproveState, options: PresentOptions): Presentation {
  if (state.mode === 'unsupported') {
    return {
      icon: 'circle-slash',
      label: 'N/A',
      explanation:
        'This VS Code version does not support global tool auto-approve (VS Code 1.104 or later is required).',
      extra: [],
      background: undefined,
      command: COMMANDS.openSetting,
    };
  }
  if (state.managed && state.mode === 'on') {
    return {
      icon: 'lock',
      label: 'On (Managed)',
      explanation: "Your organization's policy turns auto-approve on for all tools.",
      extra: ['Agent tools run without asking for approval, in every workspace.'],
      background: 'statusBarItem.warningBackground',
      command: COMMANDS.openSetting,
    };
  }
  if (state.managed) {
    const settingsLink = options.remote ? OPEN_REMOTE_SETTINGS_LINK : OPEN_SETTINGS_JSON_LINK;
    return {
      icon: 'lock',
      label: 'Managed',
      explanation: "Controlled by your organization's policy.",
      extra: state.userSettingOn ? [`Your settings.json still contains \`true\` — remove it. ${settingsLink}`] : [],
      background: undefined,
      command: COMMANDS.openSetting,
    };
  }
  switch (state.mode) {
    case 'on':
      return {
        icon: 'unlock',
        label: 'On',
        explanation: 'Agent tools run without asking for approval, in every workspace.',
        extra: [
          'Only keep this on while you trust the task and its tools.',
          'VS Code asks once more on the first tool call after each turn-on.',
          'Click to turn off.',
        ],
        background: 'statusBarItem.warningBackground',
        command: COMMANDS.toggle,
      };
    case 'custom':
      return {
        icon: 'filter',
        label: toolCountLabel(state.customToolCount),
        explanation: `Your settings auto-approve ${toolCountLabel(state.customToolCount)}; other tools still ask for approval.`,
        extra: ['Click to turn on for all tools.'],
        background: undefined,
        command: COMMANDS.toggle,
      };
    case 'off':
      return {
        icon: 'shield',
        label: 'Off',
        explanation:
          "Global auto-approve is off. Tools ask unless you've allowed them individually or a chat session uses a Bypass/Autopilot permission level.",
        extra: ['Click to turn on for all tools.'],
        background: undefined,
        command: COMMANDS.toggle,
      };
  }
}

/** Pure mapping from controller state to what the status bar item shows. Precedence: unsupported > managed > mode. */
export function present(state: AutoApproveState, options: PresentOptions = {}): StatusBarViewModel {
  const p = describe(state, options);
  const status = `Auto-Approve: ${p.label}`;
  const tooltipMarkdown = [`**${status}**`, p.explanation, ...p.extra, OPEN_SETTING_LINK].join('\n\n');
  return {
    text: `$(${p.icon}) ${status}`,
    tooltipMarkdown,
    ariaLabel: `Copilot ${status}. ${p.explanation}`,
    backgroundColorId: p.background,
    command: p.command,
  };
}

export type ContextKeyMode = 'unsupported' | 'managed' | 'on' | 'off' | 'custom';

/** Value of the `copilotAutoApproveToggle.mode` context key; same precedence as the status bar. */
export function contextKeyMode(state: AutoApproveState): ContextKeyMode {
  if (state.mode === 'unsupported') {
    return 'unsupported';
  }
  return state.managed ? 'managed' : state.mode;
}

export type FeedbackAction = 'openSetting' | 'showLog';

/** How a command result is shown: transient status bar text, a warning notification, or nothing. */
export type OutcomeFeedback =
  | { readonly kind: 'statusMessage'; readonly text: string }
  | { readonly kind: 'warning'; readonly text: string; readonly actions: readonly FeedbackAction[] }
  | { readonly kind: 'none' };

export const STATUS_MESSAGE_TIMEOUT_MS = 3000;

const BLOCKED_MESSAGES: Readonly<Record<BlockedReason, string>> = {
  unsupported: 'Auto-approve is not available in this VS Code version (VS Code 1.104 or later is required).',
  managed: "Auto-approve is controlled by your organization's policy.",
  'write-failed': 'Could not change the auto-approve setting.',
  'verify-failed':
    "The setting was saved, but auto-approve didn't change. Another settings layer, such as an organization policy, controls it.",
};

function modePhrase(state: AutoApproveState): string {
  switch (state.mode) {
    case 'on':
      return 'on for all tools';
    case 'custom':
      return `on for ${toolCountLabel(state.customToolCount)}`;
    case 'off':
    case 'unsupported':
      return 'off';
  }
}

export function describeOutcome(outcome: ToggleOutcome): OutcomeFeedback {
  switch (outcome.kind) {
    case 'changed':
      return { kind: 'statusMessage', text: `$(check) Auto-approve is now ${modePhrase(outcome.state)}.` };
    case 'unchanged':
      return { kind: 'statusMessage', text: `No change: auto-approve is ${modePhrase(outcome.state)}.` };
    case 'cancelled':
      return { kind: 'none' };
    case 'blocked': {
      const base = BLOCKED_MESSAGES[outcome.reason];
      const text = outcome.detail ? `${base} ${outcome.detail}` : base;
      const withLog = outcome.reason === 'write-failed' || outcome.reason === 'verify-failed';
      return { kind: 'warning', text, actions: withLog ? ['openSetting', 'showLog'] : ['openSetting'] };
    }
  }
}
