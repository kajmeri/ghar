#!/usr/bin/env node
// Fails when a hex color appears anywhere in the current workspace outside tokens.json.
// oxlint's ghar/no-hex catches hex in TS/JS string literals; this also covers CSS, JSON and SVG.
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS_PATH = fileURLToPath(new URL('../tokens.json', import.meta.url))

const HEX = /(?<![\w&#/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g
const SKIP_DIRS = new Set(['node_modules', '.next', '.expo', '.turbo', 'dist', 'generated', 'coverage', 'ios', 'android'])
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.html', '.svg'])

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* files(path)
    } else if (EXTENSIONS.has(extname(entry.name)) && path !== TOKENS_PATH) {
      yield path
    }
  }
}

const root = process.cwd()
const findings: string[] = []
for (const file of files(root)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(HEX)) {
        findings.push(`${relative(root, file)}:${index + 1}  ${match[0]}`)
      }
    })
}

if (findings.length > 0) {
  console.error(`Hex colors belong in packages/tokens/tokens.json only. Use a token instead:\n${findings.map(f => `  ${f}`).join('\n')}`)
  process.exitCode = 1
}
