// Runs both generators in one process. `pnpm dev` runs this under `node --watch-path`, so an
// edit to tokens.json regenerates the CSS (Next hot-reloads it) and tokens.ts (Metro reloads it).
import { buildCss } from './build-css.ts';
import { buildNative } from './build-native.ts';
import { loadTokens } from './tokens.ts';

try {
  const tokens = loadTokens();
  const written = [...buildCss(tokens), ...(buildNative(tokens) ? ['tokens.ts'] : [])];
  console.log(written.length > 0 ? `tokens: wrote ${written.join(', ')}` : 'tokens: up to date');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
