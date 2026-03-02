module.exports = {
  root: true,
  ignorePatterns: ['node_modules', 'dist', '.next'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
};
