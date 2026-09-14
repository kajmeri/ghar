import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the parts of apps/web worth testing on their own: the OpenGraph parsing
 * and the address check behind it. Everything else here is a route handler or a component,
 * covered through the contracts and the domain rules the packages already test.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` is a marker for the bundler, not a runtime dependency: its default
      // build throws on import. Everything under test here is server code, so this stands
      // in for the empty module a Server Component build resolves it to.
      'server-only': fileURLToPath(new URL('test/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
