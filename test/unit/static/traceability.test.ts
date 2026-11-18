import { describe, expect, it } from 'vitest';
import { listFiles, read, stripComments } from './files';

interface Scenario {
  readonly id: string;
  readonly layer: string;
}

/** Rows of the scenario tables in docs/TEST-SCENARIOS.md: `| ID | Title | … | Pri | Layer | Target |`. */
function scenarios(): Scenario[] {
  return read('docs/TEST-SCENARIOS.md')
    .split(/\r?\n/)
    .filter((line) => /^\|\s*TS-[A-Z]+-\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      return { id: cells[0] ?? '', layer: cells[cells.length - 2] ?? '' };
    });
}

const TEST_MODIFIERS = new Set([
  'only',
  'skip',
  'todo',
  'fails',
  'fail',
  'fixme',
  'slow',
  'each',
  'concurrent',
  'sequential',
  'runIf',
  'skipIf',
]);

/** Skips a string literal starting at `i` (quote char at `i`); returns the index after the closing quote. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    j += src[j] === '\\' ? 2 : 1;
  }
  return j + 1;
}

/** Index just after the bracket that balances the one at `i` (`(`, `[`, `{` or `<`), skipping string contents. */
function skipBalanced(src: string, i: number): number {
  const open = src[i];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '>';
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "'" || ch === '"' || ch === '`') {
      j = skipString(src, j);
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    }
    j++;
  }
  return j;
}

/**
 * Titles of `it(...)` / `test(...)` calls, including modifier chains such as `it.each([...])('title', …)`,
 * `describe.runIf(x)` excluded. Non-literal titles are returned as `<non-literal>` so they fail the prefix check.
 */
export function testTitles(source: string): string[] {
  const src = stripComments(source);
  const titles: string[] = [];
  const callStart = /(?<![\w.$])(it|test)\b/g;
  for (const match of src.matchAll(callStart)) {
    let i = match.index + match[0].length;
    let valid = true;
    while (src[i] === '.') {
      const member = /^\.(\w+)/.exec(src.slice(i));
      if (!member?.[1] || !TEST_MODIFIERS.has(member[1])) {
        valid = false;
        break;
      }
      i += member[0].length;
      while (src[i] === '<' || src[i] === '(') {
        // A modifier's own arguments (runIf(cond), each(table), each<T>(table)); the title call follows.
        const after = skipBalanced(src, i);
        if (src[i] === '(' && !/^\s*[(<.]/.test(src.slice(after))) {
          break;
        }
        i = after;
      }
    }
    if (!valid) {
      continue;
    }
    if (src[i] === '<') {
      i = skipBalanced(src, i);
    }
    if (src[i] !== '(') {
      continue;
    }
    const rest = src.slice(i + 1).trimStart();
    const literal = /^(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
    titles.push(literal?.[2] ?? '<non-literal>');
  }
  return titles;
}

const ID = /TS-(?:AI|USR|ADM|QA|UAT)-\d{2}/g;
const PREFIX = /^TS-(?:AI|USR|ADM|QA|UAT)-\d{2}\b/;
const TEST_FILES = listFiles('test', /\.(?:test|e2e)\.(?:ts|mts|js|mjs)$/);
const UNIT_FILES = TEST_FILES.filter((f) => f.startsWith('test/unit/'));
const titlesByFile = new Map(TEST_FILES.map((file) => [file, testTitles(read(file))]));
const all = scenarios();
const known = new Set(all.map((s) => s.id));
const idsIn = (files: readonly string[]): Set<string> =>
  new Set(files.flatMap((f) => (titlesByFile.get(f) ?? []).flatMap((t) => t.match(ID) ?? [])));

describe('traceability (TS-QA-50)', () => {
  it('TS-QA-50 the title scanner understands it/test, modifier chains and it.each tables', () => {
    // Built from parts so this file's own scan does not pick the sample calls up as real tests.
    const [i, t] = ['i' + 't', 'te' + 'st'];
    const sample = [
      `${i}('TS-QA-01 a', () => {});`,
      `${i}.each([[1, 2], [3, 4]])('TS-QA-02 b %s', () => {});`,
      `${i}.each<[string]>([['x']])('TS-QA-03 c', () => {});`,
      `${i}.runIf(ok)('TS-QA-04 d', () => {});`,
      "describe.runIf(x)('group', () => {});",
      `${t}(\`TS-QA-05 e \${x}\`, async () => {});`,
      `${t}.describe('group', () => {}); ${t}.beforeEach(() => {}); ${t}.step('s', () => {});`,
      `${i}(title, () => {});`,
      "const split = 'a'.split('x'); wait('nope');",
    ].join('\n');
    expect(testTitles(sample)).toEqual([
      'TS-QA-01 a',
      'TS-QA-02 b %s',
      'TS-QA-03 c',
      'TS-QA-04 d',
      'TS-QA-05 e ${x}',
      '<non-literal>',
    ]);
  });

  it('TS-QA-50 the catalogue parses: unique IDs, every row has a layer', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(known.size).toBe(all.length);
    for (const s of all) {
      expect(s.layer, s.id).toMatch(/unit|property|static|integration|policy-CI|e2e|mutation|manual-UAT/);
    }
  });

  it('TS-QA-50 every test title under test/ starts with a scenario ID', () => {
    const offenders = [...titlesByFile].flatMap(([file, titles]) =>
      titles.filter((t) => !PREFIX.test(t)).map((t) => `${file}: ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  it('TS-QA-50 no test references an unknown scenario ID', () => {
    const unknown = [...idsIn(TEST_FILES)].filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it('TS-QA-50 every unit/property/static/mutation scenario is automated under test/unit', () => {
    const unitIds = idsIn(UNIT_FILES);
    const missing = all
      .filter((s) => /\b(?:unit|property|static|mutation)\b/.test(s.layer))
      .filter((s) => !unitIds.has(s.id))
      .map((s) => `${s.id} (${s.layer})`);
    expect(missing).toEqual([]);
  });

  it('TS-QA-50 every non-manual scenario appears in at least one test title under test/', () => {
    const covered = idsIn(TEST_FILES);
    const missing = all
      .filter((s) => s.layer !== 'manual-UAT')
      .filter((s) => !covered.has(s.id))
      .map((s) => `${s.id} (${s.layer})`);
    expect(missing).toEqual([]);
  });
});
