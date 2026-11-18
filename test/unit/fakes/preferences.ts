import type { ConfirmMode, PreferencesPort } from '../../../src/core/types';

export class FakePreferences implements PreferencesPort {
  calls = 0;

  constructor(public mode: ConfirmMode = 'firstTime') {}

  confirmBeforeEnabling(): ConfirmMode {
    this.calls++;
    return this.mode;
  }
}
