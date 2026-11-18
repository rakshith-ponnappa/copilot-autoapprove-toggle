import { AUTO_APPROVE, expect, test, type VsCodeSession } from './vscode';

const PREFIX = 'Copilot Auto-Approve: ';
const TURN_ON = `${PREFIX}Turn On Auto-Approve for All Tools`;
const TURN_OFF = `${PREFIX}Turn Off Auto-Approve for All Tools`;
const TOGGLE = `${PREFIX}Toggle Auto-Approve for All Tools`;
const OPEN_SETTING = `${PREFIX}Open Auto-Approve Setting`;
const SHOW_LOG = `${PREFIX}Show Log`;

/** This extension's commands currently offered by the Command Palette. */
async function paletteCommands(session: VsCodeSession): Promise<string[]> {
  await session.openPalette('Copilot Auto-Approve:');
  // Let the list settle on the filtered result.
  await expect(session.paletteRows().filter({ hasText: SHOW_LOG })).toHaveCount(1);
  const rows = await session.paletteRows().allInnerTexts();
  await session.closePalette();
  const all = [TURN_ON, TURN_OFF, TOGGLE, OPEN_SETTING, SHOW_LOG];
  return all.filter((label) => rows.some((row) => row.includes(label)));
}

test.describe('command palette (E2E)', () => {
  test('TS-USR-08 the palette offers the right commands in Off, On and Custom', async ({ launchVsCode }) => {
    const vscode = await launchVsCode();
    await vscode.expectItem('Off');
    expect(await paletteCommands(vscode)).toEqual([TURN_ON, TOGGLE, OPEN_SETTING, SHOW_LOG]);

    vscode.setAutoApprove(true);
    await vscode.expectItem('On');
    expect(await paletteCommands(vscode)).toEqual([TURN_OFF, TOGGLE, OPEN_SETTING, SHOW_LOG]);

    vscode.setAutoApprove({ someTool: true });
    await vscode.expectItem('1 tool');
    expect(await paletteCommands(vscode)).toEqual([TURN_ON, TOGGLE, OPEN_SETTING, SHOW_LOG]);
  });

  test('TS-USR-07 palette Turn On always shows our modal (even with ack stored and confirm "never")', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode({ settings: { 'copilotAutoApproveToggle.confirmBeforeEnabling': 'never' } });
    // Store the acknowledgement through a confirmed palette turn-on, then turn off from the palette (no dialog).
    await vscode.runFromPalette(TURN_ON);
    await expect(vscode.dialog).toBeVisible();
    await vscode.dialog.getByRole('button', { name: 'Turn On', exact: true }).click();
    await vscode.expectItem('On');
    await vscode.runFromPalette(TURN_OFF);
    await vscode.expectItem('Off');
    await expect(vscode.dialog).toHaveCount(0);

    // Again: still asks.
    await vscode.runFromPalette(TURN_ON);
    await expect(vscode.dialog).toBeVisible();
    await vscode.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await vscode.expectItem('Off');

    // Toggle from the palette (what a keybinding sends) asks too.
    await vscode.runFromPalette(TOGGLE);
    await expect(vscode.dialog).toBeVisible();
    await vscode.dialog.getByRole('button', { name: 'Turn On', exact: true }).click();
    await vscode.expectItem('On');
    await vscode.expectSetting(true);
  });

  test('TS-USR-16 Open Setting filters the Settings editor; Show Log reveals the output channel', async ({
    launchVsCode,
  }) => {
    const vscode = await launchVsCode();
    await vscode.runFromPalette(OPEN_SETTING);
    const editor = vscode.page.locator('.settings-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.settings-header .view-lines')).toContainText(AUTO_APPROVE);
    await expect(editor.locator('.setting-item-contents').filter({ hasText: 'Auto Approve' }).first()).toBeVisible();
    // Recent builds show Settings as a modal overlay that keeps keyboard shortcuts to itself; close it first.
    await vscode.page.keyboard.press('Escape');
    if (await editor.isVisible()) {
      await vscode.page.keyboard.press('ControlOrMeta+KeyW');
    }
    await expect(editor).toBeHidden();

    await vscode.runFromPalette(SHOW_LOG);
    const panel = vscode.page.locator('.part.panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.view-lines')).toContainText('Activated in');
  });
});
