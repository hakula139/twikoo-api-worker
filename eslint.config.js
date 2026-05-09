import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const sharedRules = {
  'curly': ['error', 'all'],
  'eqeqeq': ['error', 'always'],
  'no-throw-literal': 'error',
  'prefer-const': 'error',
};

export default defineConfig([
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.recommended],
    rules: sharedRules,
  },
  {
    ignores: ['.claude/', '.direnv/', '.wrangler/', 'node_modules/'],
  },
]);
