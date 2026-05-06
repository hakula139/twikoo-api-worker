import tseslint from 'typescript-eslint';

const sharedRules = {
  'curly': ['error', 'all'],
  'eqeqeq': ['error', 'always'],
  'no-throw-literal': 'error',
  'prefer-const': 'error',
};

export default tseslint.config(
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [...tseslint.configs.recommended],
    rules: sharedRules,
  },
  {
    ignores: ['.claude/', '.direnv/', '.wrangler/', 'node_modules/'],
  },
);
