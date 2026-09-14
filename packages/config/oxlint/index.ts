// Oxlint presets. A workspace's oxlint.config.ts exports one of these as its whole config rather
// than through `extends`, so ignorePatterns and override globs resolve against that workspace.
import type { OxlintConfig, OxlintOverride } from 'oxlint'

type Rules = NonNullable<OxlintConfig['rules']>
type Plugins = NonNullable<OxlintConfig['plugins']>

/** Resolved from the workspace that loads the config, so every workspace depends on @ghar/config. */
const GHAR_PLUGIN = '@ghar/config/oxlint/plugin'

const IGNORES = ['**/node_modules/**', '**/dist/**', '**/generated/**', '**/.turbo/**', '**/coverage/**']

/** eslint:recommended. */
const JS_RULES: Rules = {
  'constructor-super': 'error',
  'for-direction': 'error',
  'getter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-case-declarations': 'error',
  'no-class-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': 'error',
  'no-const-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-constant-condition': 'error',
  'no-control-regex': 'error',
  'no-debugger': 'error',
  'no-delete-var': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-empty': 'error',
  'no-empty-character-class': 'error',
  'no-empty-pattern': 'error',
  'no-empty-static-block': 'error',
  'no-ex-assign': 'error',
  'no-extra-boolean-cast': 'error',
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-global-assign': 'error',
  'no-import-assign': 'error',
  'no-invalid-regexp': 'error',
  'no-irregular-whitespace': 'error',
  'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-nonoctal-decimal-escape': 'error',
  'no-obj-calls': 'error',
  'no-prototype-builtins': 'error',
  'no-redeclare': 'error',
  'no-regex-spaces': 'error',
  'no-self-assign': 'error',
  'no-setter-return': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-this-before-super': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-labels': 'error',
  'no-unused-private-class-members': 'error',
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'error',
  'no-with': 'error',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
}

/** typescript-eslint strict, minus the rules that need type information. */
const TS_RULES: Rules = {
  'no-array-constructor': 'error',
  'no-unused-expressions': 'error',
  'no-useless-constructor': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'typescript/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
  'typescript/consistent-type-imports': 'error',
  'typescript/no-duplicate-enum-values': 'error',
  'typescript/no-dynamic-delete': 'error',
  'typescript/no-empty-object-type': 'error',
  'typescript/no-explicit-any': 'error',
  'typescript/no-extra-non-null-assertion': 'error',
  'typescript/no-extraneous-class': 'error',
  'typescript/no-invalid-void-type': 'error',
  'typescript/no-misused-new': 'error',
  'typescript/no-namespace': 'error',
  'typescript/no-non-null-asserted-nullish-coalescing': 'error',
  'typescript/no-non-null-asserted-optional-chain': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/no-require-imports': 'error',
  'typescript/no-this-alias': 'error',
  'typescript/no-unnecessary-type-constraint': 'error',
  'typescript/no-unsafe-declaration-merging': 'error',
  'typescript/no-unsafe-function-type': 'error',
  'typescript/no-wrapper-object-types': 'error',
  'typescript/prefer-as-const': 'error',
  'typescript/prefer-literal-enum-member': 'error',
  'typescript/prefer-namespace-keyword': 'error',
  'typescript/triple-slash-reference': 'error',
  'typescript/unified-signatures': 'error',
}

/** The rest of typescript-eslint strictTypeChecked. tsgolint runs these against each tsconfig. */
const TYPE_AWARE_RULES: Rules = {
  'typescript/await-thenable': 'error',
  'typescript/no-array-delete': 'error',
  'typescript/no-base-to-string': 'error',
  'typescript/no-confusing-void-expression': 'error',
  'typescript/no-deprecated': 'error',
  'typescript/no-duplicate-type-constituents': 'error',
  'typescript/no-floating-promises': 'error',
  'typescript/no-for-in-array': 'error',
  'typescript/no-implied-eval': 'error',
  'typescript/no-meaningless-void-operator': 'error',
  'typescript/no-misused-promises': 'error',
  'typescript/no-misused-spread': 'error',
  'typescript/no-mixed-enums': 'error',
  'typescript/no-redundant-type-constituents': 'error',
  'typescript/no-unnecessary-boolean-literal-compare': 'error',
  'typescript/no-unnecessary-template-expression': 'error',
  'typescript/no-unnecessary-type-arguments': 'error',
  'typescript/no-unnecessary-type-assertion': 'error',
  'typescript/no-unnecessary-type-conversion': 'error',
  'typescript/no-unnecessary-type-parameters': 'error',
  'typescript/no-unsafe-argument': 'error',
  'typescript/no-unsafe-assignment': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-enum-comparison': 'error',
  'typescript/no-unsafe-member-access': 'error',
  'typescript/no-unsafe-return': 'error',
  'typescript/no-unsafe-unary-minus': 'error',
  'typescript/no-useless-default-assignment': 'error',
  'typescript/only-throw-error': 'error',
  'typescript/prefer-promise-reject-errors': 'error',
  'typescript/prefer-reduce-type-parameter': 'error',
  'typescript/prefer-return-this-type': 'error',
  'typescript/related-getter-setter-pairs': 'error',
  'typescript/require-await': 'error',
  'typescript/restrict-plus-operands': [
    'error',
    { allowAny: false, allowBoolean: false, allowNullish: false, allowNumberAndString: false, allowRegExp: false },
  ],
  'typescript/restrict-template-expressions': ['error', { allowNumber: true }],
  'typescript/return-await': ['error', 'error-handling-correctness-only'],
  'typescript/unbound-method': 'error',
  'typescript/use-unknown-in-catch-callback-variable': 'error',
}

/** eslint-plugin-react's recommended runtime rules plus react-hooks (including the compiler rules). */
const REACT_RULES: Rules = {
  'react/display-name': 'error',
  'react/jsx-key': 'error',
  'react/jsx-no-comment-textnodes': 'error',
  'react/jsx-no-duplicate-props': 'error',
  'react/jsx-no-undef': 'error',
  'react/no-children-prop': 'error',
  'react/no-danger-with-children': 'error',
  'react/no-direct-mutation-state': 'error',
  'react/no-find-dom-node': 'error',
  'react/no-is-mounted': 'error',
  'react/no-render-return-value': 'error',
  'react/no-string-refs': 'error',
  'react/no-unescaped-entities': 'error',
  'react/rules-of-hooks': 'error',
  'react/exhaustive-deps': 'warn',
  'react/static-components': 'error',
  'react/use-memo': 'error',
  'react/preserve-manual-memoization': 'error',
  'react/incompatible-library': 'warn',
  'react/immutability': 'error',
  'react/globals': 'error',
  'react/refs': 'error',
  'react/set-state-in-effect': 'error',
  'react/error-boundaries': 'error',
  'react/purity': 'error',
  'react/set-state-in-render': 'error',
  'react/unsupported-syntax': 'warn',
}

const off = (rules: Rules): Rules => Object.fromEntries(Object.keys(rules).map(name => [name, 'off']))

interface PresetOptions {
  ignorePatterns?: string[]
  plugins?: Plugins
  rules?: Rules
  overrides?: OxlintOverride[]
}

function typescript({ ignorePatterns = [], plugins = [], rules = {}, overrides = [] }: PresetOptions = {}): OxlintConfig {
  return {
    plugins: ['typescript', ...plugins],
    jsPlugins: [GHAR_PLUGIN],
    // Only the rules listed here, so a new oxlint release cannot turn on a category behind our back.
    categories: { correctness: 'off' },
    options: { typeAware: true, reportUnusedDisableDirectives: 'error' },
    env: { builtin: true },
    ignorePatterns: [...IGNORES, ...ignorePatterns],
    rules: { ...JS_RULES, ...TS_RULES, ...TYPE_AWARE_RULES, 'ghar/no-hex': 'error', ...rules },
    overrides: [
      {
        // The compiler already reports these in TypeScript.
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        rules: {
          ...off({
            'constructor-super': 'error',
            'getter-return': 'error',
            'no-class-assign': 'error',
            'no-const-assign': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-keys': 'error',
            'no-func-assign': 'error',
            'no-import-assign': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-obj-calls': 'error',
            'no-redeclare': 'error',
            'no-setter-return': 'error',
            'no-this-before-super': 'error',
            'no-unreachable': 'error',
            'no-unsafe-negation': 'error',
            'no-with': 'error',
          }),
          'no-var': 'error',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
        },
      },
      // Plain JS config files sit outside every tsconfig, so there is no type information for them.
      { files: ['**/*.js', '**/*.mjs', '**/*.cjs'], rules: off(TYPE_AWARE_RULES) },
      ...overrides,
    ],
  }
}

/**
 * core, contracts, db, tokens and config. With `allow`, files under src/ may import only those
 * packages, and never Node, Next, React, @ghar/db or an SDK.
 */
export function isomorphic({ allow }: { allow?: string[] } = {}): OxlintConfig {
  return typescript({
    overrides: allow ? [{ files: ['src/**'], rules: { 'ghar/isomorphic-imports': ['error', { allow }] } }] : [],
  })
}

export function next(): OxlintConfig {
  return typescript({
    ignorePatterns: ['.next/**', 'next-env.d.ts', 'out/**', 'build/**'],
    plugins: ['nextjs', 'react', 'import', 'jsx-a11y'],
    rules: {
      ...REACT_RULES,
      'nextjs/inline-script-id': 'error',
      'nextjs/no-assign-module-variable': 'error',
      'nextjs/no-document-import-in-page': 'error',
      'nextjs/no-duplicate-head': 'error',
      'nextjs/no-head-import-in-document': 'error',
      'nextjs/no-html-link-for-pages': 'error',
      'nextjs/no-script-component-in-head': 'error',
      'nextjs/no-sync-scripts': 'error',
      'nextjs/google-font-display': 'warn',
      'nextjs/google-font-preconnect': 'warn',
      'nextjs/next-script-for-ga': 'warn',
      'nextjs/no-async-client-component': 'warn',
      'nextjs/no-before-interactive-script-outside-document': 'warn',
      'nextjs/no-css-tags': 'warn',
      'nextjs/no-head-element': 'warn',
      'nextjs/no-img-element': 'warn',
      'nextjs/no-page-custom-font': 'warn',
      'nextjs/no-styled-jsx-in-document': 'warn',
      'nextjs/no-title-in-document-head': 'warn',
      'nextjs/no-typos': 'warn',
      'nextjs/no-unwanted-polyfillio': 'warn',
      'import/no-anonymous-default-export': 'warn',
      'jsx-a11y/alt-text': ['warn', { elements: ['img'], img: ['Image'] }],
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
    },
  })
}

export function reactNative(): OxlintConfig {
  return typescript({
    ignorePatterns: ['.expo/**', 'expo-env.d.ts', 'ios/**', 'android/**'],
    plugins: ['react', 'import'],
    rules: {
      ...REACT_RULES,
      'react/no-this-in-sfc': 'warn',
      'react/no-unknown-property': 'warn',
      'import/first': 'warn',
      'import/namespace': 'error',
      'import/no-duplicates': 'warn',
      'import/no-named-as-default': 'warn',
      'import/no-named-as-default-member': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-extend-native': 'warn',
      'no-extra-bind': 'warn',
      'unicode-bom': ['warn', 'never'],
      'no-var': 'error',
      'ghar/no-env-var-destructuring': 'error',
      'ghar/no-dynamic-env-var': 'error',
    },
    overrides: [
      {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
          'typescript/array-type': ['warn', { default: 'array' }],
          'typescript/consistent-type-assertions': ['warn', { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow' }],
        },
      },
      {
        // Metro loads its config with require(), so this one file stays CommonJS.
        files: ['metro.config.js'],
        env: { node: true },
        rules: { 'typescript/no-require-imports': 'off' },
      },
      { files: ['src/**'], rules: { 'ghar/mobile-imports': 'error' } },
    ],
  })
}
