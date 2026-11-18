# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - Unreleased

Initial release.

### Added

- Status bar item showing the state of `chat.tools.global.autoApprove`: Off, On, N tools (per-tool map), Managed
  (organization policy in control), On (Managed) (policy forces auto-approve on; warning background) and N/A (setting
  not available, VS Code older than 1.104).
- One-click toggle. Turning on writes `true` to user settings; turning off restores the exact previous value (absent,
  `false` or a per-tool map).
- Risk warning before turning on. Status bar clicks follow `copilotAutoApproveToggle.confirmBeforeEnabling`
  (`firstTime`, `always`, `never`); Command Palette, keybindings and other extensions always get the warning.
- Policy detection before any dialog and again after it: when organization policy blocks the setting, the extension
  shows Managed and changes nothing. Per-tool maps are never rewritten before you confirm.
- Safe failure handling: if the previous value can't be stored, nothing is written; a failed turn-off keeps the
  remembered value; warnings include VS Code's own error text when there is one.
- Commands: Toggle, Turn On, Turn Off, Open Auto-Approve Setting, Show Log. Turn On/Turn Off are shown in the Command
  Palette only when they apply.
- Setting `copilotAutoApproveToggle.showStatusBarItem` (applies live).
- Remote-aware: the previous value is remembered per machine (local or each remote), so local and remote windows never
  overwrite each other; tooltips link the remote `settings.json` in remote windows.
- Rapid double-clicks are coalesced into one change with one notification.
- Log output channel ("Copilot Auto-Approve Toggle"), including activation time. No telemetry, no network access.
  The production API exports only a read-only `getState()`.

### Known limitations

- On non-English VS Code builds a policy rejection may be reported as a generic write failure (with VS Code's
  localized message) instead of Managed. Nothing is written either way.
