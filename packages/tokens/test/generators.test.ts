import { describe, expect, it } from 'vitest'
import { renderTailwindCss, renderTokensCss } from '../scripts/build-css.ts'
import { renderNativeTokens } from '../scripts/build-native.ts'
import { loadTokens, parseTokens } from '../scripts/tokens.ts'
import * as generated from '../generated/tokens.ts'

const tokens = loadTokens()

describe('tokens.json', () => {
  it('holds the CLAUDE.md palette, plus the text-safe and control-border shades', () => {
    expect(Object.keys(tokens.color)).toEqual([
      'paper',
      'surface',
      'ink',
      'ink-muted',
      'line',
      'line-strong',
      'positive',
      'caution',
      'caution-ink',
      'negative',
    ])
  })

  it('rejects malformed tokens with a readable message', () => {
    const broken = structuredClone(tokens)
    broken.color.ink = { value: 'black', description: 'Primary text' }
    expect(() => parseTokens(broken)).toThrow(/Colors are six-digit hex/)
  })
})

describe('generators', () => {
  it('emits every color as a CSS custom property and a Tailwind color', () => {
    const css = renderTokensCss(tokens)
    const tailwind = renderTailwindCss(tokens)
    for (const [name, { value }] of Object.entries(tokens.color)) {
      expect(css).toContain(`--${name}: ${value};`)
      expect(tailwind).toContain(`--color-${name}: var(--${name});`)
    }
  })

  it('keeps hex values out of the Tailwind theme', () => {
    expect(renderTailwindCss(tokens)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('clears Tailwind defaults so nothing renders in slate or blue', () => {
    const tailwind = renderTailwindCss(tokens)
    for (const namespace of ['color', 'radius', 'shadow', 'text']) {
      expect(tailwind).toContain(`--${namespace}-*: initial;`)
    }
  })

  it('emits the amount treatment for web and native', () => {
    expect(renderTailwindCss(tokens)).toMatch(
      /@utility amount \{\s+font-weight: 600;\s+letter-spacing: -0.02em;\s+font-variant-numeric: tabular-nums;/
    )
    expect(generated.amount['3xl']).toEqual({
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '600',
      letterSpacing: -0.6,
      fontVariant: ['tabular-nums'],
    })
  })

  it('generated/tokens.ts is current with tokens.json', async () => {
    const { readFileSync } = await import('node:fs')
    const onDisk = readFileSync(new URL('../generated/tokens.ts', import.meta.url), 'utf8')
    expect(onDisk).toBe(renderNativeTokens(tokens))
    expect(generated.colors.inkMuted).toBe(tokens.color['ink-muted']?.value)
    expect(generated.radius).toEqual({ card: 12, control: 8, pill: 999 })
    expect(generated.space[4]).toBe(16)
    expect(generated.motion.duration.overlay).toBe(tokens.motion.duration.overlay)
  })

  it('emits motion tokens and clears the default animations', () => {
    const tailwind = renderTailwindCss(tokens)
    expect(tailwind).toContain('--animate-*: initial;')
    expect(tailwind).toContain('--ease-enter: cubic-bezier(0.2, 0, 0, 1);')
    expect(tailwind).toContain('--duration-overlay: 200ms;')
  })
})
