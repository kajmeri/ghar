import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const TOKENS_PATH = fileURLToPath(new URL('../tokens.json', import.meta.url))
export const GENERATED_DIR = fileURLToPath(new URL('../generated/', import.meta.url))

const kebab = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const tokensSchema = z
  .object({
    color: z.record(
      z.string().regex(kebab, 'Color names are kebab-case'),
      z.object({
        value: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colors are six-digit hex'),
        description: z.string().min(1),
      })
    ),
    font: z.object({
      sans: z.object({
        family: z.string().min(1),
        cssVariable: z.string().startsWith('--'),
        fallback: z.array(z.string().min(1)),
      }),
      weight: z.record(z.string().regex(kebab), z.int().min(100).max(900)),
      numeric: z.literal('tabular-nums'),
    }),
    amount: z.object({
      fontWeight: z.int().min(100).max(900),
      letterSpacingEm: z.number(),
    }),
    typeScale: z.record(z.string().regex(/^[a-z0-9]+$/), z.object({ fontSize: z.number().positive(), lineHeight: z.number().positive() })),
    radius: z.record(z.string().regex(kebab), z.object({ value: z.number().nonnegative(), description: z.string().min(1) })),
    space: z.object({
      unit: z.number().positive(),
      steps: z.array(z.int().nonnegative()),
    }),
    layout: z.object({
      tapTarget: z.number().positive(),
      contentMaxWidth: z.number().positive(),
    }),
    shadow: z.object({
      overlay: z.object({
        offsetY: z.number(),
        blur: z.number().nonnegative(),
        color: z.string(),
        opacity: z.number().min(0).max(1),
      }),
    }),
    motion: z.object({
      duration: z.record(z.string().regex(kebab), z.int().positive()),
      easing: z.record(z.string().regex(kebab), z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()])),
    }),
  })
  .superRefine((tokens, ctx) => {
    if (!(tokens.shadow.overlay.color in tokens.color)) {
      ctx.addIssue({
        code: 'custom',
        path: ['shadow', 'overlay', 'color'],
        message: `"${tokens.shadow.overlay.color}" is not a color token`,
      })
    }
  })

export type Tokens = z.infer<typeof tokensSchema>

export function parseTokens(raw: unknown): Tokens {
  const result = tokensSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`tokens.json is invalid:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

export function loadTokens(path = TOKENS_PATH): Tokens {
  return parseTokens(JSON.parse(readFileSync(path, 'utf8')))
}

export function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())
}

export function rem(px: number): string {
  return `${Number((px / 16).toFixed(4))}rem`
}

/** Writes only when the content changed, so watchers downstream do not reload for nothing. */
export function writeGenerated(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return true
}
