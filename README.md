# Copilot Auto-Approve Toggle

A one-click status bar switch for VS Code's built-in **global tool auto-approve** setting,
`chat.tools.global.autoApprove`. Turn it on when you want an agent session to run without "Allow" prompts; turn it off
again with one click, and your previous setting comes back exactly as it was.

The extension does not add any new capability. It only flips a setting VS Code already has — safely, visibly and
reversibly.

## ⚠️ Read this first

**Global auto-approve is dangerous.** VS Code's own description of this setting warns that it lets the agent run
**any** tool — terminal commands, file edits, web requests, MCP tools — **without asking**, in **every workspace**.
A prompt injection hidden in a file, web page or tool result could then act on your machine with your permissions.

- Only turn it on for work you are actively watching, in projects and sources you trust.
- Turn it off as soon as you are done. The status bar shows **On** on a warning-coloured background as a reminder.
- Prefer the narrower alternatives below when they are enough.
- If your organization has disabled auto-approve by policy, this extension respects that and does nothing.

## How it works

- Clicking the status bar item writes `"chat.tools.global.autoApprove": true` to your **user** settings (never to
  workspace settings). Turning it off restores the value you had before — removed, `false`, or a per-tool map.
- Before turning on, the extension shows its own warning (the first time by default; configurable).
- **VS Code then asks once more**, by design: on the first tool call after each turn-on, VS Code shows its own
  "Enable global auto approve?" dialog. VS Code resets that opt-in whenever the setting goes off, so you will see it
  again after every turn-on. This extension never bypasses, answers or suppresses that dialog.
- The extension watches the setting, so edits in `settings.json`, the Settings editor or another window show up in the
  status bar immediately.

## Status bar

| Shows                                                         | Meaning                                                                                                                                   | Click                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Shield icon, **Auto-Approve: Off**                            | Global auto-approve is off. Tools ask unless you've allowed them individually or a chat session uses a Bypass/Autopilot permission level. | Turn on (after the warning, if enabled).                    |
| Open-lock icon, **Auto-Approve: On**, warning background      | All tools run without asking, in all workspaces.                                                                                          | Turn off and restore your previous value.                   |
| Filter icon, **Auto-Approve: N tools** (or **1 tool**)        | Your settings contain a per-tool map with N tools auto-approved.                                                                          | Turn on for all tools; turning off later restores your map. |
| Lock icon, **Auto-Approve: On (Managed)**, warning background | Your organization's policy turns auto-approve on for all tools.                                                                           | Open the setting.                                           |
| Lock icon, **Auto-Approve: Managed**                          | Controlled by your organization's policy.                                                                                                 | Open the setting.                                           |
| Slashed-circle icon, **Auto-Approve: N/A**                    | This VS Code build doesn't have the setting.                                                                                              | Open the setting.                                           |

Hover the item for details and an **Open setting** link. If it shows **Managed** while your `settings.json` still
contains `true`, the tooltip offers to open `settings.json` (in a remote window: the remote `settings.json`) so you can
remove the leftover value.

## Commands

All commands are in the Command Palette under **Copilot Auto-Approve**.

| Command                             | ID                                     | Palette                               |
| ----------------------------------- | -------------------------------------- | ------------------------------------- |
| Toggle Auto-Approve for All Tools   | `copilotAutoApproveToggle.toggle`      | Always                                |
| Turn On Auto-Approve for All Tools  | `copilotAutoApproveToggle.enable`      | When not already on (hidden when N/A) |
| Turn Off Auto-Approve for All Tools | `copilotAutoApproveToggle.disable`     | When on                               |
| Open Auto-Approve Setting           | `copilotAutoApproveToggle.openSetting` | Always                                |
| Show Log                            | `copilotAutoApproveToggle.showLog`     | Always                                |

Turning **off** never asks for confirmation. Turning **on** from the Command Palette, a keybinding, a task or another
extension **always** shows the warning — only a click on the status bar item honours the
`confirmBeforeEnabling` setting. Other extensions and agent tools cannot use this extension's commands to turn
auto-approve on silently — those calls always show the warning.

## Settings

| Setting                                          | Default     | Description                                                                                                                                      |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `copilotAutoApproveToggle.confirmBeforeEnabling` | `firstTime` | When to show this extension's warning for status bar clicks: `firstTime`, `always` or `never`. VS Code's own prompt still applies in every case. |
| `copilotAutoApproveToggle.showStatusBarItem`     | `true`      | Show the toggle in the status bar. Applies immediately.                                                                                          |

Both are user-level (application) settings, so a workspace's `.vscode/settings.json` cannot change them — and cannot
turn auto-approve on either.

## Keybinding

There is no default keybinding. To add one, run **Preferences: Open Keyboard Shortcuts (JSON)** and add:

```json
[
  {
    "key": "ctrl+alt+y",
    "mac": "cmd+alt+y",
    "command": "copilotAutoApproveToggle.toggle"
  }
]
```

A keybinding counts as an external invocation: turning on this way always shows the warning, even with
`confirmBeforeEnabling` set to `never`.

## Organization policy

Administrators can control `chat.tools.global.autoApprove` with the `ChatToolsAutoApprove` policy (and GitHub Copilot
organization policies can disable it too). The extension never works around a policy:

- Before showing any dialog it checks whether user settings are writable (by writing back the current value unchanged).
  If policy blocks the write, it shows **Managed** and a short explanation, writes nothing and shows no risk dialog.
  When your setting is a per-tool map, the extension skips this check so your `settings.json` isn't reformatted before
  you confirm; a policy then blocks the real write after the warning, and nothing changes.
- If a policy forces the setting **on**, the status bar shows **On (Managed)** on a warning background ("Your
  organization's policy turns auto-approve on for all tools.") and clicking it only opens the setting.
- The extension checks again after you answer its warning: if the setting became managed (or unavailable) in the
  meantime, it writes nothing.
- **Known limitation — non-English VS Code:** policy errors are recognised by VS Code's English error text. On a
  localized VS Code build a policy rejection may be reported as "Could not change the auto-approve setting." followed by
  VS Code's original (localized) message, instead of the policy message. Nothing is written in either case.

## Remote windows

`chat.tools.global.autoApprove` is a machine-specific setting. In a remote window (SSH, WSL, Dev Containers,
Codespaces) the toggle changes the **remote** machine's user settings; your local windows keep their own value. The
status bar in each window reflects the machine that window is connected to. The setting is not synced by Settings Sync.
The remembered previous value is stored separately for each machine, so local and remote windows never overwrite each
other's saved value. The warning says so: "in every workspace on this machine (in a remote window: on that remote
machine)".

## Alternatives

If you don't need everything auto-approved, consider:

- **Per-tool approval** — the **Allow** button on a tool confirmation offers options to allow that tool for the session,
  the workspace, or always.
- **`chat.tools.terminal.autoApprove`** — rules that auto-approve only specific terminal commands (and deny others).
- **Session-level permissions in the Chat view** (for example `/yolo`, where available) — affect only the current chat
  session.

## FAQ

**Why does VS Code still ask "Enable global auto approve?" after I turned it on?**
That is VS Code's own safety prompt. It appears on the first tool call after each turn-on and is expected.

**Why did the warning appear even though I set `confirmBeforeEnabling` to `never`?**
You turned it on from the Command Palette, a keybinding or another extension. Those always warn; only status bar
clicks skip it.

**What happens to my previous value?**
It is remembered when you turn on and restored when you turn off from the extension. If you turn auto-approve off some
other way (editing `settings.json`, another window), the remembered value is discarded because it would be stale.

**What does "N tools" mean?**
Your `chat.tools.global.autoApprove` contains a map like `{ "toolId": true }` that auto-approves only those tools.
The extension never edits the map; turning on replaces it with `true`, and turning off puts the map back.

**Why does it say "Managed"?**
Your organization's policy controls the value (or your `settings.json` says `true` but a policy overrides it). If the
policy forces auto-approve on, it says **On (Managed)**. Hover the item for details.

**Does uninstalling turn auto-approve off?**
No. Uninstalling or disabling the extension leaves the setting as it is. Turn it off first if you want it off.

**Does it work without a folder open, or in Restricted Mode?**
Yes. The setting lives in user settings, so workspace trust and open folders don't matter.

## Privacy

No telemetry. No network requests. The extension stores two kinds of values in VS Code's extension storage (your
previous setting value while auto-approve is on — one per machine/remote — and whether you've accepted the warning) and
writes a log you can view with
**Copilot Auto-Approve: Show Log**. The log contains states and outcomes, never your setting values.

## Requirements

- VS Code **1.104.0** or later.
- GitHub Copilot Chat (agent mode) for the setting to have any effect.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for building, testing (unit, integration, policy, E2E, mutation) and the
sandboxed user-acceptance run (`npm run uat`). Design notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the
test plan in [docs/TEST-STRATEGY.md](docs/TEST-STRATEGY.md) and [docs/TEST-SCENARIOS.md](docs/TEST-SCENARIOS.md).
Security issues: see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
