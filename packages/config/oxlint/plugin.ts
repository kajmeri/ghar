// Ghar's own lint rules, loaded by oxlint as a JS plugin. They cover what no built-in rule does:
// the package boundaries from CLAUDE.md, the hex color ban, and Expo's env var inlining.
import { builtinModules } from 'node:module'
import type { RuleTester } from 'oxlint/plugins-dev'

type Rule = Parameters<RuleTester['run']>[1]
type Context = Parameters<NonNullable<Rule['create']>>[0]
type Visitor = ReturnType<NonNullable<Rule['create']>>
type Reported = NonNullable<Parameters<Context['report']>[0]['node']>

interface Ban {
  /** Package names. One ending in `/`, `-` or `:` bans everything with that prefix. */
  names: readonly string[]
  message: string
}

const NODE_MESSAGE = 'Node APIs are not isomorphic. Move this code to apps/web.'
const DYNAMIC_IMPORT_MESSAGE = 'Dynamic import() skips the package boundary check. Use a static import.'

const SDKS = [
  '@supabase/',
  '@anthropic-ai/',
  '@aws-sdk/',
  '@google-cloud/',
  '@vercel/',
  '@expo/',
  'expo',
  'expo-',
  'resend',
  'plaid',
  'googleapis',
  'google-auth-library',
  'stripe',
  'openai',
  'drizzle-orm',
  'postgres',
  'pg',
  'server-only',
  'client-only',
]

export const ISOMORPHIC_BANS: readonly Ban[] = [
  { names: ['node:', ...builtinModules.filter(name => !name.startsWith('_'))], message: NODE_MESSAGE },
  { names: ['next'], message: 'Next.js belongs in apps/web. core and contracts run on the phone too.' },
  { names: ['react', 'react-dom', 'react-native'], message: 'React belongs in the apps. core and contracts have no UI.' },
  { names: ['@ghar/db'], message: '@ghar/db is server-only and imported by apps/web alone.' },
  { names: SDKS, message: 'SDKs are I/O. Put the adapter in apps/web/lib/providers and pass domain types in.' },
]

const MOBILE_BANS: readonly Ban[] = [
  { names: ['@ghar/db'], message: 'Mobile is an API client. Call apps/web through @ghar/contracts instead.' },
  { names: ['node:', 'next', 'server-only'], message: 'Server-only module. Mobile reaches the server through the API.' },
]

function matches(specifier: string, names: readonly string[]): boolean {
  return names.some(name => (/[/:-]$/.test(name) ? specifier.startsWith(name) : specifier === name || specifier.startsWith(`${name}/`)))
}

const isRelative = (specifier: string) => /^\.{1,2}(?:\/|$)/.test(specifier)

/** Calls `check` with every static module specifier: imports, re-exports and `import x = require()`. */
function staticImports(check: (node: Reported, specifier: string) => void): Visitor {
  return {
    ImportDeclaration: node => {
      check(node, node.source.value)
    },
    ExportAllDeclaration: node => {
      check(node, node.source.value)
    },
    ExportNamedDeclaration: node => {
      if (node.source) check(node, node.source.value)
    },
    TSImportEqualsDeclaration: node => {
      if (node.moduleReference.type === 'TSExternalModuleReference') check(node, node.moduleReference.expression.value)
    },
  }
}

function allowOption(context: Context): string[] {
  const [options] = context.options
  if (options && typeof options === 'object' && !Array.isArray(options) && Array.isArray(options.allow)) {
    return options.allow.filter(name => typeof name === 'string')
  }
  throw new Error(`${context.id} needs an { allow: string[] } option.`)
}

/** core and contracts: nothing from Node, Next, React, @ghar/db or an SDK, and only allowlisted packages. */
const isomorphicImports: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep isomorphic packages free of platform, server and SDK imports.' },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        required: ['allow'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allow = allowOption(context)
    const unlisted = `Only ${allow.join(', ')} and relative imports are allowed here. Adding a dependency to core or contracts needs a reason (see CLAUDE.md).`
    return {
      ...staticImports((node, specifier) => {
        const ban = ISOMORPHIC_BANS.find(({ names }) => matches(specifier, names))
        if (ban) context.report({ node, message: ban.message })
        else if (!isRelative(specifier) && !matches(specifier, allow)) context.report({ node, message: unlisted })
      }),
      ImportExpression: node => {
        context.report({ node, message: DYNAMIC_IMPORT_MESSAGE })
      },
    }
  },
}

/** apps/mobile: a client of the API, so no server-only modules. */
const mobileImports: Rule = {
  meta: { type: 'problem', docs: { description: 'Keep server-only modules out of the mobile app.' } },
  create(context) {
    return staticImports((node, specifier) => {
      const ban = MOBILE_BANS.find(({ names }) => matches(specifier, names))
      if (ban) context.report({ node, message: ban.message })
    })
  },
}

const HEX_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
const HEX_MESSAGE = 'Hex colors live only in packages/tokens/tokens.json. Use a token (CSS variable, Tailwind class, or @ghar/tokens).'

const noHex: Rule = {
  meta: { type: 'problem', docs: { description: 'Colors come from @ghar/tokens, never a hex literal.' } },
  create(context) {
    return {
      Literal: node => {
        if (typeof node.value === 'string' && HEX_COLOR.test(node.value)) context.report({ node, message: HEX_MESSAGE })
      },
      TemplateElement: node => {
        if (HEX_COLOR.test(node.value.raw)) context.report({ node, message: HEX_MESSAGE })
      },
    }
  },
}

type Expression = Parameters<NonNullable<Visitor['MemberExpression']>>[0]['object']

const isProcessEnv = (node: Expression | null) =>
  node?.type === 'MemberExpression' &&
  node.object.type === 'Identifier' &&
  node.object.name === 'process' &&
  !node.computed &&
  node.property.name === 'env'

// Expo inlines EXPO_PUBLIC_* only where the code reads `process.env.NAME` literally. These two
// are ported from eslint-plugin-expo.
const noEnvVarDestructuring: Rule = {
  meta: { type: 'problem', docs: { description: 'Disallow destructuring of environment variables.' } },
  create(context) {
    return {
      VariableDeclarator: node => {
        if (node.id.type !== 'ObjectPattern' || !isProcessEnv(node.init)) return
        for (const property of node.id.properties) {
          const name = property.type === 'Property' && property.value.type === 'Identifier' ? property.value.name : 'variables'
          context.report({ node, message: `Unexpected destructuring. Cannot destructure ${name} from process.env` })
        }
      },
    }
  },
}

const noDynamicEnvVar: Rule = {
  meta: { type: 'problem', docs: { description: 'Prevent process.env from being accessed dynamically.' } },
  create(context) {
    return {
      VariableDeclarator: node => {
        const { init } = node
        if (init?.type !== 'MemberExpression' || !init.computed || !isProcessEnv(init.object)) return
        const { property } = init
        const name = property.type === 'Identifier' ? property.name : property.type === 'Literal' ? String(property.value) : ''
        context.report({ node, message: `Unexpected dynamic access. Cannot dynamically access ${name} from process.env` })
      },
    }
  },
}

export const rules = {
  'isomorphic-imports': isomorphicImports,
  'mobile-imports': mobileImports,
  'no-hex': noHex,
  'no-env-var-destructuring': noEnvVarDestructuring,
  'no-dynamic-env-var': noDynamicEnvVar,
}

export default { meta: { name: 'ghar' }, rules }
