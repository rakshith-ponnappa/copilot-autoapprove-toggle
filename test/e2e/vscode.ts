// Playwright fixture that launches a fully isolated VS Code (downloaded build + packaged VSIX) and tears it down.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { _electron, type ElectronApplication, expect, type Locator, type Page, test as base } from '@playwright/test';
import { E2E_EXTENSIONS_DIR, E2E_ROOT, E2E_STATE_FILE, type E2eState, isolatedEnv } from './paths';

export { expect };

/** Same quiet baseline as the integration profiles; dialogs render inside the window so Playwright can click them. */
const SEED_SETTINGS: Readonly<Record<string, unknown>> = {
  'window.dialogStyle': 'custom',
  'window.restoreWindows': 'none',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off',
};

export const AUTO_APPROVE = 'chat.tools.global.autoApprove';
export const STATUS_NAME = /^Copilot Auto-Approve:/;
/** VS Code renders `${extensionId}.${itemId}` as the entry's element id. */
const ITEM_ELEMENT_ID = 'rakshith-ponnappa.copilot-autoapprove-toggle.copilotAutoApproveToggle.status';

export interface LaunchOptions {
  /** Extra user settings merged over the seed. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Enables workspace trust (no --disable-workspace-trust) and opens a never-trusted folder (TS-ADM-09). */
  readonly workspaceTrust?: boolean;
}

export class VsCodeSession {
  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    readonly userDataDir: string,
  ) {}

  get settingsPath(): string {
    return join(this.userDataDir, 'User', 'settings.json');
  }

  readSettingsText(): string {
    return readFileSync(this.settingsPath, 'utf8');
  }

  readSettings(): Record<string, unknown> {
    return JSON.parse(this.readSettingsText()) as Record<string, unknown>;
  }

  /** Hand-edits chat.tools.global.autoApprove (`undefined` removes the key), keeping every other setting. */
  setAutoApprove(value: unknown): void {
    const others = Object.entries(this.readSettings()).filter(([key]) => key !== AUTO_APPROVE);
    this.writeSettings(Object.fromEntries(value === undefined ? others : [...others, [AUTO_APPROVE, value]]));
  }

  /** A hand edit of user settings.json; VS Code's file watcher picks it up. */
  writeSettings(settings: Record<string, unknown>): void {
    writeFileSync(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }

  get statusBar(): Locator {
    return this.page.locator('[id="workbench.parts.statusbar"]');
  }

  /** The toggle, located the way assistive technology finds it: role button + accessible name. */
  get item(): Locator {
    return this.statusBar.getByRole('button', { name: STATUS_NAME });
  }

  /** The status bar entry container (carries the background kind class). */
  get itemContainer(): Locator {
    return this.statusBar.locator(`[id="${ITEM_ELEMENT_ID}"]`);
  }

  get dialog(): Locator {
    return this.page.locator('.monaco-dialog-box');
  }

  /** Waits until the item shows `Auto-Approve: <label>` and nothing else is pending. */
  async expectItem(label: string): Promise<void> {
    await expect(this.item).toHaveText(new RegExp(`Auto-Approve: ${escapeRegExp(label)}$`));
    await expect(this.item).toHaveAttribute(
      'aria-label',
      new RegExp(`^Copilot Auto-Approve: ${escapeRegExp(label)}\\.`),
    );
  }

  /** Expects settings.json to eventually contain (or, for `undefined`, not contain) the auto-approve key. */
  async expectSetting(value: unknown): Promise<void> {
    await expect
      .poll(() => this.readSettings()[AUTO_APPROVE], { message: `${AUTO_APPROVE} in settings.json` })
      .toEqual(value);
    if (value === undefined) {
      expect(Object.keys(this.readSettings())).not.toContain(AUTO_APPROVE);
    }
  }

  /** Runs a command through the real Command Palette, selecting the row whose label matches exactly. */
  async runFromPalette(label: string): Promise<void> {
    await this.openPalette(label);
    await this.paletteRows().filter({ hasText: label }).first().click();
    await expect(this.quickInput).toBeHidden();
  }

  get quickInput(): Locator {
    return this.page.locator('.quick-input-widget');
  }

  async openPalette(filter: string): Promise<void> {
    // F1 is swallowed by some embedded editors (e.g. the Settings search box); Show All Commands works everywhere.
    await this.page.keyboard.press('ControlOrMeta+Shift+KeyP');
    await expect(this.quickInput).toBeVisible();
    await this.page.keyboard.type(filter);
    await expect(this.paletteRows().first()).toBeVisible();
  }

  paletteRows(): Locator {
    return this.quickInput.locator('.monaco-list-row');
  }

  async closePalette(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.quickInput).toBeHidden();
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let launchCounter = 0;

export const test = base.extend<{ launchVsCode: (options?: LaunchOptions) => Promise<VsCodeSession> }>({
  // eslint-disable-next-line no-empty-pattern
  launchVsCode: async ({}, use, testInfo) => {
    const state = JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState;
    const sessions: VsCodeSession[] = [];

    await use(async (options: LaunchOptions = {}) => {
      launchCounter += 1;
      const dir = join(E2E_ROOT, `w${String(testInfo.workerIndex)}-${String(launchCounter)}`);
      const userDataDir = join(dir, 'ud');
      const home = join(dir, 'home');
      const folder = join(dir, options.workspaceTrust ? 'untrusted' : 'ws');
      for (const path of [join(userDataDir, 'User'), home, folder]) {
        mkdirSync(path, { recursive: true });
      }
      writeFileSync(join(folder, 'README.md'), '# E2E scratch workspace\n');
      const settings: Record<string, unknown> = { ...SEED_SETTINGS, ...options.settings };
      if (options.workspaceTrust) {
        settings['security.workspace.trust.enabled'] = true;
        settings['security.workspace.trust.startupPrompt'] = 'never';
      }
      writeFileSync(join(userDataDir, 'User', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

      const args = [
        folder,
        // Chromium flag unknown to VS Code's argv parser: it would swallow a following positional argument, so it must
        // only be followed by `--` options.
        ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${E2E_EXTENSIONS_DIR}`,
        '--locale=en',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-updates',
        '--use-inmemory-secretstorage',
        '--new-window',
        ...(options.workspaceTrust ? [] : ['--disable-workspace-trust']),
        // Ubuntu 24.04 runners restrict unprivileged user namespaces (AppArmor), which Chromium's sandbox needs.
        ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox', '--disable-gpu-sandbox'] : []),
      ];
      const app = await _electron.launch({
        executablePath: state.executablePath,
        args,
        env: isolatedEnv(home),
        timeout: 60_000,
      });
      await app.context().tracing.start({ screenshots: true, snapshots: true });
      const page = await app.firstWindow({ timeout: 60_000 });
      const session = new VsCodeSession(app, page, userDataDir);
      sessions.push(session);
      await expect(page.locator('.monaco-workbench')).toBeVisible({ timeout: 60_000 });
      return session;
    });

    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [index, session] of sessions.entries()) {
      await closeSession(session, failed, testInfo.outputPath(`vscode-${String(index)}`));
    }
  },
});

async function closeSession(session: VsCodeSession, failed: boolean, outputBase: string): Promise<void> {
  const pid = session.app.process().pid;
  try {
    if (failed) {
      await session.page.screenshot({ path: `${outputBase}-failure.png` }).catch(() => undefined);
      await session.app
        .context()
        .tracing.stop({ path: `${outputBase}-trace.zip` })
        .catch(() => undefined);
    } else {
      await session.app
        .context()
        .tracing.stop()
        .catch(() => undefined);
    }
    await Promise.race([session.app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))]);
  } finally {
    if (pid !== undefined && isAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
