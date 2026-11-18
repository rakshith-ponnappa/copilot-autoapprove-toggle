// Shared helpers for the suites that run inside a real VS Code extension host (integration + policy).
// Never import this from Playwright code: it needs the `vscode` module.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  AUTO_APPROVE_KEY,
  AUTO_APPROVE_SECTION,
  COMMANDS,
  CONFIG_CONFIRM_BEFORE_ENABLING,
  CONFIG_SECTION,
  CONFIG_SHOW_STATUS_BAR_ITEM,
  EXTENSION_ID,
  OUTPUT_CHANNEL_NAME,
} from '../../src/constants';
import type { AutoApproveState, ConfirmMode, ExtensionApi, ToggleOutcome } from '../../src/core/types';

export { COMMANDS };

export const OFF_STATE: AutoApproveState = { mode: 'off', customToolCount: 0, managed: false, userSettingOn: false };
export const ON_STATE: AutoApproveState = { mode: 'on', customToolCount: 0, managed: false, userSettingOn: true };

// ---- extension ------------------------------------------------------------------------------------------------------

export async function getApi(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
  return extension.isActive ? extension.exports : await extension.activate();
}

/** Runs one of the extension's toggle commands; they resolve to the ToggleOutcome (or undefined on internal error). */
export async function run(command: string, ...args: unknown[]): Promise<ToggleOutcome | undefined> {
  return vscode.commands.executeCommand<ToggleOutcome | undefined>(command, ...args);
}

export async function runOutcome(command: string, ...args: unknown[]): Promise<ToggleOutcome> {
  const outcome = await run(command, ...args);
  assert.ok(outcome, `${command} resolved to undefined (the handler caught an unexpected error; see the log)`);
  return outcome;
}

// ---- settings -------------------------------------------------------------------------------------------------------

export interface AutoApproveInspection {
  readonly effective: unknown;
  readonly defaultValue: unknown;
  readonly globalValue: unknown;
  readonly workspaceValue: unknown;
}

export function inspectAutoApprove(): AutoApproveInspection {
  const config = vscode.workspace.getConfiguration(AUTO_APPROVE_SECTION);
  const inspected = config.inspect<unknown>(AUTO_APPROVE_KEY);
  return {
    effective: config.get<unknown>(AUTO_APPROVE_KEY),
    defaultValue: inspected?.defaultValue,
    globalValue: inspected?.globalValue,
    workspaceValue: inspected?.workspaceValue,
  };
}

/** Writes the user value like another window or a hand edit would (`undefined` removes the key). */
export async function setUserAutoApprove(value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(AUTO_APPROVE_SECTION)
    .update(AUTO_APPROVE_KEY, value, vscode.ConfigurationTarget.Global);
}

export async function setConfirmMode(mode: ConfirmMode | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(CONFIG_CONFIRM_BEFORE_ENABLING, mode, vscode.ConfigurationTarget.Global);
}

export async function setShowStatusBarItem(value: boolean | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(CONFIG_SHOW_STATUS_BAR_ITEM, value, vscode.ConfigurationTarget.Global);
}

/** The isolated user-data-dir passed in by .vscode-test.mjs. */
export function userDataDir(): string {
  const dir = process.env.AAT_USER_DATA_DIR;
  assert.ok(dir, 'AAT_USER_DATA_DIR is not set; run the suites through .vscode-test.mjs');
  return dir;
}

export function userSettingsPath(): string {
  return join(userDataDir(), 'User', 'settings.json');
}

export function readUserSettingsText(): string {
  return readFileSync(userSettingsPath(), 'utf8');
}

/** Parses the isolated user settings.json (the harness seeds plain JSON and VS Code keeps it plain JSON). */
export function readUserSettings(): Record<string, unknown> {
  return JSON.parse(readUserSettingsText()) as Record<string, unknown>;
}

/** Finds this extension's LogOutputChannel file under the isolated user-data-dir logs folder (newest first). */
export function findExtensionLogFile(): string | undefined {
  const matches: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.log') && entry.name.includes(OUTPUT_CHANNEL_NAME)) {
        matches.push(path);
      }
    }
  };
  walk(join(userDataDir(), 'logs'));
  return matches.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export function readExtensionLog(): string {
  const file = findExtensionLogFile();
  return file ? readFileSync(file, 'utf8') : '';
}

/** Waits until the extension log matches `pattern` and returns the whole log text. */
export async function waitForLog(pattern: RegExp, timeoutMs = 5_000): Promise<string> {
  let text = '';
  await waitFor(
    () => {
      text = readExtensionLog();
      return pattern.test(text);
    },
    `extension log to match ${String(pattern)} (logs under ${join(userDataDir(), 'logs')})`,
    timeoutMs,
  );
  return text;
}

/**
 * Log barrier: runs a no-op `disable` (state must be off ⇒ outcome `unchanged`) and waits until its line is in the log
 * file. Operations log in order, so everything logged before the barrier has been flushed when this resolves.
 * Returns the log text written after `fromOffset`.
 */
export async function logBarrier(fromOffset: number): Promise<string> {
  const outcome = await run(COMMANDS.disable);
  assert.equal(outcome?.kind, 'unchanged', 'log barrier needs state off');
  let text = '';
  await waitFor(() => {
    text = readExtensionLog().slice(fromOffset);
    return text.includes('disable origin=external outcome=unchanged');
  }, 'the log barrier line');
  return text;
}

// ---- waiting --------------------------------------------------------------------------------------------------------

export async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(25);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- window stubs ---------------------------------------------------------------------------------------------------

export interface WarningCall {
  readonly message: string;
  readonly modal: boolean;
  readonly detail: string | undefined;
  readonly items: readonly string[];
}

export interface WindowSpy {
  readonly warnings: WarningCall[];
  readonly infos: string[];
  readonly errors: string[];
  readonly statusMessages: { readonly text: string; readonly timeout: unknown }[];
  /** Modal warnings only (this extension's "Turn on auto-approve…?" confirmation). */
  readonly modals: () => WarningCall[];
  /** Answer returned by the next modal warnings; non-modal warnings always resolve to `undefined`. */
  answer: string | undefined;
  restore(): void;
}

type Writable = Record<string, unknown>;

const activeSpies = new Set<WindowSpy>();

/** Restores every spy that is still installed (called after each test by `useIntegrationSandbox`). */
export function restoreAllSpies(): void {
  for (const spy of [...activeSpies].reverse()) {
    spy.restore();
  }
}

/**
 * Replaces window.showWarningMessage/showInformationMessage/showErrorMessage/setStatusBarMessage.
 *
 * The test bundle and the extension live under the same extensionDevelopmentPath, so the extension host hands both the
 * SAME `vscode` API object; replacing a method here is what the extension calls too. `assertStubReachesExtension`
 * (activation suite) proves it before anything depends on it. No real dialog can open while the spy is installed.
 */
export function spyWindow(answer?: string): WindowSpy {
  const target = vscode.window as unknown as Writable;
  const names = ['showWarningMessage', 'showInformationMessage', 'showErrorMessage', 'setStatusBarMessage'] as const;
  const originals = new Map(names.map((name) => [name, target[name]] as const));
  const spy: WindowSpy = {
    warnings: [],
    infos: [],
    errors: [],
    statusMessages: [],
    modals: () => spy.warnings.filter((call) => call.modal),
    answer,
    restore: () => {
      if (!activeSpies.delete(spy)) {
        return;
      }
      for (const [name, original] of originals) {
        target[name] = original;
      }
    },
  };
  activeSpies.add(spy);
  target.showWarningMessage = (message: string, ...rest: unknown[]): Promise<string | undefined> => {
    const options = isOptions(rest[0]) ? rest[0] : undefined;
    const items = rest.slice(options ? 1 : 0).map(itemTitle);
    const modal = options?.modal === true;
    spy.warnings.push({ message, modal, detail: options?.detail, items });
    return Promise.resolve(modal ? spy.answer : undefined);
  };
  target.showInformationMessage = (message: string): Promise<undefined> => {
    spy.infos.push(message);
    return Promise.resolve(undefined);
  };
  target.showErrorMessage = (message: string): Promise<undefined> => {
    spy.errors.push(message);
    return Promise.resolve(undefined);
  };
  target.setStatusBarMessage = (text: string, timeout?: unknown): vscode.Disposable => {
    spy.statusMessages.push({ text, timeout });
    return new vscode.Disposable(() => undefined);
  };
  return spy;
}

function isOptions(value: unknown): value is vscode.MessageOptions {
  return typeof value === 'object' && value !== null && !('title' in value);
}

function itemTitle(item: unknown): string {
  if (typeof item === 'string') {
    return item;
  }
  if (typeof item === 'object' && item !== null && 'title' in item) {
    return String(item.title);
  }
  return String(item);
}

/** JSON for logs; `JSON.stringify(undefined)` is `undefined` at runtime despite its `string` type. */
export function describeValue(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

// ---- machine policy guard (TS-ADM-06) -------------------------------------------------------------------------------

/**
 * The schema default of chat.tools.global.autoApprove is `false`; VS Code folds a machine policy into `defaultValue`.
 * Anything else means an organization policy (MDM/registry/policy.json) or a Copilot account policy is in force, and
 * the integration suite would assert against a machine it must not change. Returns a skip reason or `undefined`.
 */
export function machinePolicyReason(inspection: Pick<AutoApproveInspection, 'defaultValue'>): string | undefined {
  if (inspection.defaultValue === false) {
    return undefined;
  }
  return (
    `SKIPPED: machine policy detected — chat.tools.global.autoApprove default is ` +
    `${describeValue(inspection.defaultValue)} instead of false (organization policy, Copilot account ` +
    `policy, or a VS Code build without the setting). Integration tests need an unmanaged machine; run them in CI.`
  );
}

/**
 * Standard integration-suite wiring: skip the whole suite on a managed machine (with a clear message), and put every
 * setting a test may touch back to its pristine state after each test.
 */
export function useIntegrationSandbox(): void {
  before(async function () {
    await getApi();
    const reason = machinePolicyReason(inspectAutoApprove());
    if (reason) {
      // CI runners must be unmanaged: a skip there would hide a broken policy setup or an unsupported build.
      if (process.env.CI === 'true') {
        assert.fail(reason);
      }
      console.warn(reason);
      this.skip();
    }
  });

  afterEach(async () => {
    restoreAllSpies();
    await resetSettings();
  });
}

/** Restores the pristine user settings for everything this extension's tests touch and waits for the state to follow. */
export async function resetSettings(): Promise<void> {
  if (inspectAutoApprove().globalValue !== undefined) {
    await setUserAutoApprove(undefined);
  }
  await setConfirmMode(undefined);
  await setShowStatusBarItem(undefined);
  const api = await getApi();
  await waitFor(() => api.getState().mode === 'off' && !api.getState().managed, 'state to return to off');
}
