import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.kilo/**', 'vitest.config.ts'],
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
  // Phase 0: legacy devLogger-файлы (написаны до Phase 1 и не подвергались
  // полному type-checked режиму). Новый код в `devLogger/channels/**`,
  // `devLogger/core/serialize.ts`, `devLogger/core/execTimeout.ts`,
  // `devLogger/helpers/**`, `devLogger/constants.ts`, `devLogger/types.ts`
  // подчиняется полному набору правил и override не получает.
  {
    files: [
      'devLogger/index.ts',
      'devLogger/core.ts',
      'devLogger/consoleInterceptor.ts',
      'devLogger/globalErrorInterceptor.ts',
      'devLogger/networkInterceptor.ts',
      'devLogger/vueInterceptor.ts',
      'devLogger/helpers.ts',
      'devLogger/execChannel.ts',
      'devLogger/channels/instanceReg.ts',
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