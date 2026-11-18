import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const ROOT = resolve(__dirname, '../../..');

/** Repo-relative POSIX paths of every file under `dir` (repo-relative) whose name matches `pattern`. */
export function listFiles(dir: string, pattern = /./): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          walk(path);
        }
      } else if (pattern.test(entry.name)) {
        out.push(relative(ROOT, path).split(sep).join('/'));
      }
    }
  };
  walk(absolute);
  return out.sort();
}

export function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

export function exists(path: string): boolean {
  return existsSync(join(ROOT, path));
}

/** Source text with `//` and `/* *\/` comments removed (string contents are kept; good enough for import scans). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Module specifiers from static imports, re-exports, dynamic imports and require calls. */
export function importedModules(source: string): string[] {
  const code = stripComments(source);
  const specs = new Set<string>();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] !== undefined) {
        specs.add(match[1]);
      }
    }
  }
  return [...specs].sort();
}

export interface PackageJson {
  readonly [key: string]: unknown;
  readonly engines: { readonly vscode: string };
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly main: string;
  readonly extensionKind: readonly string[];
  readonly activationEvents: readonly string[];
  readonly capabilities: {
    readonly untrustedWorkspaces: { readonly supported: boolean | string };
    readonly virtualWorkspaces: boolean;
  };
  readonly contributes: {
    readonly [key: string]: unknown;
    readonly commands: readonly { readonly command: string; readonly title: string; readonly category: string }[];
    readonly menus: { readonly commandPalette: readonly { readonly command: string; readonly when?: string }[] };
    readonly configuration: {
      readonly title: string;
      readonly properties: Readonly<
        Record<
          string,
          {
            readonly type: string;
            readonly enum?: readonly string[];
            readonly enumDescriptions?: readonly string[];
            readonly default: unknown;
            readonly scope: string;
            readonly description: string;
          }
        >
      >;
    };
  };
}

export const pkg = JSON.parse(read('package.json')) as PackageJson;
