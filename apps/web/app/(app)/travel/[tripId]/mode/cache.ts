'use client';

import { travelModeSchema, type TravelMode } from '@ghar/contracts';

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
 */
const KEY = (tripId: string) => `ghar:travel-mode:${tripId}`;

export function cacheTravelMode(mode: TravelMode): void {
  try {
    localStorage.setItem(KEY(mode.trip.id), JSON.stringify(mode));
  } catch {
    // A full or disabled store is not worth telling anyone about; the page still works.
  }
}

export function cachedTravelMode(tripId: string): TravelMode | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY(tripId));
  } catch {
    return null;
  }
  if (raw === null) return null;

  const parsed = travelModeSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    try {
      localStorage.removeItem(KEY(tripId));
    } catch {
      // Nothing to do; the parse failure already means we will not use it.
    }
    return null;
  }
  return parsed.data;
}
