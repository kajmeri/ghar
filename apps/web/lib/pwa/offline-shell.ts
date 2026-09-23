import { colors, fontFamily, fontWeight, layout, radius, typeScale } from '@ghar/tokens'

const px = (value: number) => `${value}px`

/**
 * The page the service worker shows when a navigation fails and nothing is saved for that URL.
 *
 * A whole document with inline styles and no scripts. It is precached once and then served at any URL,
 * so it can't depend on hashed build assets, can't hydrate as another route, and never carries household
 * or session data. Public Sans may not be cached, so it falls back to the system face.
 */
export function renderOfflineShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${colors.paper}">
<meta name="robots" content="noindex, nofollow">
<title>Offline · Ghar</title>
<style>
  :root { color-scheme: light; }
  *, ::before, ::after { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(${px(24)}, env(safe-area-inset-top)) max(${px(16)}, env(safe-area-inset-right)) max(${px(24)}, env(safe-area-inset-bottom)) max(${px(16)}, env(safe-area-inset-left));
    background: ${colors.paper};
    color: ${colors.ink};
    font-family: '${fontFamily.sans}', ui-sans-serif, system-ui, sans-serif;
    font-size: ${px(typeScale.base.fontSize)};
    line-height: ${px(typeScale.base.lineHeight)};
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: 100%;
  }
  main { width: 100%; max-width: 28rem; }
  h1 {
    margin: 0 0 ${px(8)};
    font-size: ${px(typeScale['2xl'].fontSize)};
    line-height: ${px(typeScale['2xl'].lineHeight)};
    font-weight: ${fontWeight.semibold};
  }
  p { margin: 0; color: ${colors.inkMuted}; }
  .actions { display: flex; flex-wrap: wrap; gap: ${px(12)}; margin-top: ${px(24)}; }
  a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: ${px(layout.tapTarget)};
    padding: 0 ${px(16)};
    border-radius: ${px(radius.control)};
    font-weight: ${fontWeight.medium};
    text-decoration: none;
  }
  a:focus-visible { outline: 2px solid ${colors.ink}; outline-offset: 2px; }
  .primary { background: ${colors.ink}; color: ${colors.surface}; }
  .secondary { border: 1px solid ${colors.lineStrong}; background: ${colors.surface}; color: ${colors.ink}; }
</style>
</head>
<body>
<main>
  <h1>You’re offline</h1>
  <p>This page isn’t saved on this device. Pages you opened recently still work. Reconnect to see the rest.</p>
  <div class="actions">
    <a class="primary" href="">Try again</a>
    <a class="secondary" href="/">Go to home</a>
  </div>
</main>
</body>
</html>
`
}
