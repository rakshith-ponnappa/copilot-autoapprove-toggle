# Integration fixture workspace

Opened by the `integration` and `policy` suites. `.vscode/settings.json` deliberately tries to turn auto-approve on
and to silence the extension's warning from workspace settings (TS-ADM-10); both must be ignored. Tests must not
modify any file in this folder (TS-ADM-11 checks it stays byte-identical).
