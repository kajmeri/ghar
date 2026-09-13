import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const HEX_COLOR = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
const HEX_MESSAGE =
  'Hex colors live only in packages/tokens/tokens.json. Use a token (CSS variable, Tailwind class, or @casa/tokens).';

/** no-restricted-syntax entries. Exported so configs that add their own entries keep these. */
export const NO_HEX_SYNTAX = [
  { selector: `Literal[value=/${HEX_COLOR}/]`, message: HEX_MESSAGE },
  { selector: `TemplateElement[value.raw=/${HEX_COLOR}/]`, message: HEX_MESSAGE },
];

/**
 * Type-aware TypeScript rules shared by every workspace.
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function typescript({ tsconfigRootDir }) {
  return [
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/generated/**',
        '**/.turbo/**',
        '**/coverage/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-restricted-syntax': ['error', ...NO_HEX_SYNTAX],
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
  ];
}
