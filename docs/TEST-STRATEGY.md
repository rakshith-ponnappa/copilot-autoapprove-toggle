# Test Strategy

How Copilot Auto-Approve Toggle is tested, by whom, with what, and when a build is good enough to ship. The scenarios
themselves live in [TEST-SCENARIOS.md](TEST-SCENARIOS.md); the manual checklist is [UAT.md](UAT.md).

## Why this extension needs a strict test bar

The extension flips a setting that lets an AI agent run any tool without asking. A bug that turns it on silently, fails
to turn it off, or loses the user's previous value is a safety defect, not a cosmetic one. The strategy therefore puts
most weight on the pure decision logic (fast, exhaustive, generative) and proves the risky edges (policy, real UI,
real settings files) in real VS Code.

## Test pyramid

```text
                 ┌──────────────────────┐
                 │  Live UAT (manual)   │  20 checks + charters, signed off per release
                 ├──────────────────────┤
                 │  E2E (Playwright)    │  real status bar click, real modal, settings.json
                 ├──────────────────────┤
                 │ Policy CI (Linux)    │  canary + locked /etc/vscode/policy.json
                 ├──────────────────────┤
                 │ Integration          │  real extension host, isolated profile, 1.104.0 + stable
                 ├──────────────────────┤
                 │ Unit + property +    │  pure core, presentation, adapters with a vscode mock,
                 │ static + mutation    │  fast-check chaos, manifest/VSIX/safety checks
                 └──────────────────────┘
```

Rule of thumb: if a behaviour can be decided in `src/core` or `src/ui/presentation.ts`, it is tested there; higher
layers only prove the wiring and the parts that need the real product (policy, dialogs, files, UI).

**Integration limits.** Integration tests cannot click the status bar or answer real modal dialogs: VS Code refuses
modal dialogs under `--extensionTestsPath`. In `ExtensionMode.Test` only, the extension exports
`testing.statusBarNonce`; integration tests invoke `copilotAutoApproveToggle.toggle` with that nonce and
`confirmBeforeEnabling = never`, so no dialog is needed (where a request must be observed, `window.showWarningMessage`
is replaced by a recording stub). Paths that accept or decline the real confirmation dialog are covered by unit tests
(fake `ConfirmPort`) and E2E (Playwright, real modal). Production exports exactly `{ getState }` (TS-QA-55).

## Personas and responsibilities

| Persona          | Focus                                                                                                              | Primary layers                       | Scenario IDs |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------ |
| AI / adversarial | Generative and chaos testing, invariants I1–I8, hostile values and callers                                         | property, unit, integration          | `TS-AI-*`    |
| End user         | What a developer sees: status bar, palette, warning, feedback, live updates                                        | e2e, integration                     | `TS-USR-*`   |
| Admin / IT       | Policy, managed machines, remote, trust, sync, versions, machine hygiene                                           | policy-CI, integration, unit, static | `TS-ADM-*`   |
| Professional QA  | Spec conformance step by step, boundaries, error injection, concurrency, a11y, compat, l10n, perf, security, gates | unit, static, mutation, integration  | `TS-QA-*`    |
| Live user (UAT)  | A human uses the packaged VSIX in a sandbox and judges clarity and safety                                          | manual-UAT                           | `TS-UAT-*`   |

Team roles: **test-eng** automates every non-manual scenario; **QA lead** owns the catalogue, this strategy and UAT
sign-off; **core-dev** keeps unit coverage green while implementing; **devops** wires the layers into CI; the
**technical supervisor** reviews traceability and gate results before release.

## Invariants

Every property and chaos test checks these after each step (see [TEST-SCENARIOS.md](TEST-SCENARIOS.md#traceability)):

| ID  | Invariant                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | After a successful disable, the effective value is not `true`.                                                                                                                                                |
| I2  | Enable then disable restores the exact prior user value on the same target (absent stays absent); holds per target — each target has its own stash key, so local and remote windows never clobber each other. |
| I3  | A stash never survives an external disable or a target mismatch.                                                                                                                                              |
| I4  | No unhandled promise rejections, ever.                                                                                                                                                                        |
| I5  | Controller state always equals `resolveState(fresh read, sticky)`.                                                                                                                                            |
| I6  | N rapid toggles while one is pending produce exactly one state change and one notification.                                                                                                                   |
| I7  | Enabling from an `external` origin always shows the confirmation.                                                                                                                                             |
| I8  | Policy-locked ⇒ no dialog and nothing written except the identity probe (when a probe applies).                                                                                                               |

## Tools per layer

| Layer       | Tooling                                                                                              | Location                                          | Runs in                   |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| unit        | Vitest 4, `@vitest/coverage-v8`; `vscode` module mocked via a Vitest alias for adapter tests         | `test/unit/**/*.test.ts`                          | Node, every OS            |
| property    | fast-check 4 (`fc.assert`, `fc.commands` model-based runs), seeded                                   | `test/unit/**/*.property.test.ts`                 | Node                      |
| static      | Vitest tests reading files, manifest, bundle and VSIX; CI grep step                                  | `test/unit/static/**`, `.github/workflows/ci.yml` | Node / CI                 |
| integration | `@vscode/test-cli` + `@vscode/test-electron`, Mocha, label `integration`; test-mode nonce, no modals | `test/integration/**` → `out/`                    | Real VS Code              |
| policy-CI   | Same harness, label `policy`, `POLICY_PHASE=canary\|locked`                                          | `test/policy/**`                                  | Linux CI only             |
| e2e         | Playwright `_electron` against a downloaded VS Code, `"window.dialogStyle": "custom"`                | `test/e2e/**`                                     | Linux CI (local optional) |
| mutation    | Stryker with the Vitest runner on `src/core/**` + `src/ui/presentation.ts`                           | `stryker.config.mjs`                              | Weekly + manual CI        |
| manual-UAT  | `npm run uat` sandbox + [UAT.md](UAT.md)                                                             | `.uat/`                                           | Tester's machine          |

## Environments and version matrix

| Dimension       | Values                                                                 | Notes                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code         | `1.104.0` (minimum, `engines ^1.104.0`), `stable`                      | Linux job on 1.104.0; all OSes on stable. Insiders is exploratory only.                                                                                                          |
| OS              | ubuntu-latest, macos-latest, windows-latest                            | Integration on Linux runs under `xvfb`.                                                                                                                                          |
| Node            | 22 in CI (`.nvmrc`), 20.20 works locally                               |                                                                                                                                                                                  |
| Locale          | `--locale=en` for every automated launch                               | Localized messages are covered in unit tests (TS-QA-46). Known limitation: on non-English builds a policy rejection may surface as `write-failed` (raw localized message shown). |
| Policy          | Linux CI only                                                          | macOS/Windows stable builds always read native policy (MDM/registry), which tests must not change.                                                                               |
| Workspace trust | Disabled by `@vscode/test-electron`; enabled in the E2E trust scenario | TS-ADM-09.                                                                                                                                                                       |
| Window shapes   | Folder open, empty window, two windows (UAT), remote (UAT charter)     |                                                                                                                                                                                  |

## Isolation guarantees

No test or script may touch the tester's real VS Code profile, extensions or home directory. macOS caveat: Cocoa
ignores `$HOME` and downloaded VS Code builds share the real app's bundle id, so app-level files such as
`~/Library/Preferences/com.microsoft.VSCode.plist` and `~/Library/Saved Application State` may be shared; settings,
extensions and `~/.vscode` are not touched.

- Every launched VS Code gets its own `--user-data-dir` and `--extensions-dir` under `.vscode-test/`, `.uat/` or a
  temp directory inside the project.
- `HOME` (and `USERPROFILE` on Windows) is overridden to a project-local temp folder, because VS Code reads and creates
  `~/.vscode/argv.json` regardless of `--user-data-dir`.
- `--locale=en` is always passed; integration runs also pass `--disable-extensions`.
- The system `code` CLI is never invoked; VS Code builds are downloaded by `@vscode/test-electron`.
- F5 ("Run Extension" in `.vscode/launch.json`) does not open a normal Extension Development Host — that window would
  share the developer's real profile and their real `chat.tools.global.autoApprove`. It runs `scripts/uat.mjs --dev`,
  which launches a separate sandboxed VS Code (`--user-data-dir=.vscode-test/dev-profile`) with the extension loaded
  from source and the debugger attached on port 9333.
- Processes started by scripts are stopped by PID — never `pkill`/`killall`.
- Policy tests only run where `/etc/vscode/policy.json` belongs to a disposable CI runner, and CI removes it in an
  `always()` step.
- Integration setup detects a machine policy already present (org-managed laptops) and skips with a clear message
  (TS-ADM-06).
- Tests never trigger agent tool calls and never automate VS Code's own "Enable global auto approve?" dialog.

TS-ADM-15 checks these rules statically.

## Running each layer

| Layer                               | Locally                                                                                                                                            | In CI                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Typecheck, lint, format             | `npm run typecheck`, `npm run lint`, `npm run format:check` (or `npm run check`)                                                                   | Every OS                                   |
| Unit + property + static + coverage | `npm run test:unit` (`FC_SEED=<n>` reproduces a failure; `FC_NUM_RUNS` raises effort)                                                              | Every OS, `FC_NUM_RUNS=1000`               |
| Integration                         | `npm run test:integration` runs both labels: `integration` (folder open) and `integration-empty-window` (no folder); skips on org-managed machines | Every OS on stable; Linux on 1.104.0       |
| Policy                              | `npm run test:policy` prints `SKIPPED: policy tests run only in Linux CI` and exits 0                                                              | Linux job: canary phase, then locked phase |
| E2E                                 | `npm run test:e2e` opens visible VS Code windows locally — don't type or click elsewhere while it runs (CI uses `xvfb`)                            | Linux job                                  |
| Mutation                            | `npx stryker run` (a `test:mutation` script is requested)                                                                                          | `mutation.yml`: weekly + manual            |
| Package                             | `npm run package` → `artifacts/*.vsix`                                                                                                             | Every push; VSIX uploaded as an artifact   |
| UAT                                 | `npm run uat` (`--reset`, `--version <x>`, `--no-launch`)                                                                                          | Not in CI; required before release         |

## Entry and exit criteria

**Entry (a layer may start):**

- Unit/property: the frozen contract (`src/core/types.ts`, `src/constants.ts`) is in place.
- Integration/E2E: `npm run compile` and `npm run compile-tests` succeed; unit layer green.
- Policy CI: canary phase green before the locked phase runs (a red canary invalidates the locked result).
- UAT: CI green on the release commit; VSIX built from that commit.

**Exit (release is allowed when all hold):**

| Criterion           | Threshold                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Automated scenarios | 100% of P0 and P1 scenarios automated and passing on every matrix cell; P2 passing or waived in the PR                         |
| Coverage            | ≥ 95% lines, branches, functions, statements on `src/core/**` + `src/ui/presentation.ts` (build fails below)                   |
| Mutation score      | ≥ 80% on the same files; survivors reviewed                                                                                    |
| Traceability        | TS-QA-50 green: every non-manual ID referenced by a test, no unknown IDs                                                       |
| Defects             | Zero open Sev-1/Sev-2 (P0/P1); Sev-3 triaged with an owner                                                                     |
| Static safety       | Forbidden-key grep, no-network, manifest and VSIX checks green                                                                 |
| UAT                 | All P0/P1 checks in [UAT.md](UAT.md) passed and signed off on at least one OS with the release VSIX                            |
| Open spec questions | Every item in [TEST-SCENARIOS.md § Open spec questions](TEST-SCENARIOS.md#open-spec-questions) resolved or explicitly accepted |

## Defect severity

| Severity       | Definition                                          | Examples                                                                                                                                                                                                                                | Priority                             |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Sev-1 Critical | Safety or data-integrity failure                    | Auto-approve turns on without the required confirmation; turn-off reports success but tools still auto-approve; policy worked around; user's prior value lost; real profile/home touched by tests; network or telemetry in product code | P0 — blocks release, fix immediately |
| Sev-2 Major    | Core behaviour broken with no reasonable workaround | Status bar stuck in a wrong state; commands throw; Managed state never shown when policy rejects; crash on activation                                                                                                                   | P1 — blocks release                  |
| Sev-3 Minor    | Wrong or confusing but workable                     | Tooltip wording misleading; singular/plural wrong; message shown as toast instead of status bar                                                                                                                                         | P2 — fix or waive with reason        |
| Sev-4 Trivial  | Cosmetic                                            | Spacing, icon choice, typo in log                                                                                                                                                                                                       | P2 — backlog                         |

Every defect report references the scenario ID (or adds a new one) so the fix lands with a regression test.

## Change control

- A behaviour change starts with an update to [TEST-SCENARIOS.md](TEST-SCENARIOS.md) (new or edited rows), then code and
  tests in the same PR.
- Scenario IDs are never reused; retired scenarios stay listed with "Retired" in the title.
- The PR template's persona checklist must be ticked for AI, end user, admin, QA and UAT impact.
