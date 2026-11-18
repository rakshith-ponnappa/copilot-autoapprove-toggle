export const EXTENSION_ID = 'rakshith-ponnappa.copilot-autoapprove-toggle';

export const AUTO_APPROVE_SECTION = 'chat.tools.global';
export const AUTO_APPROVE_KEY = 'autoApprove';
export const AUTO_APPROVE_SETTING_ID = `${AUTO_APPROVE_SECTION}.${AUTO_APPROVE_KEY}`;

export const CONFIG_SECTION = 'copilotAutoApproveToggle';
export const CONFIG_CONFIRM_BEFORE_ENABLING = 'confirmBeforeEnabling';
export const CONFIG_SHOW_STATUS_BAR_ITEM = 'showStatusBarItem';

export const COMMANDS = {
  toggle: 'copilotAutoApproveToggle.toggle',
  enable: 'copilotAutoApproveToggle.enable',
  disable: 'copilotAutoApproveToggle.disable',
  openSetting: 'copilotAutoApproveToggle.openSetting',
  showLog: 'copilotAutoApproveToggle.showLog',
} as const;

export const CONTEXT_KEY_MODE = 'copilotAutoApproveToggle.mode';

export const STORAGE_KEYS = {
  /** Prefix; the full key is `${stash}/${targetId}` (one AutoApproveStash per settings target). */
  stash: 'copilotAutoApproveToggle.stash.v1',
  /** `true` once the user accepted this extension's risk warning. */
  riskAcknowledged: 'copilotAutoApproveToggle.riskAcknowledged.v1',
} as const;

export const OUTPUT_CHANNEL_NAME = 'Copilot Auto-Approve Toggle';
