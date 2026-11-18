import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, pkg, read, ROOT } from './files';

/** Entry names from a ZIP central directory (no extraction, no dependencies). */
function zipEntries(buffer: Buffer): string[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('not a zip file');
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('corrupt central directory');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const vsixPath = `artifacts/${String(pkg.name)}-${String(pkg.version)}.vsix`;
const vsix = listFiles('artifacts', /\.vsix$/).includes(vsixPath) ? vsixPath : undefined;
const required = process.env.REQUIRE_VSIX === '1';

describe('.vscodeignore (TS-QA-49)', () => {
  it('TS-QA-49 allow-list packaging: excludes everything, re-includes only shipped files, never maps', () => {
    const lines = read('.vscodeignore')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(lines[0]).toBe('**');
    const included = lines.filter((l) => l.startsWith('!')).map((l) => l.slice(1));
    for (const forbidden of [
      'src',
      'test',
      'docs',
      'scripts',
      'node_modules',
      'coverage',
      '.vscode-test',
      '.uat',
      '.github',
    ]) {
      expect(included.some((l) => l === forbidden || l.startsWith(`${forbidden}/`))).toBe(false);
    }
    expect(included).toContain('dist/extension.js');
    expect(included.some((l) => l.startsWith('dist/') && l !== 'dist/extension.js')).toBe(false);
    expect(lines.at(-1)).toBe('**/*.map');
  });
});

describe.runIf(vsix !== undefined || required)('VSIX contents (TS-QA-49)', () => {
  it(`TS-QA-49 ${vsixPath} ships the bundle and docs only`, () => {
    if (!vsix) {
      throw new Error(`REQUIRE_VSIX=1 but ${vsixPath} is missing; run npm run package first.`);
    }
    const entries = zipEntries(readFileSync(join(ROOT, vsix)));
    const files = entries.filter((e) => e.startsWith('extension/')).map((e) => e.slice('extension/'.length));
    for (const expected of ['dist/extension.js', 'package.json']) {
      expect(files).toContain(expected);
    }
    expect(files.some((f) => /^LICENSE(?:\.txt|\.md)?$/.test(f))).toBe(true);
    expect(files.map((f) => f.toLowerCase())).toEqual(expect.arrayContaining(['readme.md', 'changelog.md']));
    for (const forbidden of [
      /^src\//,
      /^test\//,
      /^node_modules\//,
      /^\.vscode-test\//,
      /^\.uat\//,
      /\.map$/,
      /^\.github\//,
      /^coverage\//,
      /^docs\//,
      /^scripts\//,
    ]) {
      expect(
        files.filter((f) => forbidden.test(f)),
        String(forbidden),
      ).toEqual([]);
    }
  });
});
