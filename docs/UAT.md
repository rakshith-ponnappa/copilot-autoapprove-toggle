# Live User Acceptance Testing (UAT)

A human tester uses the packaged extension in a disposable VS Code sandbox and decides whether it is safe and clear
enough to ship. Automated tests prove the logic; UAT proves the experience. Check IDs match `TS-UAT-*` in
[TEST-SCENARIOS.md](TEST-SCENARIOS.md).

## 1. Start the sandbox

```sh
npm ci            # once
npm run uat       # build, package, download VS Code, install the VSIX, launch
```

What `npm run uat` does (`scripts/uat.mjs`):

1. Builds the production bundle and packages `artifacts/copilot-autoapprove-toggle-<version>.vsix`.
2. Downloads VS Code (stable by default) with `@vscode/test-electron` — your installed VS Code is not used.
3. Installs the VSIX into `.uat/extensions`.
4. Launches VS Code with `--user-data-dir .uat/user-data`, `--extensions-dir .uat/extensions`, `HOME` (and
   `USERPROFILE`) set to `.uat/home`, `--locale=en`, opening the scratch folder `.uat/workspace`.
5. Prints the path to this checklist.

| Option                             | Effect                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run uat -- --reset`           | Delete `.uat/` first (fresh profile, no acknowledgement stored).                                               |
| `npm run uat -- --version 1.104.0` | Test a specific VS Code version (`stable`, `insiders`, or a number).                                           |
| `npm run uat -- --no-launch`       | Prepare everything but don't launch.                                                                           |
| `npm run uat -- --dev`             | Launch an isolated Extension Development Host from source (used by F5 "Run Extension"; debugger on port 9333). |

Your real VS Code profile, extensions, settings and `~/.vscode` are never touched. **macOS caveat:** Cocoa ignores
`$HOME`, and the sandbox VS Code shares the real app's bundle id, so app-level files such as
`~/Library/Preferences/com.microsoft.VSCode.plist` and `~/Library/Saved Application State` may be shared; your
settings, extensions and `~/.vscode` are still not touched. "User settings" below means the
**sandbox's** settings (`.uat/user-data/User/settings.json`); open it with **Preferences: Open User Settings (JSON)**.

> **Expected, not a bug:** after every turn-on, the first time the agent wants to run a tool VS Code shows its own
> dialog, **"Enable global auto approve?"**. That is VS Code's built-in safety prompt. VS Code clears that opt-in
> whenever the setting goes off, so it asks again after each turn-on. This extension never bypasses or answers it.

Checks 06 and 08 need the agent to run a tool, which requires signing in to GitHub Copilot inside the sandbox. Use a
test account if you have one, sign out afterwards, and run `npm run uat -- --reset` when done. If you can't sign in,
mark those checks **N/A** with a note.

## 2. Checklist

Start from a fresh sandbox (`npm run uat -- --reset`). Record **Pass**, **Fail** or **N/A**; add notes for anything
surprising, even on a pass.

| ID        | Pri | Steps                                                                                                                                                                                                               | Expected result                                                                                                                                                                                                                                                                                                                              | Pass/Fail | Notes |
| --------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| TS-UAT-01 | P0  | Run `npm run uat`. Open the Extensions view and search `@installed auto-approve`.                                                                                                                                   | Sandbox opens `.uat/workspace`. "Copilot Auto-Approve Toggle" is installed at the expected version. Your normal VS Code windows and settings are unchanged.                                                                                                                                                                                  |           |       |
| TS-UAT-02 | P1  | Look at the right side of the status bar; hover the item; click **Open setting** in the tooltip.                                                                                                                    | Item shows a shield and **Auto-Approve: Off**, normal colours. Tooltip says "Global auto-approve is off. Tools ask unless you've allowed them individually or a chat session uses a Bypass/Autopilot permission level." and how to turn it on. The link opens Settings filtered to `chat.tools.global.autoApprove`.                          |           |       |
| TS-UAT-03 | P0  | Click the item. Read the dialog.                                                                                                                                                                                    | A modal warning, "Turn on auto-approve for all agent tools?", explains that all tools will run without asking, in every workspace on this machine (in a remote window: on that remote machine), until you turn it off, and that VS Code will ask once more. Buttons: **Turn On** and **Cancel**. You understand the risk without other docs. |           |       |
| TS-UAT-04 | P0  | Press **Cancel** (repeat with **Esc**). Check user settings.                                                                                                                                                        | Item still **Off**. No notification. `settings.json` unchanged.                                                                                                                                                                                                                                                                              |           |       |
| TS-UAT-05 | P0  | Click the item, choose **Turn On**. Check user settings.                                                                                                                                                            | Item shows an open lock and **Auto-Approve: On** on a warning-coloured background. `"chat.tools.global.autoApprove": true` is in user settings (not in `.uat/workspace/.vscode`). A short status bar message appears; no pop-up notification.                                                                                                |           |       |
| TS-UAT-06 | P1  | In Chat (agent mode), ask for something that needs a tool (e.g. "list the files in this folder").                                                                                                                   | VS Code shows its own **"Enable global auto approve?"** dialog once. Accept it; further tool calls run without "Allow" prompts. (Expected — see the note above.)                                                                                                                                                                             |           |       |
| TS-UAT-07 | P0  | Click the item while it is **On**. Check user settings.                                                                                                                                                             | Turns **Off** immediately with no dialog. The key is gone from `settings.json` (it was absent before), i.e. your previous value is restored exactly.                                                                                                                                                                                         |           |       |
| TS-UAT-08 | P1  | Click the item again. Then repeat the agent request from 06.                                                                                                                                                        | No extension dialog this time (default `firstTime` remembers you accepted). VS Code's own prompt appears again on the first tool call.                                                                                                                                                                                                       |           |       |
| TS-UAT-09 | P1  | Open the Command Palette and type `Copilot Auto-Approve`, once while **On** and once while **Off**.                                                                                                                 | **On**: "Turn Off …" listed, "Turn On …" hidden. **Off**: the reverse. "Toggle …", "Open Auto-Approve Setting" and "Show Log" are always listed.                                                                                                                                                                                             |           |       |
| TS-UAT-10 | P0  | While **Off**, run **Turn On Auto-Approve for All Tools** from the palette. Then add the keybinding from the README (`ctrl+alt+y` → toggle), turn off, and press the key.                                           | The warning dialog appears both times even though you already accepted it once — only a status bar click can skip it.                                                                                                                                                                                                                        |           |       |
| TS-UAT-11 | P1  | Set **Copilot Auto-Approve Toggle › Confirm Before Enabling** to `always`, turn on via the status bar twice (off in between). Then set `never` and repeat. Then use the palette with `never`.                       | `always`: dialog every status-bar turn-on. `never`: no extension dialog from the status bar. Palette still warns with `never`. VS Code's own prompt is unaffected by this setting.                                                                                                                                                           |           |       |
| TS-UAT-12 | P2  | Untick **Show Status Bar Item**; then tick it again.                                                                                                                                                                | Item disappears and comes back immediately, no reload. Commands keep working while hidden.                                                                                                                                                                                                                                                   |           |       |
| TS-UAT-13 | P0  | While **Off**, put `"chat.tools.global.autoApprove": { "exampleToolA": true, "exampleToolB": true }` in user settings. Note the item. Turn on, then off.                                                            | Item shows a filter icon and **Auto-Approve: 2 tools**; with one entry it says **1 tool**. After on→off the exact map is back in `settings.json`.                                                                                                                                                                                            |           |       |
| TS-UAT-14 | P1  | Open a second sandbox window (**File › New Window**). In window 1 toggle on and off; then hand-edit user settings to `true` and to `false`.                                                                         | Both windows' status bar items follow every change within a second, without reload.                                                                                                                                                                                                                                                          |           |       |
| TS-UAT-15 | P1  | While **Off**, double- and triple-click the item quickly. Also try clicking while the dialog is open.                                                                                                               | At most one dialog; one state change; one status bar message (never one per click); the item never flickers to a wrong state.                                                                                                                                                                                                                |           |       |
| TS-UAT-16 | P1  | (a) **File › New Window** with no folder: toggle on/off. (b) Enable `security.workspace.trust.enabled`, open a new folder, choose **Don't Trust** (Restricted Mode), toggle on/off.                                 | Works the same in both.                                                                                                                                                                                                                                                                                                                      |           |       |
| TS-UAT-17 | P1  | Add a syntax error to user `settings.json` (e.g. a trailing `{`), save, and turn on via the palette. Click **Show Log**. Fix the file afterwards.                                                                   | A warning notification shows VS Code's error text with **Open Setting** and **Show Log**; no risk dialog first; nothing changes. The log ("Copilot Auto-Approve Toggle" output) explains the failure without dumping your settings.                                                                                                          |           |       |
| TS-UAT-18 | P1  | Turn on a screen reader (VoiceOver: Cmd+F5; NVDA/Narrator on Windows). Use **F6**/Tab to reach the status bar and arrow to the item; activate with Enter/Space. Switch to **High Contrast** theme and repeat 05/07. | The screen reader announces a plain sentence (e.g. "Auto-approve is off …") without icon names. Item is operable by keyboard. Text and warning background are legible in High Contrast (light and dark).                                                                                                                                     |           |       |
| TS-UAT-19 | P2  | Run **Developer: Show Running Extensions**; run **Copilot Auto-Approve: Show Log**; open **Help › Toggle Developer Tools** › Console.                                                                               | Activation time for this extension is small (target < 50 ms); the log ("Copilot Auto-Approve Toggle" output) has an `Activated in N ms (state: …)` line that agrees. No errors or warnings from this extension in the console.                                                                                                               |           |       |
| TS-UAT-20 | P1  | Turn **On**, then disable or uninstall the extension and reload. Check user settings. Re-enable it.                                                                                                                 | The setting stays `true` (the extension doesn't change anything on uninstall — as stated in the README). After re-enabling, the item shows **On** correctly.                                                                                                                                                                                 |           |       |

## 3. Exploratory charters

Time-boxed, session-based testing. Note what you tried, what you saw, and any question that came up. Charters don't
need a pass/fail per step — the output is notes and bug reports.

**Charter U — End user (30 min).** _Explore everyday use of the toggle to discover anything confusing, slow or
surprising._ Ideas: use it alongside a real agent session; turn it off mid-task; restart VS Code in each state; read
every tooltip and message as someone new to auto-approve; try light/dark/high-contrast themes and a narrow window.

**Charter A — Admin / IT (30 min).** _Explore managed and multi-machine setups to discover cases where the extension
misreports who is in control._ Ideas:

- **Remote window** (needs Remote-SSH/WSL/Dev Containers installed in the sandbox): toggling in a remote window writes the
  **remote** machine's user settings (Settings editor → **Remote** tab); the local window is unaffected; the item in
  each window reflects its own machine. Turn on in the local window, turn on in the remote window, then turn off in
  each: each window restores its **own** previous value (the remembered value is stored per machine). If a policy makes
  the remote item **Managed** while the remote `settings.json` still has `true`, the tooltip link opens the **remote**
  settings file.
- **Settings Sync**: if you can sign in to Settings Sync in the sandbox, confirm `chat.tools.global.autoApprove` is not
  synced to another profile/machine.
- **Organization policy** (only on a machine you are allowed to manage, or a Copilot Business test account whose
  policy disables auto-approve): the item shows `$(lock)` **Auto-Approve: Managed** ("Controlled by your organization's
  policy."), no risk dialog appears, nothing is written, and the tooltip tells you to remove a leftover `true` if
  present. A policy that forces auto-approve **on** shows **Auto-Approve: On (Managed)** on a warning background ("Your
  organization's policy turns auto-approve on for all tools."); clicking only opens the setting. On a non-English VS
  Code build a policy rejection may instead show "Could not change the auto-approve setting." with VS Code's localized
  message (known limitation).
- Older/newer VS Code: `npm run uat -- --reset --version 1.104.0`; `--version 1.103.2` must refuse to install.

**Charter Q — Professional QA (45 min).** _Explore hostile inputs and timing to break the state shown in the status
bar._ Ideas: odd values in settings (`"true"`, `1`, `null`, `[true]`, `{"x": "true"}`, `{"__proto__": true}`, a map with
hundreds of entries); edit settings while the dialog is open; toggle from two windows at once; delete
`.uat/user-data/User/globalStorage` between runs; run commands from **Developer: Run Command** with odd arguments.

## 4. Reporting a bug

1. Check it isn't the expected VS Code prompt described above.
2. Capture: steps, expected vs actual, screenshot or short recording, and the log (**Copilot Auto-Approve: Show Log**).
   Remove anything personal before attaching.
3. Note the environment: OS, VS Code version (**Help › About**), extension version, check ID.
4. Open a GitHub issue using the bug template, with the check ID (e.g. `TS-UAT-13`) in the title. **Security problems**
   (e.g. something enables auto-approve without the warning) go through a private advisory instead — see
   [SECURITY.md](../SECURITY.md).
5. Suggest a severity using [TEST-STRATEGY.md § Defect severity](TEST-STRATEGY.md#defect-severity).

## 5. Sign-off

Release requires all P0/P1 checks passed (or N/A with justification) and no open Sev-1/Sev-2 defects.

| Field                        | Value                                               |
| ---------------------------- | --------------------------------------------------- |
| Tester                       |                                                     |
| Date                         |                                                     |
| OS and version               |                                                     |
| VS Code version              |                                                     |
| Extension build / VSIX file  |                                                     |
| Commit                       |                                                     |
| Checks passed / failed / N/A |                                                     |
| Charters run (U / A / Q)     |                                                     |
| Defects raised (IDs)         |                                                     |
| **Verdict**                  | ☐ Accept ☐ Accept with known issues (list) ☐ Reject |
| Signature                    |                                                     |
