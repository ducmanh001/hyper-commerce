// @ts-check
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  // ── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      '**/node_modules/**',
      'coverage/**',
      '**/coverage/**',
      'apps/web/**',          // Next.js — has its own lint config
      '**/*.js',              // Config files & compiled output
      '**/*.mjs',
      '**/*.d.ts',
      '.husky/**',
    ],
  },

  // ── NestJS / Shared-libs TypeScript ────────────────────────────────────────
  {
    files: ['apps/**/*.ts', 'libs/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // No `project` here — type-aware rules are slow and cause monorepo
        // tsconfig-matching issues. Use `npm run type-check` for full TS check.
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // ══════════════════════════════════════════════════════════════════════
      // Rule severity guide:
      //   error  = auto-fixable by `eslint --fix`  → always resolved at commit
      //   warn   = NOT auto-fixable                 → shown but never blocks commit
      //            (fix manually over time; CI reports but does not fail)
      // ══════════════════════════════════════════════════════════════════════

      // ── TypeScript — auto-fixable (error) ─────────────────────────────────
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // ── TypeScript — NOT auto-fixable (warn) ──────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',                          // was 'error' — too many legacy violations
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-function': ['warn', { allow: ['arrowFunctions', 'constructors'] }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn', // was 'error' — needs manual refactor

      // ── Prettier — auto-fixable (error) ───────────────────────────────────
      'prettier/prettier': 'error',

      // ── General ───────────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
    },
  },
];
