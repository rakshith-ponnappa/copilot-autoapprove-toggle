import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { VsCodeConfirmAdapter } from './adapters/confirmAdapter';
import { VsCodeLoggerAdapter } from './adapters/loggerAdapter';
import { VsCodePreferencesAdapter } from './adapters/preferencesAdapter';
import { VsCodeSettingsAdapter } from './adapters/settingsAdapter';
import { AUTO_APPROVE_SETTING_ID, COMMANDS, CONTEXT_KEY_MODE } from './constants';
import { AutoApproveController } from './core/controller';
import { errorMessage } from './core/errors';
import type { AutoApproveState, ExtensionApi, InvocationOrigin, ToggleOutcome } from './core/types';
import { contextKeyMode, describeOutcome, type FeedbackAction, STATUS_MESSAGE_TIMEOUT_MS } from './ui/presentation';
import { AutoApproveStatusBar } from './ui/statusBar';

const ACTION_LABELS: Readonly<Record<FeedbackAction, string>> = {
  openSetting: 'Open Setting',
  showLog: 'Show Log',
};

type ToggleCommand = 'toggle' | 'enable' | 'disable';

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const started = Date.now();
  const logger = new VsCodeLoggerAdapter();
  context.subscriptions.push(logger);

  const preferences = new VsCodePreferencesAdapter();
  const controller = new AutoApproveController({
    settings: new VsCodeSettingsAdapter(),
    storage: context.globalState,
    preferences,
    confirm: new VsCodeConfirmAdapter(),
    logger,
  });
  context.subscriptions.push(controller);
  await controller.initialize();

  // Only status bar clicks carry this nonce; it is never exposed, so other callers always count as 'external'.
  const nonce = randomUUID();
  const statusBar = new AutoApproveStatusBar(controller.state, {
    nonce,
    isVisible: () => preferences.showStatusBarItem(),
    isRemote: () => vscode.env.remoteName !== undefined,
  });
  context.subscriptions.push(statusBar);

  const syncUi = (state: AutoApproveState): void => {
    statusBar.update(state);
    updateContextKey(state, logger);
  };
  syncUi(controller.state);
  context.subscriptions.push(controller.onDidChangeState(syncUi));

  const ui: CommandUi = { logger, nonce, shownOutcomes: new WeakSet() };
  const registerToggle = (name: ToggleCommand, run: (origin: InvocationOrigin) => Promise<ToggleOutcome>) =>
    vscode.commands.registerCommand(COMMANDS[name], (...args: unknown[]) => runToggleCommand(ui, name, args, run));
  context.subscriptions.push(
    registerToggle('toggle', (origin) => controller.toggle(origin)),
    registerToggle('enable', (origin) => controller.enable(origin)),
    registerToggle('disable', (origin) => controller.disable(origin)),
    vscode.commands.registerCommand(COMMANDS.openSetting, () => openSetting(logger)),
    vscode.commands.registerCommand(COMMANDS.showLog, () => {
      logger.show();
    }),
  );

  logger.info(`Activated in ${Date.now() - started} ms (state: ${contextKeyMode(controller.state)}).`);
  const getState = (): AutoApproveState => controller.state;
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return Object.freeze({ getState, testing: Object.freeze({ statusBarNonce: nonce }) });
  }
  return Object.freeze({ getState });
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

interface CommandUi {
  readonly logger: VsCodeLoggerAdapter;
  readonly nonce: string;
  /** Coalesced toggles resolve to the same outcome object; show its feedback only once. */
  readonly shownOutcomes: WeakSet<ToggleOutcome>;
}

/** Never throws to VS Code; resolves to the outcome (or `undefined` on an unexpected error) for programmatic callers. */
async function runToggleCommand(
  ui: CommandUi,
  name: string,
  args: readonly unknown[],
  run: (origin: InvocationOrigin) => Promise<ToggleOutcome>,
): Promise<ToggleOutcome | undefined> {
  const origin: InvocationOrigin = args[0] === ui.nonce ? 'statusBar' : 'external';
  try {
    const outcome = await run(origin);
    if (!ui.shownOutcomes.has(outcome)) {
      ui.shownOutcomes.add(outcome);
      showFeedback(outcome, ui.logger);
    }
    return outcome;
  } catch (e) {
    ui.logger.error(`${name} command failed: ${errorMessage(e)}`);
    return undefined;
  }
}

/** Notifications are not awaited so the command resolves without waiting for the user to dismiss them. */
function showFeedback(outcome: ToggleOutcome, logger: VsCodeLoggerAdapter): void {
  const feedback = describeOutcome(outcome);
  switch (feedback.kind) {
    case 'none':
      return;
    case 'statusMessage':
      vscode.window.setStatusBarMessage(feedback.text, STATUS_MESSAGE_TIMEOUT_MS);
      return;
    case 'warning':
      void showWarning(feedback.text, feedback.actions, logger);
      return;
  }
}

async function showWarning(
  text: string,
  actions: readonly FeedbackAction[],
  logger: VsCodeLoggerAdapter,
): Promise<void> {
  try {
    const labels = actions.map((action) => ACTION_LABELS[action]);
    const picked = await vscode.window.showWarningMessage(text, ...labels);
    const action = actions.find((candidate) => ACTION_LABELS[candidate] === picked);
    if (action === 'openSetting') {
      await openSetting(logger);
    } else if (action === 'showLog') {
      logger.show();
    }
  } catch (e) {
    logger.error(`Could not show the warning: ${errorMessage(e)}`);
  }
}

async function openSetting(logger: VsCodeLoggerAdapter): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.openSettings', AUTO_APPROVE_SETTING_ID);
  } catch (e) {
    logger.error(`Could not open the setting: ${errorMessage(e)}`);
  }
}

function updateContextKey(state: AutoApproveState, logger: VsCodeLoggerAdapter): void {
  Promise.resolve(vscode.commands.executeCommand('setContext', CONTEXT_KEY_MODE, contextKeyMode(state))).catch(
    (e: unknown) => {
      logger.error(`Could not update the context key: ${errorMessage(e)}`);
    },
  );
}
