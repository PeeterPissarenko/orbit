import globals from 'globals';

/**
 * Orbit is plain modern JavaScript, so the linting is deliberately light:
 * catch genuinely dead code and accidental globals, and stay out of the way
 * on everything stylistic.
 */
export default [
  {
    files: ['**/*.js'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-undef': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
