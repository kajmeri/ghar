import { join } from 'node:path';
import { GENERATED_DIR, camelCase, loadTokens, writeGenerated, type Tokens } from './tokens.ts';

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** A typed, `as const` object for React Native (and any TS that wants token values). */
export function renderNativeTokens(tokens: Tokens): string {
  const colorEntries = Object.entries(tokens.color);
  const colors = Object.fromEntries(
    colorEntries.map(([name, { value }]) => [camelCase(name), value]),
  );
  const colorTokens = colorEntries.map(([name, { value, description }]) => ({
    name: camelCase(name),
    cssVariable: `--${name}`,
    value,
    description,
  }));

  const fontWeight = Object.fromEntries(
    Object.entries(tokens.font.weight).map(([name, weight]) => [camelCase(name), String(weight)]),
  );

  // React Native letterSpacing is in points, so -0.02em is resolved per size.
  const amount = Object.entries(tokens.typeScale).map(
    ([step, { fontSize, lineHeight }]) =>
      `  ${JSON.stringify(step)}: { fontSize: ${fontSize}, lineHeight: ${lineHeight}, fontWeight: ${JSON.stringify(String(tokens.amount.fontWeight))}, letterSpacing: ${Number((tokens.amount.letterSpacingEm * fontSize).toFixed(3))}, fontVariant: tabularNums },`,
  );

  const radius = Object.fromEntries(
    Object.entries(tokens.radius).map(([name, { value }]) => [camelCase(name), value]),
  );
  const space = Object.fromEntries(
    tokens.space.steps.map((step) => [step, step * tokens.space.unit]),
  );
  const { overlay } = tokens.shadow;
  const overlayColor = tokens.color[overlay.color]?.value;

  return [
    '// Generated from packages/tokens/tokens.json by scripts/build-native.ts. Do not edit.',
    '',
    `export const colors = ${json(colors)} as const;`,
    '',
    'export type ColorName = keyof typeof colors;',
    '',
    `export const colorTokens = ${json(colorTokens)} as const;`,
    '',
    `export const fontFamily = ${json({ sans: tokens.font.sans.family })} as const;`,
    '',
    `export const fontWeight = ${json(fontWeight)} as const;`,
    '',
    `export const typeScale = ${json(tokens.typeScale)} as const;`,
    '',
    'export type TypeStep = keyof typeof typeScale;',
    '',
    '// Mutable on purpose: React Native style types reject readonly arrays.',
    `const tabularNums: [${JSON.stringify(tokens.font.numeric)}] = [${JSON.stringify(tokens.font.numeric)}];`,
    '',
    '/** Every figure is tabular. Spread into any Text style that shows numbers. */',
    'export const numeric = { fontVariant: tabularNums } as const;',
    '',
    '/** Large money figures at each step of the type scale. */',
    'export const amount = {',
    ...amount,
    '} as const;',
    '',
    `export const radius = ${json(radius)} as const;`,
    '',
    `export const space = ${json(space)} as const;`,
    '',
    `export const layout = ${json(tokens.layout)} as const;`,
    '',
    '/** Overlays only. */',
    `export const shadow = ${json({
      overlay: {
        shadowColor: overlayColor,
        shadowOpacity: overlay.opacity,
        shadowRadius: overlay.blur / 2,
        shadowOffset: { width: 0, height: overlay.offsetY },
        elevation: Math.round(overlay.offsetY),
      },
    })} as const;`,
    '',
  ].join('\n');
}

export function buildNative(tokens = loadTokens()): boolean {
  return writeGenerated(join(GENERATED_DIR, 'tokens.ts'), renderNativeTokens(tokens));
}

if (import.meta.main) {
  console.log(buildNative() ? 'tokens: wrote tokens.ts' : 'tokens: tokens.ts up to date');
}
