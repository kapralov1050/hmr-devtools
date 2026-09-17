import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.kilo/**', 'vitest.config.ts', 'tsup.config.ts'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
  // Legacy client-файлы (написаны до Phase 1 и не подвергались
  // полному type-checked режиму). Новый код в `src/client/channels/**`,
  // `src/client/core/serialize.ts`, `src/client/core/execTimeout.ts`,
  // `src/client/helpers/**`, `src/client/constants.ts`, `src/client/types.ts`
  // подчиняется полному набору правил и override не получает.
  {
    files: [
      'src/client/index.ts',
      'src/client/interceptors/**',
      'src/client/core/index.ts',
      'src/client/core/originals.ts',
      'src/client/core/flushQueue.ts',
      'src/client/channels/execChannel.ts',
      'src/client/channels/instanceReg.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // __tests__/ содержит моки и хелперы, по дизайну использующие `as unknown as`
  // и `any`-типизированные Node-стримы. Полный набор правил избыточен.
  {
    files: ['__tests__/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  prettier,
);
