import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const typescript = require('eslint-config-next/typescript')
const nextPlugin = require('@next/eslint-plugin-next')

export default [
  ...typescript,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
    },
  },
  {
    // Allow require() in plain JS config files that cannot use ESM
    files: ['*.js', '*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
    ],
  },
]
