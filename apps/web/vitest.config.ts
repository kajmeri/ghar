import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // `server-only` throws outside a React Server environment. Tests only run server code.
      { find: /^server-only$/, replacement: `${root}test/support/server-only.ts` },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The job tests migrate a fresh PGlite database in beforeAll, which is slow while `turbo run`
    // has typecheck and lint competing for the CPU.
    hookTimeout: 60_000,
  },
})
