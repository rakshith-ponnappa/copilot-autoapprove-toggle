import { STORAGE_KEYS } from '../../../src/constants';
import { AutoApproveController } from '../../../src/core/controller';
import type { AutoApproveSnapshot, AutoApproveState, ConfirmMode } from '../../../src/core/types';
import { type ConfirmAnswer, FakeConfirm } from './confirm';
import { CallTrace } from './deferred';
import { FakeLogger } from './logger';
import { FakePreferences } from './preferences';
import { FakeSettings } from './settings';
import { FakeStorage } from './storage';

export { type ConfirmAnswer, FakeConfirm } from './confirm';
export { CallTrace, type Deferred, deferred, flushMicrotasks } from './deferred';
export { FakeLogger } from './logger';
export { FakePreferences } from './preferences';
export { FakeSettings, POLICY_MESSAGE } from './settings';
export { FakeStorage } from './storage';

export const ACK_KEY = STORAGE_KEYS.riskAcknowledged;
export const stashKeyFor = (targetId: string): string => `${STORAGE_KEYS.stash}/${targetId}`;
export const LOCAL_STASH = stashKeyFor('local');
export const REMOTE_TARGET = 'remote:ssh-remote:host';

/**
 * `S(eff, def, glob)` from the scenario catalogue; `def` defaults to `false` only when omitted (an explicit
 * `undefined` means "unsupported", so a default parameter cannot be used).
 */
export function S(effective: unknown, ...rest: [defaultValue?: unknown, globalValue?: unknown]): AutoApproveSnapshot {
  return { effective, defaultValue: rest.length === 0 ? false : rest[0], globalValue: rest[1] };
}

export const OFF: AutoApproveState = { mode: 'off', customToolCount: 0, managed: false, userSettingOn: false };
export const ON: AutoApproveState = { mode: 'on', customToolCount: 0, managed: false, userSettingOn: true };

export interface HarnessOptions {
  readonly targetId?: string;
  readonly user?: unknown;
  readonly supported?: boolean;
  readonly confirmMode?: ConfirmMode;
  readonly confirmAnswer?: ConfirmAnswer;
  /** Shared storage, e.g. for a local and a remote controller in the same `globalState`. */
  readonly storage?: FakeStorage;
  readonly acknowledged?: boolean;
}

export interface Harness {
  readonly settings: FakeSettings;
  readonly storage: FakeStorage;
  readonly prefs: FakePreferences;
  readonly confirm: FakeConfirm;
  readonly logger: FakeLogger;
  readonly trace: CallTrace;
  readonly controller: AutoApproveController;
  /** Every `onDidChangeState` emission, in order. */
  readonly events: AutoApproveState[];
  readonly stashKey: string;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const trace = new CallTrace();
  const settings = new FakeSettings({
    targetId: options.targetId ?? 'local',
    user: options.user,
    supported: options.supported ?? true,
    trace,
  });
  const storage = options.storage ?? new FakeStorage();
  if (options.acknowledged) {
    storage.seed(ACK_KEY, true);
  }
  const prefs = new FakePreferences(options.confirmMode ?? 'firstTime');
  const confirm = new FakeConfirm(options.confirmAnswer ?? true, trace);
  const logger = new FakeLogger();
  const controller = new AutoApproveController({ settings, storage, preferences: prefs, confirm, logger });
  const events: AutoApproveState[] = [];
  controller.onDidChangeState((state) => events.push(state));
  return {
    settings,
    storage,
    prefs,
    confirm,
    logger,
    trace,
    controller,
    events,
    stashKey: stashKeyFor(settings.targetId),
  };
}
