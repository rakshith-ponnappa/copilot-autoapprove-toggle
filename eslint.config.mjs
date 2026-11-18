// ESLint flat config (ESLint 10 + typescript-eslint 8, type-aware).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = import.meta.dirname;

/** Pure modules must stay free of the VS Code API so they can be unit-tested in plain Node. */
const pureModules = ['src/core/**/*.ts', 'src/ui/presentation.ts'];

/** Compiled by tsconfig.test.json (mocha suites run inside VS Code). */
const testProjectFiles = ['test/integration/**/*.ts', 'test/policy/**/*.ts', 'test/support/**/*.ts'];

export default defineConfig(
  globalIgnores([
    'dist/',
    'out/',
    'artifacts/',
    '.vscode-test/',
    '.uat/',
    'coverage/',
    'reports/',
    'node_modules/',
    '.stryker-tmp/',
    '**/*.vsix',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Resolves each file against its nearest tsconfig.json (src/** and test/unit/** -> ./tsconfig.json).
        projectService: true,
        tsconfigRootDir,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  {
    // Mocha suites are part of tsconfig.test.json, which the project service cannot discover by name.
    files: testProjectFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.test.json'],
        tsconfigRootDir,
      },
    },
  },

  {
    // Context keys are a safety boundary (never `vscode.*`, never the auto-approve test-mode key).
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='setContext']",
          message: 'Only src/extension.ts may set context keys, and only CONTEXT_KEY_MODE.',
        },
        {
          selector: "TemplateElement[value.cooked='setContext']",
          message: 'Only src/extension.ts may set context keys, and only CONTEXT_KEY_MODE.',
        },
      ],
    },
  },

  {
    files: ['src/extension.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  {
    files: ['src/**/*.ts'],
    rules: {
      // Product code logs through LoggerPort / LogOutputChannel only.
      'no-console': 'error',
    },
  },

  {
    files: pureModules,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message: 'Pure modules (src/core/**, src/ui/presentation.ts) must not depend on the VS Code API.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['test/integration/**/*.ts', 'test/policy/**/*.ts'],
    languageOptions: {
      globals: { ...globals.mocha, ...globals.node },
    },
  },

  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    // Build/tooling scripts and config files are not part of any tsconfig.
    files: ['**/*.{js,mjs,cjs,mts,cts}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
