import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it } from 'vitest'

import mobile from '../../../apps/mobile/oxlint.config.mts'
import web from '../../../apps/web/oxlint.config.ts'
import contracts from '../../contracts/oxlint.config.ts'
import core from '../../core/oxlint.config.ts'
import plugin, { rules } from '../oxlint/plugin.ts'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({ languageOptions: { sourceType: 'module' } })

const BANNED = [
  'node:fs',
  'node:crypto',
  'fs',
  'path/posix',
  'next',
  'next/server',
  'react',
  'react-dom/client',
  'react-native',
  '@ghar/db',
  '@ghar/db/schema',
  '@supabase/supabase-js',
  '@anthropic-ai/sdk',
  'resend',
  'plaid',
  'expo-router',
  'drizzle-orm/pg-core',
  'server-only',
  // Not named anywhere: rejected by the allowlist.
  'lodash',
  '@ghar/tokens',
]

for (const { workspace, allow } of [
  { workspace: 'packages/core', allow: ['date-fns', 'zod'] },
  { workspace: 'packages/contracts', allow: ['zod'] },
]) {
  const base = { filename: 'src/index.ts', options: [{ allow }] }

  tester.run(`ghar/isomorphic-imports in ${workspace}`, rules['isomorphic-imports'], {
    valid: [
      {
        ...base,
        name: `allows ${allow.join(', ')} and relative imports`,
        code: [
          ...allow.map((name, index) => `import p${index} from '${name}'`),
          "import b from './errors'",
          "import c from '../src/errors'",
        ].join('\n'),
      },
    ],
    invalid: [
      ...BANNED.map(specifier => ({ ...base, name: `rejects ${specifier}`, code: `import value from '${specifier}'`, errors: 1 })),
      {
        ...base,
        name: 'rejects type-only imports and re-exports',
        code: "import type { NextRequest } from 'next/server'\nexport * from 'react'\nexport type { NextRequest }",
        errors: 2,
      },
      { ...base, name: 'rejects import = require()', code: "import fs = require('node:fs')", errors: 1 },
      {
        ...base,
        name: 'rejects dynamic import()',
        code: "export const load = () => import('node:fs')",
        errors: [{ message: /^Dynamic import\(\) skips/ }],
      },
      {
        ...base,
        name: 'explains where the code should go',
        code: "import { createDb } from '@ghar/db'",
        errors: [{ message: /server-only and imported by apps\/web alone/ }],
      },
    ],
  })
}

tester.run('ghar/mobile-imports', rules['mobile-imports'], {
  valid: [
    {
      name: 'allows the isomorphic packages and Expo',
      filename: 'src/app/index.tsx',
      code: "import { formatCents } from '@ghar/core/money'\nimport { colors } from '@ghar/tokens'\nimport { Link } from 'expo-router'",
    },
  ],
  invalid: ['@ghar/db', '@ghar/db/schema', 'node:fs', 'next/server', 'server-only'].map(specifier => ({
    name: `rejects ${specifier}`,
    filename: 'src/app/index.tsx',
    code: `import value from '${specifier}'`,
    errors: 1,
  })),
})

// Assembled at runtime so this file holds no hex literal of its own.
const hex = ['#', '14161A'].join('')

tester.run('ghar/no-hex', rules['no-hex'], {
  valid: ["export const ink = 'var(--ink)'", "export const anchor = '#section'"],
  invalid: [
    { code: `export const ink = '${hex}'`, errors: 1 },
    { code: `export const ink = '${hex}CC'`, errors: 1 },
    { code: `export const border = \`1px solid ${hex}\``, errors: 1 },
  ],
})

tester.run('ghar/no-env-var-destructuring', rules['no-env-var-destructuring'], {
  valid: ['const url = process.env.EXPO_PUBLIC_API_URL'],
  invalid: [
    {
      code: 'const { EXPO_PUBLIC_API_URL, ...rest } = process.env',
      errors: [
        { message: 'Unexpected destructuring. Cannot destructure EXPO_PUBLIC_API_URL from process.env' },
        { message: 'Unexpected destructuring. Cannot destructure variables from process.env' },
      ],
    },
  ],
})

tester.run('ghar/no-dynamic-env-var', rules['no-dynamic-env-var'], {
  valid: ['const url = process.env.EXPO_PUBLIC_API_URL', 'const value = settings[name]'],
  invalid: [
    {
      code: 'const url = process.env[name]',
      errors: [{ message: 'Unexpected dynamic access. Cannot dynamically access name from process.env' }],
    },
    {
      code: "const url = process.env['EXPO_PUBLIC_API_URL']",
      errors: [{ message: 'Unexpected dynamic access. Cannot dynamically access EXPO_PUBLIC_API_URL from process.env' }],
    },
  ],
})

// The rules above are only as good as the workspace configs that turn them on.
describe('workspace oxlint configs', () => {
  const configs = { 'packages/core': core, 'packages/contracts': contracts, 'apps/mobile': mobile, 'apps/web': web }

  it.each(Object.entries(configs))('%s loads the ghar plugin with type-aware rules and the hex ban', (_, config) => {
    expect(config.jsPlugins).toContain('@ghar/config/oxlint/plugin')
    expect(config.options).toMatchObject({ typeAware: true, reportUnusedDisableDirectives: 'error' })
    expect(config.rules).toHaveProperty(['ghar/no-hex'], 'error')
  })

  it.each([
    { workspace: 'packages/core', config: core, allow: ['date-fns', 'zod'] },
    { workspace: 'packages/contracts', config: contracts, allow: ['zod'] },
  ])('$workspace checks imports under src', ({ config, allow }) => {
    expect(config.overrides).toContainEqual({ files: ['src/**'], rules: { 'ghar/isomorphic-imports': ['error', { allow }] } })
  })

  it('apps/mobile checks imports under src', () => {
    expect(mobile.overrides).toContainEqual({ files: ['src/**'], rules: { 'ghar/mobile-imports': 'error' } })
  })

  it('names only rules the plugin defines', () => {
    const named = Object.values(configs).flatMap(config =>
      [config.rules, ...(config.overrides ?? []).map(override => override.rules)].flatMap(ruleSet => Object.keys(ruleSet ?? {}))
    )
    const ghar = new Set(named.filter(name => name.startsWith(`${plugin.meta.name}/`)))
    expect([...ghar].sort()).toEqual(
      Object.keys(rules)
        .map(name => `ghar/${name}`)
        .sort()
    )
  })
})
