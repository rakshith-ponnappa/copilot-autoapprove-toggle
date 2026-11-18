import * as vscode from 'vscode';
import { AUTO_APPROVE_KEY, AUTO_APPROVE_SECTION, AUTO_APPROVE_SETTING_ID } from '../constants';
import type { AutoApproveSnapshot, Disposable, SettingsPort } from '../core/types';

/** In a remote window a Global write of this APPLICATION_MACHINE setting lands in the remote machine's settings. */
export function computeTargetId(): string {
  const remoteName = vscode.env.remoteName;
  if (!remoteName) {
    return 'local';
  }
  return `remote:${remoteName}:${vscode.workspace.workspaceFolders?.[0]?.uri.authority ?? ''}`;
}

export class VsCodeSettingsAdapter implements SettingsPort {
  /** Recomputed on each access: a folder can be added to an empty remote window after activation. */
  get targetId(): string {
    return computeTargetId();
  }

  read(): AutoApproveSnapshot {
    const config = vscode.workspace.getConfiguration(AUTO_APPROVE_SECTION);
    const inspected = config.inspect<unknown>(AUTO_APPROVE_KEY);
    return {
      effective: config.get<unknown>(AUTO_APPROVE_KEY),
      defaultValue: inspected?.defaultValue,
      globalValue: inspected?.globalValue,
    };
  }

  async writeUserValue(value: unknown): Promise<void> {
    await vscode.workspace
      .getConfiguration(AUTO_APPROVE_SECTION)
      .update(AUTO_APPROVE_KEY, value, vscode.ConfigurationTarget.Global);
  }

  onDidChange(listener: () => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(AUTO_APPROVE_SETTING_ID)) {
        listener();
      }
    });
  }
}
