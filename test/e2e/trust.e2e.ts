import { expect, test } from './vscode';

test.describe('workspace trust (E2E)', () => {
  test('TS-ADM-09 Restricted Mode: the extension is active and toggles on and off normally', async ({
    launchVsCode,
  }) => {
    // Trust enabled, folder never trusted, no startup prompt ⇒ the window opens in Restricted Mode.
    const vscode = await launchVsCode({ workspaceTrust: true });
    await expect(vscode.page.locator('[id="status.workspaceTrust"]')).toBeVisible();
    await expect(vscode.statusBar).toContainText('Restricted Mode');

    await vscode.expectItem('Off');
    await vscode.item.click();
    await expect(vscode.dialog).toBeVisible();
    await vscode.dialog.getByRole('button', { name: 'Turn On', exact: true }).click();
    await vscode.expectItem('On');
    await vscode.expectSetting(true);

    await vscode.item.click();
    await vscode.expectItem('Off');
    await expect(vscode.dialog).toHaveCount(0);
    await vscode.expectSetting(undefined);
  });
});
