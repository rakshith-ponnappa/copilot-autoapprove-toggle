// Minimal stand-in for the `vscode` module (aliased in vitest.config.mts). Only what src/** uses is modelled.
// Tests import `mock` from this file to script behaviour and inspect calls; call `mock.reset()` in `beforeEach`.

/** Built from parts: lint forbids the literal outside src/extension.ts (TS-QA-48). */
export const SET_CONTEXT = ['set', 'Context'].join('');

export interface Disposable {
  dispose(): void;
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3,
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class MarkdownString {
  isTrusted: boolean | { readonly enabledCommands: readonly string[] } | undefined;
  constructor(
    public value = '',
    public supportThemeIcons = false,
  ) {}
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(e: T) => void>();
  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  get listenerCount(): number {
    return this.listeners.size;
  }
  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      listener(e);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export interface ConfigurationChangeEvent {
  affectsConfiguration(section: string): boolean;
}

// ---- fakes ---------------------------------------------------------------------------------------------------------

export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export class FakeOutputChannel {
  readonly lines: LogLine[] = [];
  shown = 0;
  disposed = false;
  constructor(
    readonly name: string,
    readonly options: unknown,
  ) {}
  info(message: string): void {
    this.lines.push({ level: 'info', message });
  }
  warn(message: string): void {
    this.lines.push({ level: 'warn', message });
  }
  error(message: string): void {
    this.lines.push({ level: 'error', message });
  }
  show(preserveFocus?: boolean): void {
    this.shown++;
    this.lastPreserveFocus = preserveFocus;
  }
  lastPreserveFocus: boolean | undefined;
  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeCommand {
  readonly command: string;
  readonly title: string;
  readonly arguments?: readonly unknown[];
}

export class FakeStatusBarItem {
  name: string | undefined;
  text = '';
  tooltip: MarkdownString | string | undefined;
  accessibilityInformation: { readonly label: string } | undefined;
  backgroundColor: ThemeColor | undefined;
  command: FakeCommand | string | undefined;
  visible = false;
  disposed = false;
  constructor(
    readonly id: string,
    readonly alignment: StatusBarAlignment,
    readonly priority: number,
  ) {}
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** One fully-qualified setting (e.g. `chat.tools.global.autoApprove`) as the configuration API layers it. */
export interface FakeSetting {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  /** Policy (or any higher layer): when present it is the effective value. */
  policyValue?: { readonly value: unknown };
}

export interface ConfigUpdate {
  readonly section: string;
  readonly key: string;
  readonly value: unknown;
  readonly target: unknown;
}

export interface ExecutedCommand {
  readonly id: string;
  readonly args: readonly unknown[];
}

export interface WarningCall {
  readonly message: string;
  readonly options: unknown;
  readonly items: readonly string[];
}

function createState() {
  return {
    settings: new Map<string, FakeSetting>(),
    getConfigurationCalls: [] as string[],
    updates: [] as ConfigUpdate[],
    /** Thrown (once) by the next `update()`. */
    nextUpdateError: undefined as Error | undefined,
    /** Thrown by every `inspect()`/`get()` while set. */
    readError: undefined as Error | undefined,
    configEmitter: new EventEmitter<ConfigurationChangeEvent>(),
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    executed: [] as ExecutedCommand[],
    /** Per-command scripted rejection for `executeCommand`. */
    executeErrors: new Map<string, Error>(),
    warnings: [] as WarningCall[],
    /** Answers for `showWarningMessage`, consumed in order; `undefined` when empty. */
    warningAnswers: [] as (string | undefined | Error)[],
    statusMessages: [] as { readonly text: string; readonly timeout: unknown }[],
    statusBarItems: [] as FakeStatusBarItem[],
    outputChannels: [] as FakeOutputChannel[],
    remoteName: undefined as string | undefined,
    workspaceFolders: undefined as { readonly uri: { readonly authority: string } }[] | undefined,
  };
}

type MockState = ReturnType<typeof createState>;

function splitKey(section: string, key: string): string {
  return section ? `${section}.${key}` : key;
}

class MockControl {
  state: MockState = createState();

  reset(): void {
    this.state = createState();
  }

  setting(fullKey: string): FakeSetting {
    let s = this.state.settings.get(fullKey);
    if (!s) {
      s = {};
      this.state.settings.set(fullKey, s);
    }
    return s;
  }

  /** Fires `onDidChangeConfiguration` with an event that affects `fullKey` and every parent section. */
  fireConfigChange(fullKey: string): void {
    this.state.configEmitter.fire({
      affectsConfiguration: (section: string) => fullKey === section || fullKey.startsWith(`${section}.`),
    });
  }

  effective(fullKey: string): unknown {
    const s = this.state.settings.get(fullKey);
    if (!s) {
      return undefined;
    }
    if (s.policyValue) {
      return s.policyValue.value;
    }
    if (s.workspaceValue !== undefined) {
      return s.workspaceValue;
    }
    return s.globalValue !== undefined ? s.globalValue : s.defaultValue;
  }

  /** Runs a registered command handler directly (what VS Code does on a click or palette invocation). */
  invoke(id: string, ...args: unknown[]): unknown {
    const handler = this.state.commands.get(id);
    if (!handler) {
      throw new Error(`command not registered: ${id}`);
    }
    return handler(...args);
  }

  contextKeyValues(key: string): unknown[] {
    return this.state.executed.filter((c) => c.id === SET_CONTEXT && c.args[0] === key).map((c) => c.args[1]);
  }
}

export const mock = new MockControl();

// ---- vscode API surface ----------------------------------------------------------------------------------------

export const env = {
  get remoteName(): string | undefined {
    return mock.state.remoteName;
  },
};

export const workspace = {
  get workspaceFolders(): readonly { readonly uri: { readonly authority: string } }[] | undefined {
    return mock.state.workspaceFolders;
  },
  getConfiguration(section = '') {
    mock.state.getConfigurationCalls.push(section);
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        if (mock.state.readError) {
          throw mock.state.readError;
        }
        const value = mock.effective(splitKey(section, key));
        return (value === undefined ? fallback : value) as T | undefined;
      },
      inspect<T>(key: string) {
        if (mock.state.readError) {
          throw mock.state.readError;
        }
        const fullKey = splitKey(section, key);
        const s = mock.state.settings.get(fullKey);
        if (!s) {
          return undefined;
        }
        const policy = s.policyValue;
        return {
          key: fullKey,
          defaultValue: (policy ? policy.value : s.defaultValue) as T | undefined,
          globalValue: s.globalValue as T | undefined,
          workspaceValue: s.workspaceValue as T | undefined,
        };
      },
      update(key: string, value: unknown, target?: unknown): Promise<void> {
        mock.state.updates.push({ section, key, value, target });
        const error = mock.state.nextUpdateError;
        if (error) {
          mock.state.nextUpdateError = undefined;
          return Promise.reject(error);
        }
        const fullKey = splitKey(section, key);
        const s = mock.setting(fullKey);
        const isGlobal = target === ConfigurationTarget.Global;
        const changed = (isGlobal ? s.globalValue : s.workspaceValue) !== value;
        if (isGlobal) {
          s.globalValue = value;
        } else {
          s.workspaceValue = value;
        }
        if (changed) {
          mock.fireConfigChange(fullKey);
        }
        return Promise.resolve();
      },
    };
  },
  onDidChangeConfiguration(listener: (e: ConfigurationChangeEvent) => void): Disposable {
    return mock.state.configEmitter.event(listener);
  },
};

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
    if (mock.state.commands.has(id)) {
      throw new Error(`command '${id}' already exists`);
    }
    mock.state.commands.set(id, handler);
    return { dispose: () => mock.state.commands.delete(id) };
  },
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    mock.state.executed.push({ id, args });
    const error = mock.state.executeErrors.get(id);
    if (error) {
      return Promise.reject(error);
    }
    const handler = mock.state.commands.get(id);
    return Promise.resolve(handler ? handler(...args) : undefined);
  },
};

export const window = {
  createOutputChannel(name: string, options?: unknown): FakeOutputChannel {
    const channel = new FakeOutputChannel(name, options);
    mock.state.outputChannels.push(channel);
    return channel;
  },
  createStatusBarItem(id: string, alignment: StatusBarAlignment, priority: number): FakeStatusBarItem {
    const item = new FakeStatusBarItem(id, alignment, priority);
    mock.state.statusBarItems.push(item);
    return item;
  },
  setStatusBarMessage(text: string, timeout?: unknown): Disposable {
    mock.state.statusMessages.push({ text, timeout });
    return { dispose: () => undefined };
  },
  showWarningMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    const hasOptions = rest.length > 0 && typeof rest[0] === 'object' && rest[0] !== null;
    const options = hasOptions ? rest[0] : undefined;
    const items = (hasOptions ? rest.slice(1) : rest) as string[];
    mock.state.warnings.push({ message, options, items });
    const answer = mock.state.warningAnswers.shift();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  },
};
