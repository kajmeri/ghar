'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { purgeOfflineData } from '@/lib/pwa/purge'
import { OfflineBanner } from './offline-banner'

/**
 * Installs public/sw.js in production and clears what it saved when a session ends. Mounted once, in the
 * root layout. `version` names the deployment, so each deploy registers a new worker.
 */
export function ServiceWorker({ version }: { version: string }) {
  const pathname = usePathname()

  useEffect(() => {
    if (!('serviceWorker' in navigator) || /^\/styleguide(?:\/|$)/.test(window.location.pathname)) return

    if (process.env.NODE_ENV !== 'production') {
      // A worker left behind by a production build on this origin would serve stale pages in development.
      navigator.serviceWorker
        .getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(() => undefined)
      return
    }

    // After load, so registering never competes with the first paint.
    const register = () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: '/', updateViaCache: 'none' }).catch(() => undefined)
    }
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [version])

  useEffect(() => {
    // Sign-out forms carry data-sign-out. Clear saved pages as the form submits, before the server answers.
    const onSubmit = (event: SubmitEvent) => {
      if (event.target instanceof HTMLFormElement && event.target.hasAttribute('data-sign-out')) void purgeOfflineData()
    }
    window.addEventListener('submit', onSubmit, true)
    return () => window.removeEventListener('submit', onSubmit, true)
  }, [])

  useEffect(() => {
    // Landing on /login means there is no session here any more, however it ended. This also covers a
    // sign-out submitted before the page hydrated, because /login loads as a fresh page.
    if (pathname === '/login') void purgeOfflineData()
  }, [pathname])

  return <OfflineBanner />
}
