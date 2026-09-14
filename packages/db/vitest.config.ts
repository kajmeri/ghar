import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Every file migrates a fresh PGlite database in beforeAll. That takes a couple of seconds
    // alone, and far longer while `turbo run` has typecheck and lint competing for the CPU.
    hookTimeout: 60_000,
  },
})
