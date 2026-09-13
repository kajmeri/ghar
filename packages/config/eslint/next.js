import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import { typescript } from './typescript.js';

/**
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function next({ tsconfigRootDir }) {
  return [
    { ignores: ['.next/**', 'next-env.d.ts'] },
    ...nextVitals,
    ...nextTypescript,
    ...typescript({ tsconfigRootDir }),
    prettier,
  ];
}
