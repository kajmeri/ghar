import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and have no build step.
  transpilePackages: ['@casa/contracts', '@casa/core', '@casa/db', '@casa/tokens'],
};

export default nextConfig;
