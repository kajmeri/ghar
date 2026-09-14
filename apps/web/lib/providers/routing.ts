import 'server-only'
import { estimateLegs, TRAVEL_MODE_PROFILES, type LegEstimates, type TravelLeg } from '@ghar/core/travel'
import { z } from 'zod'
import { env } from '@/lib/env'

/**
 * How long it takes to get from one stop to the next.
 *
 * The default asks nobody. Straight-line distance, stretched by a detour factor and divided by a
 * speed for the likely way of getting there (see `estimateTravel` in @ghar/core/travel), is enough
 * to tell a ten-minute walk from forty minutes across town, which is the question an itinerary
 * asks.
 *
 * An OSRM server can route the walking and driving legs properly. It is off by default: it sends
 * the trip's coordinates to whoever runs the server, and a timeline has to render when that server
 * is down. A leg it cannot price keeps its estimate, so a slow router makes the numbers rougher,
 * never missing.
 */
export interface RoutingProvider {
  /** Estimates keyed by `legKey`. Every leg passed in comes back with one. */
  estimate(legs: readonly TravelLeg[]): Promise<LegEstimates>
}

export function createEstimateRoutingProvider(): RoutingProvider {
  return {
    estimate: legs => Promise.resolve(estimateLegs(legs)),
  }
}

/** For tests: fixed routes for the legs named, and the plain estimate for the rest. */
export function createFakeRoutingProvider(routes: ReadonlyMap<string, { meters: number; minutes: number }> = new Map()): RoutingProvider {
  return {
    estimate(legs) {
      const estimates = estimateLegs(legs)
      for (const leg of legs) {
        const route = routes.get(leg.key)
        const base = estimates.get(leg.key)
        if (route && base) estimates.set(leg.key, { ...base, ...route, source: 'routed' })
      }
      return Promise.resolve(estimates)
    },
  }
}

const OSRM_TIMEOUT_MS = 3000
/** A busy week has a few dozen legs. Past this, the rest keep their estimates. */
const OSRM_MAX_LEGS = 60

const osrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative() })).optional(),
})

export function createOsrmRoutingProvider({ baseUrl, fetch: fetchImpl = fetch }: { baseUrl: string; fetch?: typeof fetch }): RoutingProvider {
  return {
    async estimate(legs) {
      const estimates = estimateLegs(legs)
      // OSRM has no timetables, so a leg that looks like a transit ride stays an estimate.
      const routable = legs.filter(leg => estimates.get(leg.key)?.mode !== 'transit').slice(0, OSRM_MAX_LEGS)

      await Promise.all(
        routable.map(async leg => {
          const base = estimates.get(leg.key)
          if (!base) return
          const route = await osrmRoute(fetchImpl, baseUrl, leg, base.mode === 'walk' ? 'foot' : 'driving')
          if (!route) return
          estimates.set(leg.key, {
            meters: Math.round(route.distance),
            // The router knows the roads, not the parking, so the mode's overhead still applies.
            minutes: Math.ceil(route.duration / 60) + TRAVEL_MODE_PROFILES[base.mode].overheadMinutes,
            mode: base.mode,
            source: 'routed',
          })
        })
      )
      return estimates
    },
  }
}

async function osrmRoute(
  fetchImpl: typeof fetch,
  baseUrl: string,
  leg: TravelLeg,
  profile: 'foot' | 'driving'
): Promise<{ distance: number; duration: number } | null> {
  const coordinates = `${leg.from.lng},${leg.from.lat};${leg.to.lng},${leg.to.lat}`
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, OSRM_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${baseUrl}/route/v1/${profile}/${coordinates}?overview=false`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const parsed = osrmResponseSchema.safeParse((await response.json()) as unknown)
    if (!parsed.success || parsed.data.code !== 'Ok') return null
    return parsed.data.routes?.[0] ?? null
  } catch {
    // Quiet on purpose: the estimate is already in place.
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export function getRoutingProvider(): RoutingProvider {
  const { ROUTING_PROVIDER, OSRM_URL } = env()
  if (ROUTING_PROVIDER === 'estimate') return createEstimateRoutingProvider()
  if (!OSRM_URL) {
    throw new Error('ROUTING_PROVIDER is osrm, but OSRM_URL is not set.')
  }
  return createOsrmRoutingProvider({ baseUrl: OSRM_URL })
}
