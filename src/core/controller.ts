import { STORAGE_KEYS } from '../constants';
import { errorMessage, looksLikePolicyError } from './errors';
import { Mutex } from './mutex';
import { clearStash, createStash, hasStashEntry, readStash, writeStash } from './stash';
import { resolveState, statesEqual } from './state';
import type {
  AutoApproveControllerApi,
  AutoApproveSnapshot,
  AutoApproveState,
  BlockedReason,
  ControllerDeps,
  Disposable,
  InvocationOrigin,
  ToggleOutcome,
} from './types';

/** An outcome before the final state is attached; the controller always reports the state after the operation. */
type Result =
  | { readonly kind: 'changed' | 'unchanged' | 'cancelled' }
  | { readonly kind: 'blocked'; readonly reason: BlockedReason; readonly detail?: string };

type Operation = 'initialize' | 'enable' | 'disable' | 'toggle';

const UNSUPPORTED_STATE: AutoApproveState = Object.freeze({
  mode: 'unsupported',
  customToolCount: 0,
  managed: false,
  userSettingOn: false,
});

const CHANGED: Result = { kind: 'changed' };
const UNCHANGED: Result = { kind: 'unchanged' };
const CANCELLED: Result = { kind: 'cancelled' };

function blocked(reason: BlockedReason, detail?: string): Result {
  return detail === undefined ? { kind: 'blocked', reason } : { kind: 'blocked', reason, detail };
}

function withState(result: Result, state: AutoApproveState): ToggleOutcome {
  return { ...result, state };
}

function describeOutcome(result: Result): string {
  return result.kind === 'blocked' ? `blocked/${result.reason}` : result.kind;
}

function describeState(state: AutoApproveState): string {
  const count = state.mode === 'custom' ? ` count=${state.customToolCount}` : '';
  return `mode=${state.mode}${count} managed=${state.managed} userSettingOn=${state.userSettingOn}`;
}

/**
 * The identity-write policy probe is skipped for per-tool maps: VS Code re-serializes object values, which could
 * rewrite the user's formatting or comments before they even confirm. The real write still detects policy.
 */
function needsPolicyProbe(globalValue: unknown): boolean {
  return globalValue === undefined || globalValue === null || typeof globalValue !== 'object';
}

export class AutoApproveController implements AutoApproveControllerApi {
  private readonly queue = new Mutex();
  private readonly listeners = new Set<(state: AutoApproveState) => void>();
  private readonly subscription: Disposable;
  private currentState: AutoApproveState;
  private stickyManaged = false;
  private inFlight = false;
  private pendingToggle: Promise<ToggleOutcome> | undefined;
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {
    this.currentState = this.tryResolve() ?? UNSUPPORTED_STATE;
    this.subscription = deps.settings.onDidChange(() => {
      this.handleSettingsChanged();
    });
  }

  get state(): AutoApproveState {
    return this.currentState;
  }

  onDidChangeState(listener: (state: AutoApproveState) => void): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async initialize(): Promise<void> {
    await this.runQueued('initialize', 'external', () => this.doInitialize());
  }

  enable(origin: InvocationOrigin = 'external'): Promise<ToggleOutcome> {
    return this.runQueued('enable', origin, () => this.doEnable(origin));
  }

  disable(origin: InvocationOrigin = 'external'): Promise<ToggleOutcome> {
    return this.runQueued('disable', origin, () => this.doDisable(origin));
  }

  toggle(origin: InvocationOrigin = 'external'): Promise<ToggleOutcome> {
    if (this.pendingToggle) {
      this.deps.logger.info(`toggle origin=${origin} decision=coalesced`);
      return this.pendingToggle;
    }
    const pending = this.runQueued('toggle', origin, () => this.doToggle(origin));
    this.pendingToggle = pending;
    const release = (): void => {
      if (this.pendingToggle === pending) {
        this.pendingToggle = undefined;
      }
    };
    // runQueued never rejects; the second handler is defensive.
    pending.then(release, release);
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.subscription.dispose();
  }

  // ---- queue plumbing -------------------------------------------------------------------------------------------

  /** Serializes `op`, converts unexpected errors into a blocked outcome and always attaches the fresh state. */
  private runQueued(name: Operation, origin: InvocationOrigin, op: () => Promise<Result>): Promise<ToggleOutcome> {
    return this.queue.run(async () => {
      let result: Result;
      try {
        result = await op();
      } catch (e) {
        const message = errorMessage(e);
        this.deps.logger.error(`${name} origin=${origin} failed unexpectedly: ${message}`);
        result = blocked('write-failed', message);
      } finally {
        this.inFlight = false;
      }
      const state = this.refresh();
      this.deps.logger.info(`${name} origin=${origin} outcome=${describeOutcome(result)} ${describeState(state)}`);
      return withState(result, state);
    });
  }

  private async doToggle(origin: InvocationOrigin): Promise<Result> {
    const state = resolveState(this.deps.settings.read(), this.stickyManaged);
    const turnOff = state.mode === 'on' || state.userSettingOn;
    this.deps.logger.info(`toggle origin=${origin} decision=${turnOff ? 'disable' : 'enable'}`);
    return turnOff ? this.doDisable(origin) : this.doEnable(origin);
  }

  // ---- initialize ------------------------------------------------------------------------------------------------

  private async doInitialize(): Promise<Result> {
    const snapshot = this.deps.settings.read();
    const { storage, settings } = this.deps;
    if (!hasStashEntry(storage, settings.targetId)) {
      return UNCHANGED;
    }
    if (snapshot.globalValue !== true || readStash(storage, settings.targetId) === undefined) {
      this.deps.logger.info('initialize decision=clear-stale-stash');
      await this.clearStashBestEffort();
    }
    return UNCHANGED;
  }

  // ---- enable ----------------------------------------------------------------------------------------------------

  private async doEnable(origin: InvocationOrigin): Promise<Result> {
    const snapshot = this.deps.settings.read();
    const guard = this.enableGuard(snapshot);
    if (guard) {
      return guard;
    }

    const probeFailure = needsPolicyProbe(snapshot.globalValue)
      ? await this.probeWritable(snapshot.globalValue)
      : undefined;
    if (probeFailure) {
      return probeFailure;
    }

    const confirmation = await this.confirmIfNeeded(origin);
    if (confirmation !== 'proceed') {
      return confirmation;
    }

    const current = this.deps.settings.read();
    return this.enableGuard(current) ?? this.writeEnabled(current);
  }

  /** Short-circuits that need no write. Also re-checked after the dialog because settings may change meanwhile. */
  private enableGuard(snapshot: AutoApproveSnapshot): Result | undefined {
    const state = resolveState(snapshot, this.stickyManaged);
    if (state.mode === 'unsupported') {
      return blocked('unsupported');
    }
    if (state.mode === 'on') {
      return UNCHANGED;
    }
    if (state.managed) {
      return blocked('managed');
    }
    return undefined;
  }

  /** Identity write: runs VS Code's policy validation without changing settings.json, before any dialog is shown. */
  private async probeWritable(currentValue: unknown): Promise<Result | undefined> {
    this.inFlight = true;
    try {
      await this.deps.settings.writeUserValue(currentValue);
      return undefined;
    } catch (e) {
      return this.classifyWriteError('enable-probe', e);
    } finally {
      this.inFlight = false;
    }
  }

  private async confirmIfNeeded(origin: InvocationOrigin): Promise<'proceed' | Result> {
    if (!this.needsConfirmation(origin)) {
      return 'proceed';
    }
    let accepted: boolean;
    try {
      accepted = await this.deps.confirm.confirmEnable();
    } catch (e) {
      this.deps.logger.warn(`enable origin=${origin} confirmation dialog failed: ${errorMessage(e)}`);
      return CANCELLED;
    }
    this.deps.logger.info(`enable origin=${origin} decision=${accepted ? 'confirmed' : 'declined'}`);
    if (!accepted) {
      return CANCELLED;
    }
    return (await this.acknowledgeRisk()) ?? 'proceed';
  }

  private needsConfirmation(origin: InvocationOrigin): boolean {
    if (origin !== 'statusBar') {
      return true;
    }
    const mode = this.deps.preferences.confirmBeforeEnabling();
    switch (mode) {
      case 'never':
        return false;
      case 'always':
        return true;
      case 'firstTime':
        return this.deps.storage.get(STORAGE_KEYS.riskAcknowledged) !== true;
    }
  }

  /** Storage failures before the setting write abort the operation with nothing written to settings. */
  private async acknowledgeRisk(): Promise<Result | undefined> {
    try {
      await this.deps.storage.update(STORAGE_KEYS.riskAcknowledged, true);
      return undefined;
    } catch (e) {
      return this.storageWriteFailed('risk acknowledgement', e);
    }
  }

  private storageWriteFailed(what: string, e: unknown): Result {
    const message = errorMessage(e);
    this.deps.logger.error(`enable aborted, could not store the ${what}: ${message}`);
    return blocked('write-failed', message);
  }

  private async writeEnabled(snapshot: AutoApproveSnapshot): Promise<Result> {
    // Set before the stash write so our own change events never clear the fresh stash.
    this.inFlight = true;
    if (snapshot.globalValue !== true) {
      try {
        await writeStash(this.deps.storage, createStash(this.deps.settings.targetId, snapshot.globalValue));
      } catch (e) {
        return this.storageWriteFailed('previous value', e);
      }
    }
    try {
      await this.deps.settings.writeUserValue(true);
    } catch (e) {
      await this.clearStashBestEffort();
      return this.classifyWriteError('enable', e);
    }
    if (this.deps.settings.read().effective === true) {
      return CHANGED;
    }
    await this.restoreAfterFailedEnable();
    return blocked('verify-failed');
  }

  private async restoreAfterFailedEnable(): Promise<void> {
    const stash = readStash(this.deps.storage, this.deps.settings.targetId);
    const previous = stash && 'value' in stash ? stash.value : undefined;
    try {
      await this.deps.settings.writeUserValue(previous);
    } catch (e) {
      this.deps.logger.warn(`Could not restore the previous value after a failed enable: ${errorMessage(e)}`);
    }
    await this.clearStashBestEffort();
  }

  // ---- disable ---------------------------------------------------------------------------------------------------

  private async doDisable(origin: InvocationOrigin): Promise<Result> {
    const state = resolveState(this.deps.settings.read(), this.stickyManaged);
    if (state.mode === 'unsupported') {
      return blocked('unsupported');
    }
    if (state.mode !== 'on' && !state.userSettingOn) {
      return UNCHANGED;
    }

    const { value, restoring } = this.disableTarget();
    this.deps.logger.info(`disable origin=${origin} decision=${restoring ? 'restore-previous' : 'write-false'}`);
    this.inFlight = true;
    try {
      await this.deps.settings.writeUserValue(value);
    } catch (e) {
      return this.classifyWriteError('disable', e);
    }
    await this.clearStashBestEffort();
    return this.deps.settings.read().effective === true ? blocked('verify-failed') : CHANGED;
  }

  /** Restores the stashed user value for this target when it is safe to; otherwise writes `false`. */
  private disableTarget(): { readonly value: unknown; readonly restoring: boolean } {
    const stash = readStash(this.deps.storage, this.deps.settings.targetId);
    if (stash && stash.value !== true) {
      return { value: 'value' in stash ? stash.value : undefined, restoring: true };
    }
    return { value: false, restoring: false };
  }

  // ---- shared helpers --------------------------------------------------------------------------------------------

  private classifyWriteError(step: string, e: unknown): Result {
    const message = errorMessage(e);
    if (looksLikePolicyError(message)) {
      this.stickyManaged = true;
      this.deps.logger.warn(`${step} rejected by policy: ${message}`);
      return blocked('managed', message);
    }
    this.deps.logger.error(`${step} write failed: ${message}`);
    return blocked('write-failed', message);
  }

  private async clearStashBestEffort(): Promise<void> {
    try {
      await clearStash(this.deps.storage, this.deps.settings.targetId);
    } catch (e) {
      this.deps.logger.warn(`Could not clear the stored previous value: ${errorMessage(e)}`);
    }
  }

  private handleSettingsChanged(): void {
    if (this.disposed) {
      return;
    }
    this.stickyManaged = false;
    let snapshot: AutoApproveSnapshot;
    try {
      snapshot = this.deps.settings.read();
    } catch (e) {
      this.deps.logger.error(`Could not read the setting after a change: ${errorMessage(e)}`);
      return;
    }
    if (!this.inFlight && snapshot.globalValue !== true && this.hasStash()) {
      this.deps.logger.info('change decision=clear-stash-after-external-change');
      void this.clearStashBestEffort();
    }
    this.setState(resolveState(snapshot, false));
  }

  private hasStash(): boolean {
    try {
      return hasStashEntry(this.deps.storage, this.deps.settings.targetId);
    } catch (e) {
      this.deps.logger.warn(`Could not read the stored previous value: ${errorMessage(e)}`);
      return false;
    }
  }

  private tryResolve(): AutoApproveState | undefined {
    try {
      return resolveState(this.deps.settings.read(), this.stickyManaged);
    } catch (e) {
      this.deps.logger.error(`Could not read the setting: ${errorMessage(e)}`);
      return undefined;
    }
  }

  private refresh(): AutoApproveState {
    const next = this.tryResolve();
    if (next) {
      this.setState(next);
    }
    return this.currentState;
  }

  private setState(next: AutoApproveState): void {
    if (statesEqual(this.currentState, next)) {
      return;
    }
    this.currentState = next;
    if (this.disposed) {
      return;
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch (e) {
        this.deps.logger.error(`State listener failed: ${errorMessage(e)}`);
      }
    }
  }
}
