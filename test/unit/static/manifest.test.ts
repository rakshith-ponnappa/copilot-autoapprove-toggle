import { beforeEach, describe, expect, it } from 'vitest';
import { VsCodePreferencesAdapter } from '../../../src/adapters/preferencesAdapter';
import {
  COMMANDS,
  CONFIG_CONFIRM_BEFORE_ENABLING,
  CONFIG_SECTION,
  CONFIG_SHOW_STATUS_BAR_ITEM,
  CONTEXT_KEY_MODE,
} from '../../../src/constants';
import { contextKeyMode } from '../../../src/ui/presentation';
import { mock } from '../__mocks__/vscode';
import { pkg, read, stripComments } from './files';

const commandIds = Object.values(COMMANDS);
const properties = pkg.contributes.configuration.properties;
const CONFIRM_ID = `${CONFIG_SECTION}.${CONFIG_CONFIRM_BEFORE_ENABLING}`;
const SHOW_ID = `${CONFIG_SECTION}.${CONFIG_SHOW_STATUS_BAR_ITEM}`;

beforeEach(() => {
  mock.reset();
});

describe('manifest: commands (TS-QA-49)', () => {
  it('TS-QA-49 contributes.commands equals COMMANDS, each with a category and a distinct title', () => {
    const contributed = pkg.contributes.commands.map((c) => c.command);
    expect([...contributed].sort()).toEqual([...commandIds].sort());
    expect(new Set(pkg.contributes.commands.map((c) => c.title)).size).toBe(commandIds.length);
    for (const c of pkg.contributes.commands) {
      expect(c.category).toBe('Copilot Auto-Approve');
      expect(c.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('TS-QA-49 src/extension.ts registers every command (toggle/enable/disable via registerToggle)', () => {
    const source = stripComments(read('src/extension.ts'));
    for (const name of Object.keys(COMMANDS)) {
      const direct = source.includes(`registerCommand(COMMANDS.${name},`);
      const viaToggle = source.includes(`registerToggle('${name}',`);
      expect(direct || viaToggle, `command ${name} is registered`).toBe(true);
    }
    expect(source).toContain('vscode.commands.registerCommand(COMMANDS[name]');
  });

  it('TS-QA-49 palette when-clauses use CONTEXT_KEY_MODE with known values only, as published', () => {
    const palette = pkg.contributes.menus.commandPalette;
    expect(palette).toEqual([
      {
        command: COMMANDS.enable,
        when: `${CONTEXT_KEY_MODE} != on && ${CONTEXT_KEY_MODE} != unsupported`,
      },
      { command: COMMANDS.disable, when: `${CONTEXT_KEY_MODE} == on` },
    ]);
    const known = new Set(['unsupported', 'managed', 'on', 'off', 'custom']);
    for (const entry of palette) {
      expect(commandIds).toContain(entry.command);
      for (const clause of (entry.when ?? '').split('&&')) {
        const match = /^\s*([\w.]+)\s*(==|!=)\s*(\w+)\s*$/.exec(clause);
        expect(match, clause).not.toBeNull();
        expect(match?.[1]).toBe(CONTEXT_KEY_MODE);
        expect(known.has(match?.[3] ?? '')).toBe(true);
      }
    }
  });

  it('TS-USR-08 palette visibility per context-key value matches §3.4', () => {
    const visible = (command: string, mode: string): boolean => {
      const entry = pkg.contributes.menus.commandPalette.find((e) => e.command === command);
      if (!entry?.when) {
        return true;
      }
      return entry.when.split('&&').every((clause) => {
        const [, , op, value] = /^\s*([\w.]+)\s*(==|!=)\s*(\w+)\s*$/.exec(clause) ?? [];
        return op === '==' ? mode === value : mode !== value;
      });
    };
    const modes = ['off', 'on', 'custom', 'managed', 'unsupported'] as const;
    expect(modes.filter((m) => visible(COMMANDS.enable, m))).toEqual(['off', 'custom', 'managed']);
    expect(modes.filter((m) => visible(COMMANDS.disable, m))).toEqual(['on']);
    for (const m of modes) {
      expect(visible(COMMANDS.toggle, m)).toBe(true);
    }
    expect(
      contextKeyMode({ mode: 'on', customToolCount: 0, managed: true, userSettingOn: false }),
      'a policy-forced on state never offers Turn Off',
    ).toBe('managed');
  });
});

describe('manifest: platform and activation (TS-QA-49 / TS-ADM-14)', () => {
  it('TS-ADM-14 engines.vscode ^1.104.0 and @types/vscode pinned to the same minor (~1.104)', () => {
    expect(pkg.engines.vscode).toBe('^1.104.0');
    expect(pkg.devDependencies['@types/vscode']).toMatch(/^~1\.104\.\d+$/);
  });

  it('TS-QA-49 extensionKind ["ui"], activation onStartupFinished only, main is the bundle', () => {
    expect(pkg.extensionKind).toEqual(['ui']);
    expect(pkg.activationEvents).toEqual(['onStartupFinished']);
    expect(pkg.main).toBe('./dist/extension.js');
  });

  it('TS-QA-49 no keybindings contribution; untrusted and virtual workspaces supported', () => {
    expect(pkg.contributes).not.toHaveProperty('keybindings');
    expect(Object.keys(pkg.contributes).sort()).toEqual(['commands', 'configuration', 'menus']);
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe(true);
    expect(pkg.capabilities.virtualWorkspaces).toBe(true);
  });

  it('TS-QA-49 unit/mutation scripts are wired to Vitest and Stryker', () => {
    expect(pkg.scripts['test:unit']).toBe('vitest run --coverage');
    expect(pkg.scripts['test:mutation']).toBe('stryker run');
  });
});

describe('manifest: configuration ↔ PreferencesPort (TS-QA-49 / TS-QA-43)', () => {
  it('TS-QA-49 exactly the two documented settings, both scope application', () => {
    expect(Object.keys(properties).sort()).toEqual([CONFIRM_ID, SHOW_ID].sort());
    for (const property of Object.values(properties)) {
      expect(property.scope).toBe('application');
      expect(property.description.length).toBeGreaterThan(0);
    }
  });

  it('TS-QA-43 confirmBeforeEnabling enum/default agree with the adapter: every enum value round-trips, default is the fallback', () => {
    const confirm = properties[CONFIRM_ID];
    expect(confirm?.type).toBe('string');
    expect(confirm?.enum).toEqual(['firstTime', 'always', 'never']);
    expect(confirm?.enumDescriptions).toHaveLength(3);
    expect(confirm?.default).toBe('firstTime');
    const adapter = new VsCodePreferencesAdapter();
    for (const value of confirm?.enum ?? []) {
      mock.setting(CONFIRM_ID).globalValue = value;
      expect(adapter.confirmBeforeEnabling()).toBe(value);
    }
    mock.setting(CONFIRM_ID).globalValue = undefined;
    expect(adapter.confirmBeforeEnabling()).toBe(confirm?.default);
  });

  it('TS-QA-43 showStatusBarItem is a boolean defaulting to true, matching the adapter fallback', () => {
    const show = properties[SHOW_ID];
    expect(show?.type).toBe('boolean');
    expect(show?.default).toBe(true);
    expect(new VsCodePreferencesAdapter().showStatusBarItem()).toBe(show?.default);
  });

  it('TS-ADM-12 the extension does not contribute or re-scope chat.tools.global.autoApprove', () => {
    expect(Object.keys(properties).some((key) => key.startsWith('chat.'))).toBe(false);
  });
});
