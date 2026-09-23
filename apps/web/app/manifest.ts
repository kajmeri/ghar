import { colors } from '@ghar/tokens'
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Ghar',
    short_name: 'Ghar',
    description: 'Money, calendar, travel, documents and home upkeep for your household, in one place.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: colors.paper,
    theme_color: colors.paper,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full bleed and opaque, with the mark inside the central 80% that every mask shape keeps.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
