import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Every test runs real ESLint with type information, which is slow on a busy CI runner.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** A real file in each workspace, so type-aware rules resolve it inside that tsconfig. */
const WORKSPACES = [
  ['packages/core', 'src/index.ts'],
  ['packages/contracts', 'src/index.ts'],
  ['apps/mobile', 'src/app/index.tsx'],
  ['apps/web', 'app/layout.tsx'],
] as const;

const instances = new Map<string, ESLint>();

function eslintFor(workspace: string): ESLint {
  let eslint = instances.get(workspace);
  if (!eslint) {
    eslint = new ESLint({ cwd: join(ROOT, workspace) });
    instances.set(workspace, eslint);
  }
  return eslint;
}

/** Lints `code` as if it lived at `file` in `workspace`, using that workspace's real config. */
async function lint(workspace: string, file: string, code: string) {
  const results = await eslintFor(workspace).lintText(code, {
    filePath: join(ROOT, workspace, file),
  });
  return results.flatMap((result) => result.messages);
}

// Loading each config and building its TypeScript program is the slow part. Pay it once here
// rather than inside whichever test happens to run first.
beforeAll(async () => {
  for (const [workspace, file] of WORKSPACES) await lint(workspace, file, 'export {};\n');
});

async function boundaryErrors(workspace: string, file: string, code: string) {
  const messages = await lint(workspace, file, code);
  return messages
    .filter(
      ({ ruleId, message }) =>
        ruleId === 'no-restricted-imports' ||
        (ruleId === 'no-restricted-syntax' && message.includes('import()')),
    )
    .map(({ message }) => message);
}

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
];

describe.each([
  { workspace: 'packages/core', allowed: ['date-fns', 'zod'] },
  { workspace: 'packages/contracts', allowed: ['zod'] },
])('$workspace boundary', ({ workspace, allowed }) => {
  it.each(BANNED)('rejects %s', async (specifier) => {
    const errors = await boundaryErrors(
      workspace,
      'src/index.ts',
      `import value from '${specifier}';\nexport { value };\n`,
    );
    expect(errors).toHaveLength(1);
  });

  it('rejects type-only imports and re-exports', async () => {
    const errors = await boundaryErrors(
      workspace,
      'src/index.ts',
      "import type { NextRequest } from 'next/server';\nexport * from 'react';\nexport type { NextRequest };\n",
    );
    expect(errors).toHaveLength(2);
  });

  it('rejects dynamic import()', async () => {
    const errors = await boundaryErrors(
      workspace,
      'src/index.ts',
      "export const load = () => import('node:fs');\n",
    );
    expect(errors).toHaveLength(1);
  });

  it(`allows ${allowed.join(', ')} and relative imports`, async () => {
    const packages = allowed.map((name, index) => `import p${index} from '${name}';\n`).join('');
    const names = allowed.map((_, index) => `p${index}`).join(', ');
    const errors = await boundaryErrors(
      workspace,
      'src/index.ts',
      `${packages}import b from './errors';\nimport c from '../src/errors';\nexport { ${names}, b, c };\n`,
    );
    expect(errors).toEqual([]);
  });

  it('explains where the code should go', async () => {
    const [message] = await boundaryErrors(
      workspace,
      'src/index.ts',
      "import { createDb } from '@ghar/db';\nexport { createDb };\n",
    );
    expect(message).toContain('server-only and imported by apps/web alone');
  });
});

describe('apps/mobile boundary', () => {
  it.each(['@ghar/db', '@ghar/db/schema', 'node:fs', 'next/server', 'server-only'])(
    'rejects %s',
    async (specifier) => {
      const errors = await boundaryErrors(
        'apps/mobile',
        'src/app/index.tsx',
        `import value from '${specifier}';\nexport { value };\n`,
      );
      expect(errors).toHaveLength(1);
    },
  );

  it('allows the isomorphic packages', async () => {
    const errors = await boundaryErrors(
      'apps/mobile',
      'src/app/index.tsx',
      "import { formatCents } from '@ghar/core/money';\nimport { colors } from '@ghar/tokens';\nexport { colors, formatCents };\n",
    );
    expect(errors).toEqual([]);
  });
});

describe('hex colors', () => {
  // Assembled at runtime so this file holds no hex literal of its own.
  const hex = ['#', '14161A'].join('');

  it.each([
    ['packages/core', 'src/index.ts'],
    ['apps/mobile', 'src/app/index.tsx'],
    ['apps/web', 'app/layout.tsx'],
  ])('are rejected in %s', async (workspace, file) => {
    const messages = await lint(workspace, file, `export const ink = '${hex}';\n`);
    expect(messages.map(({ ruleId }) => ruleId)).toContain('no-restricted-syntax');
  });
});
