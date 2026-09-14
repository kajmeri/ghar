/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'

interface Manifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface Violation {
  /** Package names from the start package to the package that pulls in the target. */
  chain: string[]
  /** Set when the target is imported in source without being declared. */
  file?: string
}

export interface GraphReport {
  /** Every package name reached from the start package. */
  reached: Set<string>
  violation: Violation | null
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_DIRS = new Set(['node_modules', '.expo', '.next', '.turbo', 'dist', 'test', '__tests__'])

/**
 * Walks everything a workspace can load: its dependencies and devDependencies, then the
 * dependencies, optional and peer dependencies of each package they resolve to, following
 * Node resolution from each package's real location. Workspace packages reached at runtime
 * also have their source scanned, so an undeclared `import '@ghar/db'` is caught too.
 */
export function analyzeDependencyGraph(startDir: string, target: string): GraphReport {
  const start = realpathSync(startDir)
  const startManifest = readManifest(start)
  const reached = new Set<string>()
  const visited = new Set<string>([start])

  const scanHit = scanSource(start, target)
  if (scanHit) {
    return { reached, violation: { chain: [label(startManifest, start)], file: scanHit } }
  }

  interface Step {
    dir: string
    chain: string[]
    runtime: boolean
  }
  const queue: Step[] = []
  const enqueue = (from: string, deps: Record<string, string> | undefined, chain: string[], runtime: boolean) => {
    for (const name of Object.keys(deps ?? {})) queue.push({ dir: from, chain: [...chain, name], runtime })
  }

  const root = [label(startManifest, start)]
  enqueue(start, startManifest.dependencies, root, true)
  enqueue(start, startManifest.optionalDependencies, root, true)
  enqueue(start, startManifest.devDependencies, root, false)

  for (let step = queue.shift(); step; step = queue.shift()) {
    const name = step.chain.at(-1) ?? ''
    // Declaring the target is a violation even before an install links it.
    if (name === target) return { reached, violation: { chain: step.chain } }

    const dir = resolvePackageDir(name, step.dir)
    if (!dir) continue

    const manifest = readManifest(dir)
    const resolvedName = manifest.name ?? name
    reached.add(resolvedName)
    if (resolvedName === target) return { reached, violation: { chain: step.chain } }
    if (visited.has(dir)) continue
    visited.add(dir)

    if (step.runtime && isWorkspacePackage(dir)) {
      const file = scanSource(dir, target)
      if (file) return { reached, violation: { chain: step.chain, file } }
    }

    enqueue(dir, manifest.dependencies, step.chain, step.runtime)
    enqueue(dir, manifest.optionalDependencies, step.chain, step.runtime)
    enqueue(dir, manifest.peerDependencies, step.chain, step.runtime)
  }

  return { reached, violation: null }
}

export function resolvePackageDir(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) return undefined
  }
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
}

function label(manifest: Manifest, dir: string): string {
  return manifest.name ?? dir
}

function isWorkspacePackage(dir: string): boolean {
  return !`${dir}${sep}`.includes(`${sep}node_modules${sep}`)
}

function scanSource(dir: string, target: string): string | undefined {
  const escaped = target.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const specifier = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]${escaped}(?:/[^'"]*)?['"]`)

  const walk = (current: string): string | undefined => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const hit = walk(path)
        if (hit) return hit
      } else if (
        SOURCE_EXTENSIONS.has(extname(entry.name)) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) &&
        specifier.test(readFileSync(path, 'utf8'))
      ) {
        return relative(dir, path)
      }
    }
    return undefined
  }
  return walk(dir)
}
