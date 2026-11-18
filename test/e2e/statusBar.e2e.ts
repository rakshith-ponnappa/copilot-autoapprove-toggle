import { type Locator } from '@playwright/test';
import { AUTO_APPROVE, expect, test, type VsCodeSession } from './vscode';

const CONFIRM = 'copilotAutoApproveToggle.confirmBeforeEnabling';
const SHOW_ITEM = 'copilotAutoApproveToggle.showStatusBarItem';

function button(session: VsCodeSession, name: string): Locator {
  return session.dialog.getByRole('button', { name, exact: true });
}

/**
 * Clicks the item, expects our modal, answers it, and waits for the resulting state. Waiting matters: a click while the
 * confirmed turn-on is still being written is coalesced into it by design (rapid clicks = one toggle).
 */
async function clickAndConfirm(session: VsCodeSession, answer: 'Turn On' | 'Cancel' | 'Escape'): Promise<void> {
  await session.item.click();
  await expect(session.dialog).toBeVisible();
  if (answer === 'Escape') {
    await session.page.keyboard.press('Escape');
  } else {
    await button(session, answer).click();
  }
  await expect(session.dialog).toBeHidden();
  if (answer === 'Turn On') {
    await session.expectItem('On');
  }
}

/** Clicks the item and expects it to flip to `label` without any dialog in between. */
async function clickWithoutDialog(session: VsCodeSession, label: string): Promise<void> {
  await session.item.click();
  await session.expectItem(label);
  await expect(session.dialog).toHaveCount(0);
}

async function expectNoAutoApproveToast(session: VsCodeSession): Promise<void> {
  await expect(session.page.locator('.notification-toast').filter({ hasText: /auto-approve/i })).toHaveCount(0);
}

async function hoverText(session: VsCodeSession): Promise<string> {
  const hover = session.page.locator('.workbench-hover, .monaco-hover').filter({ hasText: 'Auto-Approve' }).first();
  // The hover only opens after a fresh mouseover; move away and back until it shows (finite).
  await expect(async () => {
    await session.page.mouse.move(0, 0);
    await session.item.hover();
    await expect(hover).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  const text = await hover.innerText();
  await session.page.mouse.move(0, 0);
  return text;
}

test.describe('status bar item (E2E)', () => {
  test('TS-USR-01 starts Off on a fresh profile: shield icon, no warning background, "Click to turn on"', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode();
    await expect(vscode.item).toHaveCount(1);
    await vscode.expectItem('Off');
    await expect(vscode.item.locator('.codicon-shield')).toHaveCount(1);
    await expect(vscode.itemContainer).not.toHaveClass(/warning-kind/);
    expect(await hoverText(vscode)).toContain('Click to turn on');
    expect(Object.keys(vscode.readSettings())).not.toContain(AUTO_APPROVE);
  });

  test('TS-USR-02 first click turns on after our warning: warning background, settings.json true, quiet feedback', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode();
    await vscode.expectItem('Off');
    await clickAndConfirm(vscode, 'Turn On');
    await vscode.expectItem('On');
    await expect(vscode.item.locator('.codicon-unlock')).toHaveCount(1);
    await expect(vscode.itemContainer).toHaveClass(/warning-kind/);
    await vscode.expectSetting(true);
    await expect(vscode.statusBar).toContainText('Auto-approve is now on for all tools.');
    await expectNoAutoApproveToast(vscode);
  });

  test('TS-USR-10 the warning wording is clear: title, risk detail, Turn On + Cancel', async ({ launchVsCode }) => {
    const vscode = await launchVsCode();
    await vscode.item.click();
    await expect(vscode.dialog).toBeVisible();
    await expect(vscode.dialog.locator('.dialog-message-text')).toHaveText('Turn on auto-approve for all agent tools?');
    const detail = vscode.dialog.locator('.dialog-message-detail');
    await expect(detail).toContainText('without asking for approval');
    await expect(detail).toContainText('in every workspace');
    await expect(detail).toContainText('ask you once more');
    const buttons = await vscode.dialog.locator('.dialog-buttons [role="button"]').allInnerTexts();
    expect([...buttons].sort()).toEqual(['Cancel', 'Turn On']);
    await button(vscode, 'Cancel').click();
    await vscode.expectItem('Off');
  });

  test('TS-USR-03 click when On turns off with no dialog and removes the key (prior value absent)', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode();
    await clickAndConfirm(vscode, 'Turn On');
    await vscode.expectSetting(true);
    await clickWithoutDialog(vscode, 'Off');
    await expect(vscode.itemContainer).not.toHaveClass(/warning-kind/);
    await vscode.expectSetting(undefined);
  });

  test('TS-USR-03 turning off restores a prior per-tool map exactly', async ({ launchVsCode }) => {
    const map = { someTool: true, otherTool: false };
    const vscode = await launchVsCode({ settings: { [AUTO_APPROVE]: map } });
    await vscode.expectItem('1 tool');
    await expect(vscode.item.locator('.codicon-filter')).toHaveCount(1);
    await clickAndConfirm(vscode, 'Turn On');
    await vscode.expectItem('On');
    await vscode.expectSetting(true);
    await clickWithoutDialog(vscode, '1 tool');
    await vscode.expectSetting(map);
  });

  test('TS-USR-04 second turn-on skips our warning in firstTime mode', async ({ launchVsCode }) => {
    const vscode = await launchVsCode();
    await clickAndConfirm(vscode, 'Turn On');
    await clickWithoutDialog(vscode, 'Off');
    await clickWithoutDialog(vscode, 'On');
    await vscode.expectSetting(true);
    await clickWithoutDialog(vscode, 'Off');
    await vscode.expectSetting(undefined);
  });

  test('TS-USR-05 Esc, Cancel and the close button change nothing', async ({ launchVsCode }) => {
    const vscode = await launchVsCode();
    const before = vscode.readSettingsText();
    await clickAndConfirm(vscode, 'Escape');
    await vscode.expectItem('Off');
    await clickAndConfirm(vscode, 'Cancel');
    await vscode.expectItem('Off');
    await vscode.item.click();
    await vscode.dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(vscode.dialog).toBeHidden();
    await vscode.expectItem('Off');
    // Give any (wrong) write a chance to land before comparing bytes.
    await vscode.page.waitForTimeout(500);
    expect(vscode.readSettingsText()).toBe(before);
    await expectNoAutoApproveToast(vscode);
    await expect(vscode.statusBar).not.toContainText('Auto-approve is now');
  });

  test('TS-USR-06 confirmBeforeEnabling "always" asks on every status-bar turn-on; "never" does not ask', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode({ settings: { [CONFIRM]: 'always' } });
    await clickAndConfirm(vscode, 'Turn On');
    await vscode.expectItem('On');
    await clickWithoutDialog(vscode, 'Off');
    await clickAndConfirm(vscode, 'Turn On');
    await vscode.expectItem('On');
    await clickWithoutDialog(vscode, 'Off');

    const settings = vscode.readSettings();
    settings[CONFIRM] = 'never';
    vscode.writeSettings(settings);
    // VS Code's file watcher reloads settings.json asynchronously. Until it has, a click still asks ("always"):
    // cancel that dialog (state stays Off) and click again; once reloaded the click must turn on with no dialog.
    await expect(async () => {
      await vscode.item.click();
      // Wait for whichever comes first: our dialog (not reloaded yet) or the item turning On (reloaded).
      const on = vscode.statusBar.getByRole('button', { name: /^Copilot Auto-Approve: On\./ });
      await expect(vscode.dialog.or(on)).toBeVisible();
      if (await vscode.dialog.isVisible()) {
        await button(vscode, 'Cancel').click();
        await expect(vscode.dialog).toBeHidden();
        throw new Error('settings not reloaded yet: the "always" dialog was still shown');
      }
      await vscode.expectItem('On');
    }).toPass({ timeout: 20_000 });
    await expect(vscode.dialog).toHaveCount(0);
    await vscode.expectSetting(true);
    await clickWithoutDialog(vscode, 'Off');
  });

  test('TS-USR-14 showStatusBarItem applies live from the Settings UI', async ({ launchVsCode }) => {
    const vscode = await launchVsCode();
    await vscode.expectItem('Off');
    await vscode.runFromPalette('Preferences: Open User Settings');
    const editor = vscode.page.locator('.settings-editor');
    await expect(editor).toBeVisible();
    await vscode.page.keyboard.type(SHOW_ITEM);
    const checkbox = editor
      .locator('.setting-item-bool')
      .filter({ hasText: 'Show Status Bar Item' })
      .getByRole('checkbox');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();

    await checkbox.click();
    await expect(vscode.item).toBeHidden();
    await expect.poll(() => vscode.readSettings()[SHOW_ITEM]).toBe(false);

    await checkbox.click();
    await expect(vscode.item).toBeVisible();
    await vscode.expectItem('Off');
  });

  test('TS-QA-41 accessible: exactly one item by role + name in every reachable state; plain-sentence labels', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode();
    const states: [string, unknown][] = [
      ['Off', undefined],
      ['On', true],
      ['2 tools', { a: true, b: true }],
      ['Off', { a: false }],
    ];
    for (const [label, value] of states) {
      vscode.setAutoApprove(value);
      await vscode.expectItem(label);
      await expect(vscode.item).toHaveCount(1);
      const aria = (await vscode.item.getAttribute('aria-label')) ?? '';
      expect(aria).not.toMatch(/\$\(|\*\*|\[|\]\(/);
      expect(aria).toMatch(/\.$/);
      if (label === 'On') {
        await expect(vscode.itemContainer).toHaveClass(/warning-kind/);
      } else {
        await expect(vscode.itemContainer).not.toHaveClass(/warning-kind|error-kind/);
      }
    }
  });
});
