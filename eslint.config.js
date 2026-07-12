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
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // SoT maintainability: rest/ must not import agent/ internals
    files: ['server/src/rest/**/*.{ts,tsx}'],
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
