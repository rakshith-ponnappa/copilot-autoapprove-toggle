# Contributing

Thanks for helping! This extension flips a safety-relevant VS Code setting, so the bar is high: every change must keep
VS Code's own prompts and organization policy in charge, and no test or tool may ever touch your real VS Code profile.

## Ground rules (non-negotiable)

1. **Never bypass VS Code safety.** Don't automate or answer VS Code's approval dialogs, don't write VS Code's internal
   storage (e.g. `chat.tools.global.autoApprove.optIn`), don't work around policy. Policy wins; we only report it.
2. **Never set `vscode.*` context keys** — in particular `vscode.chat.tools.global.autoApprove.testMode`. CI fails if
   `autoApprove.testMode` appears anywhere under `src/` or `test/`.
3. **Never touch the real profile.** Every VS Code launched by tests, scripts or F5 uses isolated `--user-data-dir` and
   `--extensions-dir` inside the project (`.vscode-test/`, `.uat/`), a temp `HOME` (`USERPROFILE` on Windows) and
   `--locale=en`. Never run the system `code` CLI from tooling.
4. **No telemetry, no network calls** in product code. No secrets or personal data in code, tests, fixtures, logs or
   docs. Logs record mode/count only, never full setting values.
5. **Pure modules stay pure:** `src/core/**` and `src/ui/presentation.ts` must not import `vscode` (enforced by ESLint).

## Setup

- Node.js **22** for parity with CI (`.nvmrc`); Node 20.20+ works locally.
- `npm ci`
- Open the folder in VS Code and install the recommended extensions (ESLint, Prettier, EditorConfig, Extension Test
  Runner, Vitest, Playwright).

## Dev loop

- **F5 → "Run Extension"** starts `npm: watch` (esbuild, source maps), then launches a _separate, downloaded_ VS Code
  via `scripts/uat.mjs --dev` with `--user-data-dir=.vscode-test/dev-profile`,
  `--extensions-dir=.vscode-test/dev-extensions`, `--disable-extensions`, temp HOME `.vscode-test/dev-home` and
  `--locale=en`, and attaches the debugger to its extension host (port 9333). Breakpoints in `src/**/*.ts` work.
  - Why not a plain `extensionHost` launch? That opens the dev window inside the VS Code you are already running, where
    `--user-data-dir` is ignored and application-scoped settings are shared across profiles — toggling would change
    **your real** `chat.tools.global.autoApprove`.
  - Reload the dev window (**Developer: Reload Window**) after esbuild rebuilds. Stopping the debug session closes it.
  - Fresh dev profile: delete `.vscode-test/dev-*` (or `node scripts/uat.mjs --dev --reset`).
  - The first run downloads VS Code into `.vscode-test/` (shared with the integration tests).
- **F5 → "Extension Tests"** compiles and runs the `integration` label of `.vscode-test.mjs`.
- **F5 → "Unit Tests (Vitest)"** runs Vitest under the debugger.

## npm scripts

| Script                        | What it does                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run compile`             | Dev build: `esbuild.mjs` → `dist/extension.js` + source map                                        |
| `npm run watch`               | Dev build in watch mode (used by F5)                                                               |
| `npm run build`               | Production build (minified, no source map); also `vscode:prepublish`                               |
| `npm run typecheck`           | `tsc --noEmit` for `tsconfig.json` (src + unit tests) and `tsconfig.test.json` (mocha suites)      |
| `npm run lint`                | ESLint (flat config, type-aware typescript-eslint)                                                 |
| `npm run format`              | Prettier write                                                                                     |
| `npm run format:check`        | Prettier check (CI)                                                                                |
| `npm run test:unit`           | Vitest + v8 coverage (thresholds ≥ 95 % on `src/core/**` and `src/ui/presentation.ts`)             |
| `npm run compile-tests`       | Compile mocha suites to `out/`                                                                     |
| `npm run test:integration`    | Mocha suites inside a downloaded VS Code (`.vscode-test.mjs`, label `integration`)                 |
| `npm run test:policy`         | Organization-policy suites (label `policy`) — **Linux CI only**, see below                         |
| `npm test`                    | `test:unit` + `test:integration`                                                                   |
| `npm run check`               | `typecheck` + `lint` + `format:check` + `test:unit` — run before every push                        |
| `npm run package`             | `vsce package` → `artifacts/copilot-autoapprove-toggle-<version>.vsix` (create `artifacts/` first) |
| `npm run test:e2e`            | Packages, then Playwright drives a real VS Code UI (status bar click, modal, settings.json)        |
| `npm run test:mutation`       | Stryker mutation testing on `src/core` → `reports/mutation/`                                       |
| `npm run uat`                 | Live user-testing sandbox — see [docs/UAT.md](docs/UAT.md)                                         |
| `node scripts/uat.mjs --help` | All UAT/dev-host flags (`--reset`, `--version <v>`, `--no-launch`, `--dev`, `--inspect-port <n>`)  |

> `vsce package --out artifacts/` writes a _file_ called `artifacts` if the folder doesn't exist; run
> `mkdir artifacts` once (CI and `npm run uat` do this for you).

## Testing

Read [docs/TEST-STRATEGY.md](docs/TEST-STRATEGY.md) (pyramid, invariants, isolation, entry/exit criteria) and
[docs/TEST-SCENARIOS.md](docs/TEST-SCENARIOS.md) (scenario IDs `TS-<AI|USR|ADM|QA|UAT>-NN` and which test automates
each). Every behaviour change needs scenarios + tests for **all five personas** where they apply:

| Persona           | Where                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| AI / adversarial  | `test/unit` — fast-check properties and seeded random operation sequences (invariants I1–I8)      |
| End user          | `test/integration` (real VS Code API) and `test/e2e` (Playwright clicks the real status bar item) |
| Admin / IT policy | `test/policy` (Linux CI), plus managed/remote/untrusted cases in unit and E2E                     |
| Professional QA   | Boundary/negative values, error injection, concurrency, coverage thresholds, mutation score, a11y |
| Live user testing | `npm run uat` + the [docs/UAT.md](docs/UAT.md) checklist and sign-off                             |

**Policy tests are Linux-CI-only.** Stable VS Code on macOS/Windows always reads native policy (MDM/registry), so a
file-based policy can only be injected on Linux (`/etc/vscode/policy.json`). Locally, `npm run test:policy` prints
`SKIPPED: policy tests run only in Linux CI` and exits 0. In CI the `policy` job runs a **canary** phase
(`ChatToolsAutoApprove: true`, proving the file is applied) and a **locked** phase (`false`), then always deletes the
file.

If your own machine is org-managed, the integration suite detects the existing policy and skips with a message.

## Pull requests

- Branch from `main`; keep PRs focused. Fill in the PR template (safety checklist + personas + UAT sign-off for
  user-visible changes).
- CI must be green: `checks` (safety grep, typecheck, lint, format, unit + coverage), `integration` (Ubuntu, macOS,
  Windows on VS Code stable + Ubuntu on 1.104.0), `policy`, `e2e`, `package` (VSIX allow-list).
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

### Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary` in the imperative, ≤ 72 chars.
Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`. Breaking changes use `!` and a
`BREAKING CHANGE:` footer. Examples: `fix(controller): keep stash when disable write fails`,
`ci: add 1.104.0 integration leg`.

## Release process

1. Update `CHANGELOG.md` (move **Unreleased** to the new version) and bump `version` in `package.json` (lead-owned).
2. Run the full UAT checklist on the release candidate (`npm run uat -- --reset`) and record the sign-off in the PR.
3. Merge to `main`, then tag: `git tag v<version> && git push origin v<version>`.
4. `release.yml` verifies the tag equals `package.json` version, then runs the **full CI workflow** (`ci.yml` via
   `workflow_call`: checks, integration matrix, policy, e2e, VSIX allow-list) and creates a GitHub Release with that
   exact VSIX attached.
5. The `publish` job runs in the protected **`release`** environment: it installs with `npm ci --ignore-scripts` and
   publishes to the Visual Studio Marketplace only if the `VSCE_PAT` secret exists and to Open VSX only if `OVSX_PAT`
   exists. Each token is exposed only to its own publish step.

**One-time repository setup (required):** in _Settings › Environments_ create `release` with **Required reviewers**
(at least one maintainer) and **Deployment branches and tags** restricted to the tag pattern `v*`, and store
`VSCE_PAT` / `OVSX_PAT` as secrets of that environment — not as repository secrets.

Mutation testing (`mutation.yml`) runs weekly and on demand; Dependabot opens grouped weekly updates for npm and
GitHub Actions (`@types/vscode` is pinned to the minimum supported VS Code and bumped by hand together with
`engines.vscode`).

## Security

Never file vulnerabilities as public issues — see [SECURITY.md](SECURITY.md).
