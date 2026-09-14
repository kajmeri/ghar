import { join } from 'node:path'
import { GENERATED_DIR, loadTokens, rem, writeGenerated, type Tokens } from './tokens.ts'

const HEADER = '/* Generated from packages/tokens/tokens.json by scripts/build-css.ts. Do not edit. */'

/** Custom properties for every color, named as in CLAUDE.md (--paper, --ink-muted, ...). */
export function renderTokensCss(tokens: Tokens): string {
  const colors = Object.entries(tokens.color).map(([name, { value, description }]) => `  --${name}: ${value}; /* ${description} */`)
  return [HEADER, '', ':root {', ...colors, '}', ''].join('\n')
}

/**
 * Tailwind v4 theme. Default palettes, radii and shadows are cleared so only Ghar tokens
 * produce utilities: `bg-paper`, `text-ink-muted`, `rounded-card`, `max-w-content`, `amount`.
 */
export function renderTailwindCss(tokens: Tokens): string {
  const { font, amount, typeScale, radius, space, layout, shadow, motion } = tokens
  const sans = [`var(${font.sans.cssVariable})`, `"${font.sans.family}"`, ...font.sans.fallback]

  const inline = [
    '  --color-*: initial;',
    ...Object.keys(tokens.color).map(name => `  --color-${name}: var(--${name});`),
    '',
    '  --font-*: initial;',
    `  --font-sans: ${sans.join(', ')};`,
    '',
    '  --shadow-*: initial;',
    '  --inset-shadow-*: initial;',
    '  --drop-shadow-*: initial;',
    '  --text-shadow-*: initial;',
    `  --shadow-overlay: 0 ${shadow.overlay.offsetY}px ${shadow.overlay.blur}px color-mix(in srgb, var(--${shadow.overlay.color}) ${Math.round(shadow.overlay.opacity * 100)}%, transparent);`,
  ]

  const values = [
    '  --text-*: initial;',
    ...Object.entries(typeScale).flatMap(([step, { fontSize, lineHeight }]) => [
      `  --text-${step}: ${rem(fontSize)};`,
      `  --text-${step}--line-height: ${rem(lineHeight)};`,
    ]),
    '',
    ...Object.entries(font.weight).map(([name, weight]) => `  --font-weight-${name}: ${weight};`),
    '',
    '  --radius-*: initial;',
    ...Object.entries(radius).map(([name, { value }]) => `  --radius-${name}: ${value}px;`),
    '',
    `  --spacing: ${rem(space.unit)};`,
    `  --spacing-tap: ${rem(layout.tapTarget)};`,
    `  --container-content: ${rem(layout.contentMaxWidth)};`,
    '',
    // Cleared so nothing pulses, pings or bounces on its own. Overlay animations live in the app.
    '  --animate-*: initial;',
    '  --ease-*: initial;',
    ...Object.entries(motion.easing).map(([name, points]) => `  --ease-${name}: cubic-bezier(${points.join(', ')});`),
    ...Object.entries(motion.duration).map(([name, ms]) => `  --duration-${name}: ${ms}ms;`),
  ]

  return [
    HEADER,
    '',
    '@theme inline {',
    ...inline,
    '}',
    '',
    '/* static: emitted even when no utility uses them, so pages can read them as var(). */',
    '@theme static {',
    ...values,
    '}',
    '',
    '/* Large money figures. */',
    '@utility amount {',
    `  font-weight: ${amount.fontWeight};`,
    `  letter-spacing: ${amount.letterSpacingEm}em;`,
    `  font-variant-numeric: ${font.numeric};`,
    '}',
    '',
    '@layer base {',
    '  html {',
    `    font-variant-numeric: ${font.numeric};`,
    '  }',
    '}',
    '',
  ].join('\n')
}

export function buildCss(tokens = loadTokens()): string[] {
  const written: string[] = []
  for (const [file, content] of [
    ['tokens.css', renderTokensCss(tokens)],
    ['tailwind.css', renderTailwindCss(tokens)],
  ] as const) {
    if (writeGenerated(join(GENERATED_DIR, file), content)) written.push(file)
  }
  return written
}

if (import.meta.main) {
  const written = buildCss()
  console.log(written.length > 0 ? `tokens: wrote ${written.join(', ')}` : 'tokens: CSS up to date')
}
