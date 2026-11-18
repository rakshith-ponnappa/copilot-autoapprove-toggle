// Shared contract between core logic, VS Code adapters and tests.
// Modules under src/core and src/ui/presentation.ts must not import 'vscode'.

export interface Disposable {
  dispose(): void;
}

/** chat.tools.global.autoApprove as seen through the extension API. */
export interface AutoApproveSnapshot {
  /** WorkspaceConfiguration.get(): effective value after every layer, including policy. */
  readonly effective: unknown;
  /** inspect().defaultValue: VS Code folds any policy value into this. `undefined` means the setting is not registered. */
  readonly defaultValue: unknown;
  /** inspect().globalValue: the value in user settings.json. */
  readonly globalValue: unknown;
}

/**
 * - on: effective value is `true`.
 * - custom: effective value is a per-tool map with at least one tool set to `true`.
 * - off: anything else.
 * - unsupported: the setting is not registered in this VS Code build.
 */
export type AutoApproveMode = 'on' | 'off' | 'custom' | 'unsupported';

export interface AutoApproveState {
  readonly mode: AutoApproveMode;
  /** Number of tools set to `true` in a per-tool map; 0 unless mode is 'custom'. */
  readonly customToolCount: number;
  /** True when something other than user settings (organization policy, remote settings) controls the effective value. */
  readonly managed: boolean;
  /** True when user settings contain `true`, even if a policy overrides it. */
  readonly userSettingOn: boolean;
}

/**
 * - managed: a write was rejected by policy (or policy was detected by the pre-write probe).
 * - verify-failed: the write succeeded but the effective value did not follow (another layer overrides it).
 */
export type BlockedReason = 'unsupported' | 'managed' | 'write-failed' | 'verify-failed';

/**
 * - statusBar: the click carried the in-memory nonce, so `confirmBeforeEnabling` applies.
 * - external: command palette, keybinding, other extensions, agent tools. Enabling always confirms.
 */
export type InvocationOrigin = 'statusBar' | 'external';

/**
 * Stored per target under `${STORAGE_KEYS.stash}/${targetId}`. `value` is absent when the key was not set in
 * user settings. `target` must equal SettingsPort.targetId; otherwise the stash is treated as absent.
 */
export interface AutoApproveStash {
  readonly v: 1;
  /** SettingsPort.targetId at the time of stashing. A stash for another target is ignored and cleared. */
  readonly target: string;
  readonly value?: unknown;
}

export type ToggleOutcome =
  | { readonly kind: 'changed'; readonly state: AutoApproveState }
  | { readonly kind: 'unchanged'; readonly state: AutoApproveState }
  | { readonly kind: 'cancelled'; readonly state: AutoApproveState }
  | {
      readonly kind: 'blocked';
      readonly reason: BlockedReason;
      readonly detail?: string;
      readonly state: AutoApproveState;
    };

export interface SettingsPort {
  /**
   * Identifies which settings file a Global write lands in: 'local', or `remote:<remoteName>:<authority>`
   * (APPLICATION_MACHINE settings written from a remote window go to the remote machine's user settings).
   */
  readonly targetId: string;
  /** Must read a fresh configuration object on every call. */
  read(): AutoApproveSnapshot;
  /** Writes to user (global) settings. `undefined` removes the key. */
  writeUserValue(value: unknown): Promise<void>;
  /** Fires when chat.tools.global.autoApprove changes from any source. */
  onDidChange(listener: () => void): Disposable;
}

export interface StoragePort {
  /** Values come from persisted JSON; callers must validate the shape. */
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type ConfirmMode = 'firstTime' | 'always' | 'never';

export interface PreferencesPort {
  confirmBeforeEnabling(): ConfirmMode;
}

export interface ConfirmPort {
  /** Shows the risk warning. Resolves `true` only if the user explicitly chose to enable. */
  confirmEnable(): Promise<boolean>;
}

export interface LoggerPort {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ControllerDeps {
  readonly settings: SettingsPort;
  readonly storage: StoragePort;
  readonly preferences: PreferencesPort;
  readonly confirm: ConfirmPort;
  readonly logger: LoggerPort;
}

export interface AutoApproveControllerApi extends Disposable {
  readonly state: AutoApproveState;
  onDidChangeState(listener: (state: AutoApproveState) => void): Disposable;
  /** Startup reconciliation (stale/foreign stash cleanup). Runs through the operation queue. */
  initialize(): Promise<void>;
  enable(origin?: InvocationOrigin): Promise<ToggleOutcome>;
  disable(origin?: InvocationOrigin): Promise<ToggleOutcome>;
  /** While a toggle is queued or in flight, returns that same pending promise (rapid clicks = one toggle). */
  toggle(origin?: InvocationOrigin): Promise<ToggleOutcome>;
}

export type StatusBarBackground = 'statusBarItem.warningBackground' | 'statusBarItem.errorBackground';

export interface StatusBarViewModel {
  readonly text: string;
  /** Markdown; the adapter wraps it in a MarkdownString that only trusts this extension's commands. */
  readonly tooltipMarkdown: string;
  readonly ariaLabel: string;
  readonly backgroundColorId: StatusBarBackground | undefined;
  readonly command: string | undefined;
}

/** Read-only API returned from activate(). */
export interface ExtensionApi {
  getState(): AutoApproveState;
  /**
   * Present only when the extension runs in ExtensionMode.Test. VS Code refuses modal dialogs under
   * --extensionTestsPath, so integration tests need the status bar nonce to exercise enable with confirmation off.
   */
  readonly testing?: { readonly statusBarNonce: string };
}
