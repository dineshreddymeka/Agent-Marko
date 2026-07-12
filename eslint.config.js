import eslint from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/migrations/**', '**/e2e/**'] },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // eslint 10 recommended; existing code has intentional reassignment patterns.
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // React hooks / refresh only apply to the app UI surface.
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      // Keep the classic react-hooks surface. Plugin v7's "recommended" enables
      // React Compiler rules (set-state-in-effect, refs, purity, …) as errors and
      // would fail lint across the existing app; adopt those separately.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Approval REST is the intentional bridge to agent approval policy.
    // SoT maintainability: rest/ must not import agent/ internals otherwise.
    files: ['server/src/rest/**/*.{ts,tsx}'],
    ignores: ['server/src/rest/approval.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/agent/**', '../agent/*', '../../agent/*', '../../../agent/*'],
              message: 'rest/ cannot import agent/ internals (SoT lint boundary)',
            },
          ],
        },
      ],
    },
  },
  {
    // SoT maintainability: UI components must not import repositories
    files: ['app/src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/repositories/**', '@server/db/**'],
              message: 'components cannot import repositories (SoT lint boundary)',
            },
          ],
        },
      ],
    },
  },
)
