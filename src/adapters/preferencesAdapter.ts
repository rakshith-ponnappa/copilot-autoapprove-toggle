import * as vscode from 'vscode';
import { CONFIG_CONFIRM_BEFORE_ENABLING, CONFIG_SECTION, CONFIG_SHOW_STATUS_BAR_ITEM } from '../constants';
import type { ConfirmMode, PreferencesPort } from '../core/types';

const CONFIRM_MODES: readonly ConfirmMode[] = ['firstTime', 'always', 'never'];

function isConfirmMode(value: unknown): value is ConfirmMode {
  return CONFIRM_MODES.some((mode) => mode === value);
}

export class VsCodePreferencesAdapter implements PreferencesPort {
  confirmBeforeEnabling(): ConfirmMode {
    const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<unknown>(CONFIG_CONFIRM_BEFORE_ENABLING);
    return isConfirmMode(value) ? value : 'firstTime';
  }

  showStatusBarItem(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<unknown>(CONFIG_SHOW_STATUS_BAR_ITEM) !== false;
  }
}
