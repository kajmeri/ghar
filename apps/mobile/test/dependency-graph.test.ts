/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeDependencyGraph } from './dependency-graph';

const MOBILE_DIR = join(import.meta.dirname, '..');

describe('apps/mobile dependency graph', () => {
  const report = analyzeDependencyGraph(MOBILE_DIR, '@casa/db');

  it('never includes @casa/db', () => {
    const { violation } = report;
    const message = violation
      ? `@casa/db is reachable from apps/mobile via ${violation.chain.join(' -> ')}${violation.file ? ` (imported in ${violation.file})` : ''}`
      : '';
    expect(violation, message).toBeNull();
  });

  it('actually walked the installed graph', () => {
    for (const name of ['@casa/core', '@casa/tokens', 'date-fns', 'expo', 'react-native']) {
      expect(report.reached).toContain(name);
    }
  });
});

describe('analyzeDependencyGraph', () => {
  const root = mkdtempSync(join(tmpdir(), 'casa-graph-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (path: string, content: unknown) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  };

  write('node_modules/@casa/db/package.json', { name: '@casa/db' });
  write('node_modules/left-pad/package.json', { name: 'left-pad' });
  write('node_modules/sneaky/package.json', {
    name: 'sneaky',
    dependencies: { 'left-pad': '*' },
    peerDependencies: { '@casa/db': '*' },
  });
  write('packages/ui/package.json', { name: '@casa/ui' });
  write('packages/ui/src/index.ts', "export { createDb } from '@casa/db/client';\n");
  mkdirSync(join(root, 'node_modules/@casa'), { recursive: true });
  symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/@casa/ui'), 'dir');
  write('node_modules/db-alias/package.json', { name: '@casa/db' });

  write('apps/clean/package.json', { name: 'clean', dependencies: { 'left-pad': '*' } });
  write('apps/transitive/package.json', { name: 'transitive', dependencies: { sneaky: '*' } });
  write('apps/undeclared/package.json', { name: 'undeclared', dependencies: { '@casa/ui': '*' } });
  write('apps/aliased/package.json', { name: 'aliased', devDependencies: { 'db-alias': '*' } });
  write('apps/direct/package.json', { name: 'direct' });
  write('apps/direct/src/app/index.tsx', "const db = await import('@casa/db');\n");

  const check = (app: string) => analyzeDependencyGraph(join(root, 'apps', app), '@casa/db');

  it('passes a graph without the target', () => {
    expect(check('clean').violation).toBeNull();
  });

  it('finds the target through a transitive dependency', () => {
    expect(check('transitive').violation).toEqual({ chain: ['transitive', 'sneaky', '@casa/db'] });
  });

  it('finds an undeclared import in a workspace package', () => {
    expect(check('undeclared').violation).toEqual({
      chain: ['undeclared', '@casa/ui'],
      file: join('src', 'index.ts'),
    });
  });

  it('finds a declared dependency that is not installed yet', () => {
    // Its own root, so the @casa/db installed in the shared fixture cannot resolve.
    const bare = mkdtempSync(join(tmpdir(), 'casa-graph-bare-'));
    try {
      mkdirSync(join(bare, 'packages/models'), { recursive: true });
      writeFileSync(
        join(bare, 'packages/models/package.json'),
        JSON.stringify({ name: '@casa/models', dependencies: { '@casa/db': 'workspace:*' } }),
      );
      mkdirSync(join(bare, 'node_modules/@casa'), { recursive: true });
      symlinkSync(join(bare, 'packages/models'), join(bare, 'node_modules/@casa/models'), 'dir');
      mkdirSync(join(bare, 'apps/app'), { recursive: true });
      writeFileSync(
        join(bare, 'apps/app/package.json'),
        JSON.stringify({ name: 'app', dependencies: { '@casa/models': 'workspace:*' } }),
      );

      expect(analyzeDependencyGraph(join(bare, 'apps/app'), '@casa/db').violation).toEqual({
        chain: ['app', '@casa/models', '@casa/db'],
      });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('finds the target installed under another name', () => {
    expect(check('aliased').violation).toEqual({ chain: ['aliased', 'db-alias'] });
  });

  it("finds the target in the app's own source", () => {
    expect(check('direct').violation).toEqual({
      chain: ['direct'],
      file: join('src', 'app', 'index.tsx'),
    });
  });
});
