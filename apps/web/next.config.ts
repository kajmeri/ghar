import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and have no build step.
  transpilePackages: ['@ghar/contracts', '@ghar/core', '@ghar/db', '@ghar/tokens'],
  experimental: {
    // radix-ui re-exports every primitive from one entry; this imports only the ones used.
    optimizePackageImports: ['radix-ui'],
    // The stylesheet is about 9 KB compressed. Inlining it into the HTML saves the round trip that
    // otherwise blocks first paint, which on a phone on 4G is most of the time to LCP.
    inlineCss: true,
  },
  async headers() {
    return [
      {
        // The browser checks for a new service worker on every navigation. It must never get a stale copy.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig
