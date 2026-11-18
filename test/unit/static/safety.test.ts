import { describe, expect, it } from 'vitest';
import { CONTEXT_KEY_MODE } from '../../../src/constants';
import { SET_CONTEXT } from '../__mocks__/vscode';
import { exists, importedModules, listFiles, read, stripComments } from './files';

const SRC = listFiles('src', /\.ts$/);
const PURE = SRC.filter((f) => f.startsWith('src/core/') || f === 'src/ui/presentation.ts');
const NETWORK_MODULES = [
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dns',
  'dgram',
  'child_process',
  'worker_threads',
  'cluster',
];
const FORBIDDEN_APIS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  '@vscode/extension-telemetry',
  'createTelemetryLogger',
  'setKeysForSync',
  'eval(',
  'new Function(',
];

const code = (file: string): string => stripComments(read(file));
const bare = (spec: string): string => spec.replace(/^node:/, '');

describe('static safety and privacy (TS-QA-48)', () => {
  it('TS-QA-48 src/ is non-empty and the scanned set includes every layer', () => {
    expect(SRC).toEqual(
      expect.arrayContaining([
        'src/extension.ts',
        'src/core/controller.ts',
        'src/ui/presentation.ts',
        'src/adapters/settingsAdapter.ts',
      ]),
    );
  });

  it.each(PURE)('TS-QA-48 (e) %s does not import vscode', (file) => {
    expect(importedModules(read(file))).not.toContain('vscode');
  });

  it.each(PURE)('TS-QA-48 (e) %s imports only relative modules', (file) => {
    for (const spec of importedModules(read(file))) {
      expect(spec.startsWith('./') || spec.startsWith('../'), spec).toBe(true);
    }
  });

  it.each(SRC)('TS-QA-48 (c) %s imports no network/process modules', (file) => {
    const modules = importedModules(read(file)).map(bare);
    for (const forbidden of NETWORK_MODULES) {
      expect(modules).not.toContain(forbidden);
    }
    const allowedExternal = new Set(['vscode', 'crypto']);
    for (const spec of modules.filter((m) => !m.startsWith('.'))) {
      expect(allowedExternal.has(spec), `unexpected external import ${spec}`).toBe(true);
    }
  });

  it.each(SRC)('TS-QA-48 (c) %s uses no network, telemetry, sync or eval APIs', (file) => {
    const source = code(file);
    for (const api of FORBIDDEN_APIS) {
      expect(source.includes(api), `${file} contains ${api}`).toBe(false);
    }
  });

  it.each(SRC)('TS-QA-48 %s has no console.* calls (logging goes through LoggerPort)', (file) => {
    expect(code(file)).not.toMatch(/\bconsole\s*\./);
  });

  it('TS-QA-48 (b) the only setContext call is in src/extension.ts and uses CONTEXT_KEY_MODE', () => {
    const users = SRC.filter((file) => code(file).includes(SET_CONTEXT));
    expect(users).toEqual(['src/extension.ts']);
    const calls = [...code('src/extension.ts').matchAll(/executeCommand\(\s*'setContext'\s*,\s*([^,)]+)/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(calls).toEqual(['CONTEXT_KEY_MODE']);
    expect(CONTEXT_KEY_MODE.startsWith('copilotAutoApproveToggle.')).toBe(true);
  });

  it('TS-QA-48 (d) executeCommand targets are allow-listed; no optIn or VS Code approval commands', () => {
    const targets = SRC.flatMap((file) => [...code(file).matchAll(/executeCommand\(\s*'([^']+)'/g)].map((m) => m[1]));
    expect(new Set(targets)).toEqual(new Set([SET_CONTEXT, 'workbench.action.openSettings']));
    for (const file of SRC) {
      const source = code(file);
      expect(source).not.toMatch(/optIn/i);
      expect(source).not.toMatch(/workbench\.action\.chat\./);
    }
  });

  it('TS-ADM-11 src writes settings only through ConfigurationTarget.Global', () => {
    const targets = SRC.flatMap((file) => [...code(file).matchAll(/ConfigurationTarget\.(\w+)/g)].map((m) => m[1]));
    expect(targets).toEqual(['Global']);
    const updates = SRC.flatMap((file) => [...code(file).matchAll(/\.update\(/g)].map(() => file));
    expect(updates.filter((f) => f.startsWith('src/adapters/'))).toEqual(['src/adapters/settingsAdapter.ts']);
  });

  it('TS-ADM-12 nothing is registered for Settings Sync (stash and ack stay machine-local)', () => {
    for (const file of SRC) {
      expect(code(file)).not.toContain('setKeysForSync');
    }
  });

  it.runIf(exists('dist/extension.js') || process.env.REQUIRE_DIST === '1')(
    'TS-QA-48 (c) dist/extension.js only requires vscode and node:crypto',
    () => {
      if (!exists('dist/extension.js')) {
        throw new Error('REQUIRE_DIST=1 but dist/extension.js is missing; run npm run build first.');
      }
      const bundle = read('dist/extension.js');
      const requires = new Set([...bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]));
      expect(requires).toEqual(new Set(['vscode', 'node:crypto']));
      for (const api of [
        'XMLHttpRequest',
        'WebSocket',
        'extension-telemetry',
        'createTelemetryLogger',
        'setKeysForSync',
      ]) {
        expect(bundle.includes(api), api).toBe(false);
      }
      expect(bundle).not.toMatch(/\bfetch\(/);
    },
  );
});
