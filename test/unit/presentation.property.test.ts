import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/constants';
import type { AutoApproveMode, AutoApproveState, BlockedReason } from '../../src/core/types';
import { contextKeyMode, describeOutcome, present } from '../../src/ui/presentation';
import { fcParams } from './fakes/fc';

const ALLOWED_LINKS = new Set([
  COMMANDS.openSetting,
  COMMANDS.toggle,
  'workbench.action.openSettingsJson',
  'workbench.action.openRemoteSettingsFile',
]);

/** Arbitrary, possibly inconsistent states (e.g. custom with count 0, unsupported + managed, huge or odd counts). */
const anyState: fc.Arbitrary<AutoApproveState> = fc.record({
  mode: fc.constantFrom<AutoApproveMode>('on', 'off', 'custom', 'unsupported'),
  customToolCount: fc.oneof(fc.nat(), fc.integer(), fc.constantFrom(0, 1, 2, Number.MAX_SAFE_INTEGER)),
  managed: fc.boolean(),
  userSettingOn: fc.boolean(),
});

describe('presentation properties', () => {
  it('TS-AI-07 present is total and only links allow-listed commands', () => {
    fc.assert(
      fc.property(anyState, fc.record({ remote: fc.option(fc.boolean(), { nil: undefined }) }), (state, options) => {
        const vm = present(state, options);
        expect(vm.text.startsWith('$(')).toBe(true);
        expect(vm.ariaLabel.length).toBeGreaterThan(0);
        expect(vm.ariaLabel).not.toContain('$(');
        expect(vm.ariaLabel).not.toMatch(/[*`]|\]\(/);
        expect([COMMANDS.toggle, COMMANDS.openSetting]).toContain(vm.command);
        expect([undefined, 'statusBarItem.warningBackground']).toContain(vm.backgroundColorId);
        const links = [...vm.tooltipMarkdown.matchAll(/command:([^)\s?]+)/g)].map((m) => m[1]);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(ALLOWED_LINKS.has(link ?? '')).toBe(true);
        }
        // Command links never carry arguments (no nonce or data can leak through the tooltip).
        expect(vm.tooltipMarkdown).not.toMatch(/command:[^)]*\?/);
      }),
      fcParams(),
    );
  });

  it('TS-AI-07 present is pure and deterministic; toggle command only for unmanaged supported states', () => {
    fc.assert(
      fc.property(anyState, (state) => {
        const frozen = Object.freeze({ ...state });
        expect(present(frozen)).toEqual(present(frozen));
        const togglable = frozen.mode !== 'unsupported' && !frozen.managed;
        expect(present(frozen).command).toBe(togglable ? COMMANDS.toggle : COMMANDS.openSetting);
        expect(contextKeyMode(frozen)).toBe(
          frozen.mode === 'unsupported' ? 'unsupported' : frozen.managed ? 'managed' : frozen.mode,
        );
      }),
      fcParams(),
    );
  });

  it('TS-AI-07 the warning background appears only when tools run without asking (effective on)', () => {
    fc.assert(
      fc.property(anyState, (state) => {
        const warn = present(state).backgroundColorId === 'statusBarItem.warningBackground';
        expect(warn).toBe(state.mode === 'on');
      }),
      fcParams(),
    );
  });

  it('TS-AI-07 describeOutcome is total and appends any raw detail verbatim', () => {
    fc.assert(
      fc.property(
        anyState,
        fc.constantFrom<BlockedReason>('unsupported', 'managed', 'write-failed', 'verify-failed'),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (state, reason, detail) => {
          const feedback = describeOutcome(
            detail === undefined ? { kind: 'blocked', reason, state } : { kind: 'blocked', reason, detail, state },
          );
          expect(feedback.kind).toBe('warning');
          if (feedback.kind === 'warning' && detail !== undefined) {
            expect(feedback.text.endsWith(` ${detail}`)).toBe(true);
          }
          for (const kind of ['changed', 'unchanged', 'cancelled'] as const) {
            expect(() => describeOutcome({ kind, state })).not.toThrow();
          }
        },
      ),
      fcParams(),
    );
  });
});
