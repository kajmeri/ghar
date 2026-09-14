/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeDependencyGraph } from './dependency-graph'

const MOBILE_DIR = join(import.meta.dirname, '..')

describe('apps/mobile dependency graph', () => {
  const report = analyzeDependencyGraph(MOBILE_DIR, '@ghar/db')

  it('never includes @ghar/db', () => {
    const { violation } = report
    const message = violation
      ? `@ghar/db is reachable from apps/mobile via ${violation.chain.join(' -> ')}${violation.file ? ` (imported in ${violation.file})` : ''}`
      : ''
    expect(violation, message).toBeNull()
  })

  it('actually walked the installed graph', () => {
    for (const name of ['@ghar/core', '@ghar/tokens', 'date-fns', 'expo', 'react-native']) {
      expect(report.reached).toContain(name)
    }
  })
})

describe('analyzeDependencyGraph', () => {
  const root = mkdtempSync(join(tmpdir(), 'ghar-graph-'))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const write = (path: string, content: unknown) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  }

  write('node_modules/@ghar/db/package.json', { name: '@ghar/db' })
  write('node_modules/left-pad/package.json', { name: 'left-pad' })
  write('node_modules/sneaky/package.json', {
    name: 'sneaky',
    dependencies: { 'left-pad': '*' },
    peerDependencies: { '@ghar/db': '*' },
  })
  write('packages/ui/package.json', { name: '@ghar/ui' })
  write('packages/ui/src/index.ts', "export { createDb } from '@ghar/db/client';\n")
  mkdirSync(join(root, 'node_modules/@ghar'), { recursive: true })
  symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/@ghar/ui'), 'dir')
  write('node_modules/db-alias/package.json', { name: '@ghar/db' })

  write('apps/clean/package.json', { name: 'clean', dependencies: { 'left-pad': '*' } })
  write('apps/transitive/package.json', { name: 'transitive', dependencies: { sneaky: '*' } })
  write('apps/undeclared/package.json', { name: 'undeclared', dependencies: { '@ghar/ui': '*' } })
  write('apps/aliased/package.json', { name: 'aliased', devDependencies: { 'db-alias': '*' } })
  write('apps/direct/package.json', { name: 'direct' })
  write('apps/direct/src/app/index.tsx', "const db = await import('@ghar/db');\n")

  const check = (app: string) => analyzeDependencyGraph(join(root, 'apps', app), '@ghar/db')

  it('passes a graph without the target', () => {
    expect(check('clean').violation).toBeNull()
  })

  it('finds the target through a transitive dependency', () => {
    expect(check('transitive').violation).toEqual({ chain: ['transitive', 'sneaky', '@ghar/db'] })
  })

  it('finds an undeclared import in a workspace package', () => {
    expect(check('undeclared').violation).toEqual({
      chain: ['undeclared', '@ghar/ui'],
      file: join('src', 'index.ts'),
    })
  })

  it('finds a declared dependency that is not installed yet', () => {
    // Its own root, so the @ghar/db installed in the shared fixture cannot resolve.
    const bare = mkdtempSync(join(tmpdir(), 'ghar-graph-bare-'))
    try {
      mkdirSync(join(bare, 'packages/models'), { recursive: true })
      writeFileSync(
        join(bare, 'packages/models/package.json'),
        JSON.stringify({ name: '@ghar/models', dependencies: { '@ghar/db': 'workspace:*' } })
      )
      mkdirSync(join(bare, 'node_modules/@ghar'), { recursive: true })
      symlinkSync(join(bare, 'packages/models'), join(bare, 'node_modules/@ghar/models'), 'dir')
      mkdirSync(join(bare, 'apps/app'), { recursive: true })
      writeFileSync(join(bare, 'apps/app/package.json'), JSON.stringify({ name: 'app', dependencies: { '@ghar/models': 'workspace:*' } }))

      expect(analyzeDependencyGraph(join(bare, 'apps/app'), '@ghar/db').violation).toEqual({
        chain: ['app', '@ghar/models', '@ghar/db'],
      })
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('finds the target installed under another name', () => {
    expect(check('aliased').violation).toEqual({ chain: ['aliased', 'db-alias'] })
  })

  it("finds the target in the app's own source", () => {
    expect(check('direct').violation).toEqual({
      chain: ['direct'],
      file: join('src', 'app', 'index.tsx'),
    })
  })
})
