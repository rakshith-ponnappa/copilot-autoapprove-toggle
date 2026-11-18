import * as vscode from 'vscode';
import type { ConfirmPort } from '../core/types';

const TURN_ON = 'Turn On';

const MESSAGE = 'Turn on auto-approve for all agent tools?';
const DETAIL =
  'All tools, including terminal commands and file edits, will run without asking for approval, in every workspace ' +
  'on this machine (in a remote window: on that remote machine), until you turn it off. ' +
  'VS Code will also ask you once more on the first tool call.';

export class VsCodeConfirmAdapter implements ConfirmPort {
  async confirmEnable(): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(MESSAGE, { modal: true, detail: DETAIL }, TURN_ON);
    return choice === TURN_ON;
  }
}
