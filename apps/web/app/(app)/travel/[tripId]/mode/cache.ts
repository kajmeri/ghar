'use client'

import { travelModeSchema, type TravelMode } from '@ghar/contracts'
import { TRAVEL_MODE_PREFIX } from '@/lib/pwa/purge'

/**
 * Travel mode's offline copy.
 *
 * localStorage rather than a service worker: this is one payload for one trip, it has to
 * survive a plane, and a worker would be a lot of machinery plus a cache-invalidation
 * problem for something a few kilobytes long.
 *
 * Everything read back is parsed against the contract. A copy written by an older build
 * is thrown away rather than rendered, because a shape that half-matches is worse than no
 * cache at all.
 *
 * Signing out clears every copy, through purgeOfflineData, so the next person on the device
 * can't read the last one's trip.
 */
const KEY = (tripId: string) => `${TRAVEL_MODE_PREFIX}${tripId}`

export function cacheTravelMode(mode: TravelMode): void {
  try {
    localStorage.setItem(KEY(mode.trip.id), JSON.stringify(mode))
  } catch {
    // A full or disabled store is not worth telling anyone about; the page still works.
  }
}

export function cachedTravelMode(tripId: string): TravelMode | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY(tripId))
  } catch {
    return null
  }
  if (raw === null) return null

  let json: unknown = null
  try {
    json = JSON.parse(raw)
  } catch {
    // Unreadable is the same as a shape we don't recognize: thrown away below.
  }
  const parsed = travelModeSchema.safeParse(json)
  if (!parsed.success) {
    try {
      localStorage.removeItem(KEY(tripId))
    } catch {
      // Nothing to do; the parse failure already means we will not use it.
    }
    return null
  }
  return parsed.data
}
