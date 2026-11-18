import * as vscode from 'vscode';
import { COMMANDS, CONFIG_SECTION, CONFIG_SHOW_STATUS_BAR_ITEM } from '../constants';
import type { AutoApproveState, StatusBarViewModel } from '../core/types';
import { present } from './presentation';

const ITEM_ID = 'copilotAutoApproveToggle.status';
const ITEM_NAME = 'Copilot Auto-Approve';
const TRUSTED_COMMANDS = [
  COMMANDS.openSetting,
  COMMANDS.toggle,
  'workbench.action.openSettingsJson',
  'workbench.action.openRemoteSettingsFile',
];

export interface StatusBarOptions {
  /** Secret passed only with status bar clicks so the command handler can tell them apart from other callers. */
  readonly nonce: string;
  readonly isVisible: () => boolean;
  readonly isRemote: () => boolean;
}

export class AutoApproveStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(ITEM_ID, vscode.StatusBarAlignment.Right, 100);
  private readonly configListener: vscode.Disposable;

  constructor(
    state: AutoApproveState,
    private readonly options: StatusBarOptions,
  ) {
    this.item.name = ITEM_NAME;
    this.update(state);
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_SHOW_STATUS_BAR_ITEM}`)) {
        this.applyVisibility();
      }
    });
  }

  update(state: AutoApproveState): void {
    const vm = present(state, { remote: this.options.isRemote() });
    this.item.text = vm.text;
    this.item.tooltip = toTooltip(vm);
    this.item.accessibilityInformation = { label: vm.ariaLabel };
    this.item.backgroundColor = vm.backgroundColorId ? new vscode.ThemeColor(vm.backgroundColorId) : undefined;
    this.item.command = this.toCommand(vm);
    this.applyVisibility();
  }

  dispose(): void {
    this.configListener.dispose();
    this.item.dispose();
  }

  private toCommand(vm: StatusBarViewModel): vscode.Command | undefined {
    if (vm.command === undefined) {
      return undefined;
    }
    const title = vm.ariaLabel;
    return vm.command === COMMANDS.toggle
      ? { command: vm.command, title, arguments: [this.options.nonce] }
      : { command: vm.command, title };
  }

  private applyVisibility(): void {
    if (this.options.isVisible()) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }
}

function toTooltip(vm: StatusBarViewModel): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(vm.tooltipMarkdown, true);
  markdown.isTrusted = { enabledCommands: TRUSTED_COMMANDS };
  return markdown;
}
