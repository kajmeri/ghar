/**
 * Names this deployment for the service worker. The worker is registered as /sw.js?v=<version> and keys
 * its caches by it, so a new deploy installs a new worker and throws away the old caches.
 *
 * Vercel sets both variables at build time and at runtime, so a prerendered page and a dynamic one agree.
 * Anywhere else it is "local": edit public/sw.js, or clear site data, to see a new worker there.
 */
export function serviceWorkerVersion(env: Record<string, string | undefined> = process.env): string {
  const raw = env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_GIT_COMMIT_SHA ?? ''
  return raw.replace(/[^\w-]/g, '').slice(0, 64) || 'local'
}
