import { estimateLegs, legKey, type TravelLeg } from '@ghar/core/travel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEstimateRoutingProvider, createFakeRoutingProvider, createOsrmRoutingProvider } from '@/lib/providers/routing'

const HOTEL = { lat: 45.5046, lng: -73.5549 }
const CAFE = { lat: 45.5047, lng: -73.5552 } // next door
const MARKET = { lat: 45.5009, lng: -73.5605 } // a short walk
const PLATEAU = { lat: 45.5226, lng: -73.5857 } // far enough to ride

function leg(fromOptionId: string, toOptionId: string, from: TravelLeg['from'], to: TravelLeg['to']): TravelLeg {
  return { key: legKey(fromOptionId, toOptionId), fromOptionId, toOptionId, from, to }
}

const WALK = leg('hotel', 'market', HOTEL, MARKET)
const RIDE = leg('market', 'plateau', MARKET, PLATEAU)
const baseUrl = 'https://osrm.example.com'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.useRealTimers()
})

describe('createEstimateRoutingProvider', () => {
  it('prices every leg from distance alone', async () => {
    const estimates = await createEstimateRoutingProvider().estimate([WALK, RIDE])
    expect(estimates).toEqual(estimateLegs([WALK, RIDE]))
    expect(estimates.get(WALK.key)).toMatchObject({ mode: 'walk', source: 'estimate' })
    expect(estimates.get(RIDE.key)).toMatchObject({ mode: 'transit', source: 'estimate' })
  })

  it('calls next door no time at all', async () => {
    const next = leg('hotel', 'cafe', HOTEL, CAFE)
    expect((await createEstimateRoutingProvider().estimate([next])).get(next.key)?.minutes).toBe(0)
  })
})

describe('createFakeRoutingProvider', () => {
  it('uses the routes it was given and estimates the rest', async () => {
    const provider = createFakeRoutingProvider(new Map([[WALK.key, { meters: 900, minutes: 12 }]]))
    const estimates = await provider.estimate([WALK, RIDE])
    expect(estimates.get(WALK.key)).toEqual({ meters: 900, minutes: 12, mode: 'walk', source: 'routed' })
    expect(estimates.get(RIDE.key)).toEqual(estimateLegs([RIDE]).get(RIDE.key))
  })
})

describe('createOsrmRoutingProvider', () => {
  it('routes a walking leg on foot, and leaves transit to the estimate', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json({ code: 'Ok', routes: [{ distance: 1234.4, duration: 610 }] })))
    const estimates = await createOsrmRoutingProvider({ baseUrl, fetch }).estimate([WALK, RIDE])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/route/v1/foot/${HOTEL.lng},${HOTEL.lat};${MARKET.lng},${MARKET.lat}?overview=false`, expect.anything())
    // Rounded to the metre, rounded up to the minute, plus walking's overhead of nothing.
    expect(estimates.get(WALK.key)).toEqual({ meters: 1234, minutes: 11, mode: 'walk', source: 'routed' })
    expect(estimates.get(RIDE.key)).toEqual(estimateLegs([RIDE]).get(RIDE.key))
  })

  it('keeps the estimate when the server says no', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json({ message: 'Too many requests' }, 429)))
    expect((await createOsrmRoutingProvider({ baseUrl, fetch }).estimate([WALK])).get(WALK.key)).toEqual(estimateLegs([WALK]).get(WALK.key))
  })

  it.each([
    ['a route it could not find', { code: 'NoRoute' }],
    ['a body in the wrong shape', { code: 'Ok', routes: [{ distance: 'far' }] }],
    ['no routes at all', { code: 'Ok', routes: [] }],
  ])('keeps the estimate for %s', async (_, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json(body)))
    expect((await createOsrmRoutingProvider({ baseUrl, fetch }).estimate([WALK])).get(WALK.key)).toMatchObject({ source: 'estimate' })
  })

  it('keeps the estimate when the body is not JSON or the network fails', async () => {
    const garbage = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('<html>', { status: 200 })))
    const offline = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new TypeError('fetch failed')))
    for (const fetch of [garbage, offline]) {
      expect((await createOsrmRoutingProvider({ baseUrl, fetch }).estimate([WALK])).get(WALK.key)).toMatchObject({ source: 'estimate' })
    }
  })

  it('gives up on a slow server after three seconds', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    )
    const pending = createOsrmRoutingProvider({ baseUrl, fetch }).estimate([WALK])
    await vi.advanceTimersByTimeAsync(3000)
    expect((await pending).get(WALK.key)).toMatchObject({ source: 'estimate' })
  })

  it('asks about sixty legs at most, and estimates the rest', async () => {
    const legs = Array.from({ length: 65 }, (_, index) => leg(`a${index}`, `b${index}`, HOTEL, MARKET))
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json({ code: 'Ok', routes: [{ distance: 1000, duration: 600 }] })))
    const estimates = await createOsrmRoutingProvider({ baseUrl, fetch }).estimate(legs)

    expect(fetch).toHaveBeenCalledTimes(60)
    expect(estimates.size).toBe(65)
    expect([...estimates.values()].filter(estimate => estimate.source === 'routed')).toHaveLength(60)
  })
})
