## Summary

<!-- What does this change and why? Link the issue (e.g. "Fixes #123"). -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Docs / tests only
- [ ] Build / CI / tooling

## Safety checklist (required — see SPEC hard rules and CONTRIBUTING.md)

- [ ] Does **not** bypass, automate or answer VS Code's own approval prompts (including "Enable global auto approve?").
- [ ] Does **not** write VS Code's internal storage (e.g. `chat.tools.global.autoApprove.optIn`) or work around
      organization policy — policy always wins and is only reported.
- [ ] Does **not** set `vscode.chat.tools.global.autoApprove.testMode` or any other `vscode.*` context key.
- [ ] No test, script or launch config touches the real VS Code profile or home: every VS Code launch uses isolated
      `--user-data-dir` + `--extensions-dir`, a temp `HOME`/`USERPROFILE` and `--locale=en`; the system `code` CLI is
      never used.
- [ ] No telemetry, no network calls in product code, no secrets/PII in code, tests, fixtures, logs or docs.
- [ ] Pure modules (`src/core/**`, `src/ui/presentation.ts`) still do not import `vscode`.
- [ ] Logs never contain full setting values (mode/count only).

## Test personas (tick what you covered; explain any N/A)

- [ ] **AI / adversarial** — property-based (`fast-check`) and seeded random operation sequences still pass;
      invariants I1–I8 hold; new edge cases added for new behaviour.
- [ ] **End user** — status bar click, palette commands, first-time warning, cancel, custom per-tool map, multiple
      windows (integration and/or E2E).
- [ ] **Admin / IT policy** — policy-locked and canary phases pass in Linux CI (`policy` job); managed state,
      untrusted workspace and remote-target isolation still correct.
- [ ] **Professional QA** — boundary/negative values, error injection and concurrency cases; coverage thresholds
      (≥ 95 % on `src/core/**` + `src/ui/presentation.ts`) met; mutation score not reduced (`npm run test:mutation`
      for changes in `src/core/**`); `docs/TEST-SCENARIOS.md` traceability updated.
- [ ] **Live UAT** — for user-visible changes: ran `npm run uat -- --reset` and the affected checks in
      [docs/UAT.md](../docs/UAT.md); sign-off recorded below.

## Verification

- [ ] `npm run check` (typecheck, lint, format, unit + coverage)
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e` (if UI/behaviour changed)
- [ ] `npm run package` — VSIX contains only `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`,
      `LICENSE`, `SECURITY.md`
- [ ] Docs updated (README, CHANGELOG `Unreleased`, docs/\*) where behaviour changed

### UAT sign-off (user-visible changes)

| Tester | Date | VS Code version | OS  | Checks run (TS-UAT-xx) | Result |
| ------ | ---- | --------------- | --- | ---------------------- | ------ |
|        |      |                 |     |                        |        |
