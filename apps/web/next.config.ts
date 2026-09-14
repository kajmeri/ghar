import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and have no build step.
  transpilePackages: ['@ghar/contracts', '@ghar/core', '@ghar/db', '@ghar/tokens'],
}

export default nextConfig
