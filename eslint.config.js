import js from '@eslint/js';
import solid from 'eslint-plugin-solid/configs/typescript';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude',
      'dist',
      'dist-cli',
      'dist-site',
      'packages/*/dist',
      'reference',
      'docs/intent/diagram-imports/assets/pro-results/2026-10-31',
      'tmp',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'site/**/*.{ts,tsx}'],
    ...solid,
    languageOptions: { globals: globals.browser, parserOptions: { project: './tsconfig.json' } },
    rules: {
      ...solid.rules,
      // Edits run their callback immediately, like an event handler.
      'solid/reactivity': ['warn', { customReactiveFunctions: ['edit', 'transact'] }],
      // Solid assigns `let el!: T` element refs through JSX, which this rule cannot see.
      'no-unassigned-vars': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'tests/**',
      'scripts/**',
      'src/cli/**',
      'src/server/**',
      'integration-examples/**',
      'actions/**',
      '*.config.*',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Proof and bench scripts pass callbacks to `page.evaluate`, which run in the browser.
    files: [
      'scripts/prove-*.mjs',
      'scripts/prove-*.ts',
      'scripts/lib/proof.mjs',
      'scripts/bench/*.mjs',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
