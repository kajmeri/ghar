/** Every Cache Storage name public/sw.js creates starts with this. Keep the two in step. */
export const CACHE_PREFIX = 'ghar-'

/** Every localStorage key travel mode's saved copy uses starts with this. */
export const TRAVEL_MODE_PREFIX = 'ghar:travel-mode:'

/**
 * Deletes everything the service worker saved on this device, so the next person to use it can't open a
 * saved page. Tells the worker first, synchronously, so its purge still runs if this page is unloading,
 * then deletes the caches from here in case no worker controls the page. Never throws.
 */
export async function purgeOfflineData(): Promise<void> {
  // Travel mode keeps a copy of each trip in localStorage, bookings and health cards included.
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(TRAVEL_MODE_PREFIX)) localStorage.removeItem(key)
  } catch {
    // Storage can be blocked. Then nothing was saved there either.
  }
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.controller?.postMessage({ type: 'purge' })
    if (typeof caches === 'undefined') return
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX)).map(name => caches.delete(name)))
  } catch {
    // Cache Storage can be unavailable, for example in some private windows. There is nothing to delete.
  }
}
