import prettier from 'eslint-config-prettier/flat';
import { boundaries } from './boundaries.js';
import { typescript } from './typescript.js';

/**
 * For packages that run everywhere. Pass `allow` to enforce the import boundary on src/;
 * omit it for server-only packages such as @casa/db.
 *
 * @param {{ tsconfigRootDir: string, allow?: string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function isomorphic({ tsconfigRootDir, allow }) {
  return [
    ...typescript({ tsconfigRootDir }),
    ...(allow ? [boundaries({ files: ['src/**'], allow })] : []),
    prettier,
  ];
}
