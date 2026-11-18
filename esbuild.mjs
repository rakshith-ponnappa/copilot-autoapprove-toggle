// Bundles the extension: src/extension.ts -> dist/extension.js
// Usage: node esbuild.mjs [--production] [--watch]
import * as esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Emits "[watch] build started/finished" lines and esbuild errors in a format the
 * `esbuild-watch` problem matcher in .vscode/tasks.json understands.
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${String(location.line)}:${String(location.column)}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  legalComments: production ? 'none' : 'inline',
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    const stop = () => {
      void ctx.dispose().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  const result = await esbuild.build(options);
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // Errors were already printed by the problem matcher plugin; keep any extra context.
  if (error instanceof Error && !('errors' in error)) {
    console.error(error);
  }
  process.exit(1);
});
