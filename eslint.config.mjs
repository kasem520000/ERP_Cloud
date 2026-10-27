import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

/**
 * Money guard (PROJECT_CONTRACT §3: "IEEE `number` is forbidden for money").
 *
 * The Phase-01 selector matched *every* `Identifier` node with a money-like name, which
 * also matched object-literal keys and member-access property names. That made the
 * frozen list envelope of API_CONTRACT §0 / API_ARCHITECTURE §3
 * (`{ data, meta: { total, limit, offset } }`) impossible to write or read without a
 * lint error. The selector below keeps the guard on every *value position*
 * (declarations, parameters, type annotations of variables) and stops matching pure
 * field names, which carry no numeric type at all.
 * Recorded in docs/change-log/CHANGE-REQUESTS.md (CR-001, non-structural).
 */
const MONEY_IDENTIFIER = '/^(price|amount|total|balance|cost|rate)$/i';
/**
 * الحارسُ يطارد **`number` العائم** لا الاسم: `Decimal` والنصوصُ المالية والعدّادات
 * (أشهرُ الإطفاء، بايتاتُ النسخة الاحتياطية) كانت كلُّها تُلوَّن بالأحمر لأنّ الاسم فقط هو
 * ما يُطابَق. فصار الاختيارُ على موضعين يُثبتان العوم: إعلانٌ صريحٌ `: number`، أو تحويلٌ
 * صريحٌ بـ`Number(...)`. وما عداهما — `let total: Decimal` و`const total = '669.30'` —
 * هو الشكلُ الذي يطلبه العقد نفسه (PROJECT_CONTRACT §3).
 */
const MONEY_SELECTOR = [
  `Identifier[name=${MONEY_IDENTIFIER}][typeAnnotation.typeAnnotation.type='TSNumberKeyword']`,
  `VariableDeclarator[init.callee.name='Number'] > Identifier[name=${MONEY_IDENTIFIER}]`,
].join(', ');

export default [
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs,js}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    settings: {
      // `packages/ui` (the design system, ADR-030) and `packages/web-core` (the shared web
      // shell) ship browser sources as TypeScript, so every package `.tsx` is a `lib`
      // element like the other package sources and gets the DOM globals the apps get.
      'boundaries/elements': [
        { type: 'app', pattern: ['apps/**/*.ts', 'apps/**/*.js', 'apps/**/*.mjs'] },
        {
          type: 'lib',
          pattern: [
            'packages/**/*.ts',
            'packages/**/*.js',
            'packages/**/*.mjs',
            'packages/**/*.tsx',
          ],
        },
      ],
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      boundaries,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: MONEY_SELECTOR,
          message: 'Use decimal.js / string money types; avoid number for money-like identifiers.',
        },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: ['app'],
              allow: ['app', 'lib'],
            },
            {
              from: ['lib'],
              allow: ['lib'],
            },
          ],
        },
      ],
      // The base rule does not understand TypeScript parameter properties
      // (`constructor(public readonly status: number)`), so the typed variant replaces it.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The Next.js apps run in the browser and use the automatic JSX runtime, so they need
    // the DOM globals and the `React` type namespace without an explicit default import.
    // Matched both from the repo root (`apps/staff/app/page.tsx`) and from inside the app
    // itself (`app/page.tsx`), because each app runs eslint with its own directory as cwd.
    files: [
      '**/apps/staff/**/*.{ts,tsx}',
      '**/apps/marketing/**/*.{ts,tsx}',
      '**/apps/platform-admin/**/*.{ts,tsx}',
      '**/apps/customer-portal/**/*.{ts,tsx}',
      '**/apps/bakery/**/*.{ts,tsx}',
      '**/packages/ui/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
      '**/packages/web-core/**/*.{ts,tsx}',
      'packages/web-core/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        React: 'readonly',
      },
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      'spaced-comment': 'off',
    },
  },
];
