import expo from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier/flat';
import { typescript } from './typescript.js';

/**
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function reactNative({ tsconfigRootDir }) {
  return [
    { ignores: ['.expo/**', 'expo-env.d.ts', 'ios/**', 'android/**'] },
    ...expo,
    ...typescript({ tsconfigRootDir }),
    {
      // Metro loads its config with require(), so this one file stays CommonJS.
      name: 'casa/metro-config',
      files: ['metro.config.js'],
      languageOptions: { sourceType: 'commonjs' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
      name: 'casa/mobile-boundaries',
      files: ['src/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^@casa/db(?:/|$)',
                message: 'Mobile is an API client. Call apps/web through @casa/contracts instead.',
              },
              {
                regex: '^(?:node:|next(?:/|$)|server-only$)',
                message: 'Server-only module. Mobile reaches the server through the API.',
              },
            ],
          },
        ],
      },
    },
    prettier,
  ];
}
