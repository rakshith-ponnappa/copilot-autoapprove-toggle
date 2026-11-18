# Security Policy

## Supported versions

| Version        | Supported          |
| -------------- | ------------------ |
| 0.1.x (latest) | ✅                 |
| Older          | ❌ — please update |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub: open the repository's **Security** tab → **Report a vulnerability** (GitHub Security
Advisories). Include the extension version, VS Code version, OS, steps to reproduce and the impact you expect. Remove
personal data and secrets from logs before attaching them.

You can expect an acknowledgement within 5 working days and a status update at least every 14 days until the issue is
resolved. Fixes are released as a patch version with a GitHub Security Advisory; reporters are credited unless they
prefer otherwise.

Particularly relevant reports:

- Any way to turn global auto-approve on without the warning that the extension promises (for example from another
  extension, a workspace file, a keybinding, or a crafted command argument).
- Any way the extension works around organization policy or VS Code's own "Enable global auto approve?" prompt.
- Turning off reporting success while tools are still auto-approved.
- Code execution through the status bar tooltip links.
- Any network access or data collection.

## Threat model summary

**What the extension does:** it reads and writes one setting, `chat.tools.global.autoApprove`, in your user settings,
and stores two kinds of values in its own extension storage (your previous value while auto-approve is on — one entry
per settings target, `copilotAutoApproveToggle.stash.v1/<targetId>` — and whether you accepted its warning). Its
public API in production is exactly `{ getState }` (read-only); a test-only nonce is exported only when VS Code runs
the extension in test mode (`ExtensionMode.Test`).

**What it protects against:**

| Threat                                                                                              | Mitigation                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another extension or an agent tool silently enabling auto-approve through this extension's commands | Any command invocation that doesn't come from the status bar item (which carries an in-memory, per-session nonce) always shows the modal warning.                                                                               |
| A malicious repository enabling auto-approve or disabling the warning via `.vscode/settings.json`   | The auto-approve setting and both extension settings are user-level only; workspace values are ignored by VS Code.                                                                                                              |
| Working around administrator intent                                                                 | Organization policy is detected before any dialog (except when your setting is a per-tool map, where the policy is detected on the actual write) and re-checked after it; the extension reports **Managed** and writes nothing. |
| Losing track of the risky state                                                                     | The status bar shows **On** with a warning background; the tooltip repeats the risk.                                                                                                                                            |
| Restoring a stale or wrong value                                                                    | The remembered value is stored per machine (local or each remote) and discarded when the setting is changed elsewhere.                                                                                                          |
| Tooltip links running arbitrary commands                                                            | The tooltip only trusts four commands: open this setting, toggle, open `settings.json`, and open the remote `settings.json`.                                                                                                    |
| Data leaving your machine                                                                           | No telemetry and no network code; logs never contain setting values.                                                                                                                                                            |

**What it does not protect against:**

- **The risk of auto-approve itself.** Once on, the agent can run any tool without asking in every workspace. A prompt
  injection in a file, web page or tool output can then act with your permissions. Only VS Code's own safeguards and
  your judgement apply.
- Anything that edits `settings.json` directly (you, another extension, a script) — VS Code then enables auto-approve
  without this extension's warning. The extension just shows the new state.
- A compromised VS Code installation, extension host, or another malicious extension with full API access.
- Organization policies on localized VS Code builds are still enforced, but may be reported as a generic write
  failure ("Could not change the auto-approve setting." plus VS Code's localized message) rather than **Managed**.
