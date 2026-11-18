import { describe, expect, it } from 'vitest';
import { errorMessage, looksLikePolicyError } from '../../src/core/errors';
import { POLICY_MESSAGE } from './fakes';

const FRENCH_POLICY =
  "Impossible d'écrire dans les paramètres utilisateur, car chat.tools.global.autoApprove est configuré dans la stratégie système.";

describe('errors', () => {
  it('TS-QA-34 errorMessage returns the message of an Error and the string itself', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full');
    expect(errorMessage(new TypeError('bad'))).toBe('bad');
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage('')).toBe('');
  });

  it('TS-QA-34 errorMessage stringifies other thrown values', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage({ toString: () => 'custom' })).toBe('custom');
  });

  it('TS-QA-34 errorMessage never throws, even for values whose toString throws', () => {
    const hostile = {
      toString(): string {
        throw new Error('boom');
      },
    };
    expect(errorMessage(hostile)).toBe('Unknown error');
    expect(errorMessage(Object.create(null))).toBe('Unknown error');
    expect(errorMessage(Symbol('s'))).toBe('Symbol(s)');
  });

  it.each([
    [POLICY_MESSAGE, true],
    ['configured in system POLICY', true],
    ['Policy', true],
    ['policies apply', true],
    ['EACCES: permission denied', false],
    ['disk full', false],
    ['', false],
    [FRENCH_POLICY, false],
  ])('TS-QA-06 looksLikePolicyError(%j) === %s', (message, expected) => {
    expect(looksLikePolicyError(message)).toBe(expected);
  });

  it('TS-QA-46 localized (French) policy message is NOT recognised — accepted limitation', () => {
    expect(looksLikePolicyError(FRENCH_POLICY)).toBe(false);
  });
});
