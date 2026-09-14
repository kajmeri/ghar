import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests run ESLint itself. The first lintText call builds the whole type-aware
    // config, which takes well past the 5s default on a cold cache while the rest of the
    // repo's tasks are competing for the same cores.
    testTimeout: 60_000,
  },
});
