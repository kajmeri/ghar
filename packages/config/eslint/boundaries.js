import { builtinModules } from 'node:module';
import { NO_HEX_SYNTAX } from './typescript.js';

// ESLint compiles these patterns with the `u` flag, where escaping `-` or `/` is a syntax error.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = (names) => names.map(escape).join('|');

const NODE_BUILTINS = builtinModules.filter((name) => !name.startsWith('_'));

/**
 * SDKs and server/runtime-bound packages. The allowlist below already rejects anything not
 * listed; these entries exist so the most likely mistakes get a message that says where the
 * code should go instead.
 */
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
];

/** @type {{ regex: string, message: string }[]} */
export const BANNED_IMPORTS = [
  {
    regex: '^node:',
    message: 'Node APIs are not isomorphic. Move this code to apps/web.',
  },
  {
    regex: `^(?:${oneOf(NODE_BUILTINS)})(?:/|$)`,
    message: 'Node APIs are not isomorphic. Move this code to apps/web.',
  },
  {
    regex: '^next(?:/|$)',
    message: 'Next.js belongs in apps/web. core and contracts run on the phone too.',
  },
  {
    regex: '^react(?:-dom|-native)?(?:/|$)',
    message: 'React belongs in the apps. core and contracts have no UI.',
  },
  {
    regex: '^@casa/db(?:/|$)',
    message: '@casa/db is server-only and imported by apps/web alone.',
  },
  {
    regex: `^(?:${SDKS.map((sdk) => (sdk.endsWith('/') || sdk.endsWith('-') ? escape(sdk) : `${escape(sdk)}(?:/|$)`)).join('|')})`,
    message: 'SDKs are I/O. Put the adapter in apps/web/lib/providers and pass domain types in.',
  },
];

/**
 * Package boundary for @casa/core and @casa/contracts: the explicit bans above, plus an
 * allowlist so a new dependency cannot slip in without someone changing this call.
 *
 * @param {{ files: string[], allow: string[] }} options
 * @returns {import('eslint').Linter.Config}
 */
export function boundaries({ files, allow }) {
  const permitted = [String.raw`\.{1,2}(?:/|$)`, ...allow.map((name) => `${escape(name)}(?:/|$)`)];
  const alreadyBanned = BANNED_IMPORTS.map(({ regex }) => regex.slice(1));

  return {
    name: 'casa/boundaries',
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...BANNED_IMPORTS,
            {
              regex: `^(?!${[...permitted, ...alreadyBanned].join('|')})`,
              message: `Only ${allow.join(', ')} and relative imports are allowed here. Adding a dependency to core or contracts needs a reason (see CLAUDE.md).`,
            },
          ],
        },
      ],
      // no-restricted-imports only sees static imports, so close the import() side door.
      // (require() is already an error through @typescript-eslint/no-require-imports.)
      'no-restricted-syntax': [
        'error',
        ...NO_HEX_SYNTAX,
        {
          selector: 'ImportExpression',
          message: 'Dynamic import() skips the package boundary check. Use a static import.',
        },
      ],
    },
  };
}
