import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiClientError, createClient, defineEndpoint, getHealth, type FetchLike, type FetchResponseLike } from '../src'

function respond(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  }
}

function setup(response: FetchResponseLike | Error, token: string | null = 'token-123') {
  const fetch = vi.fn<FetchLike>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))
  const client = createClient({ baseUrl: 'https://ghar.test/', getToken: () => token, fetch })
  return { client, fetch }
}

async function rejection(promise: Promise<unknown>): Promise<ApiClientError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ApiClientError)
  return error as ApiClientError
}

const getThing = defineEndpoint({
  method: 'GET',
  path: '/api/v1/things/:thingId',
  params: z.object({ thingId: z.string() }),
  query: z.object({
    include: z.array(z.string()).optional(),
    limit: z.coerce.number().optional(),
  }),
  response: z.object({ id: z.string() }),
})

const createThing = defineEndpoint({
  method: 'POST',
  path: '/api/v1/things',
  body: z.object({ name: z.string(), amountCents: z.int() }),
  response: z.object({ id: z.string() }),
})

describe('createClient', () => {
  it('calls the health contract and returns the parsed body', async () => {
    const { client, fetch } = setup(respond(200, { status: 'ok', time: '2026-09-13T18:05:00Z' }))

    await expect(client.request(getHealth)).resolves.toEqual({
      status: 'ok',
      time: '2026-09-13T18:05:00Z',
    })
    expect(fetch).toHaveBeenCalledWith('https://ghar.test/api/v1/health', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer token-123' },
    })
  })

  it('sends no authorization header when signed out', async () => {
    const { client, fetch } = setup(respond(200, { status: 'ok', time: '2026-09-13T18:05:00Z' }), null)
    await client.request(getHealth)
    expect(fetch.mock.calls[0]?.[1].headers).toEqual({ accept: 'application/json' })
  })

  it('fills path params and serializes the query', async () => {
    const { client, fetch } = setup(respond(200, { id: 'a/b' }))

    await client.request(getThing, {
      params: { thingId: 'a/b' },
      query: { include: ['x', 'y z'], limit: 10 },
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://ghar.test/api/v1/things/a%2Fb?include=x&include=y%20z&limit=10')
  })

  it('sends a JSON body', async () => {
    const { client, fetch } = setup(respond(201, { id: 't1' }))

    await client.request(createThing, { body: { name: 'Boiler service', amountCents: 18_500 } })
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer token-123',
        'content-type': 'application/json',
      },
      body: '{"name":"Boiler service","amountCents":18500}',
    })
  })

  it('surfaces the ApiError shape from the server', async () => {
    const { client } = setup(
      respond(404, { error: { code: 'not_found', message: 'That thing does not exist', requestId: 'req-1' } }, { 'x-request-id': 'req-1' })
    )

    const error = await rejection(client.request(getThing, { params: { thingId: 'nope' } }))
    expect(error).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'That thing does not exist',
      requestId: 'req-1',
    })
  })

  it('reports an error response that is not an ApiError', async () => {
    const { client } = setup(respond(502, '<html>Bad gateway</html>'))
    const error = await rejection(client.request(getHealth))
    expect(error).toMatchObject({ status: 502, code: 'invalid_response' })
  })

  it('rejects a success response that breaks the contract', async () => {
    const { client } = setup(respond(200, { status: 'degraded' }, { 'x-request-id': 'req-2' }))
    const error = await rejection(client.request(getHealth))
    expect(error).toMatchObject({ status: 200, code: 'invalid_response', requestId: 'req-2' })
    expect(error.details).toBeInstanceOf(Array)
  })

  it('reports network failures', async () => {
    const cause = new TypeError('fetch failed')
    const { client } = setup(cause)
    const error = await rejection(client.request(getHealth))
    expect(error).toMatchObject({ status: 0, code: 'network_error' })
    expect(error.cause).toBe(cause)
  })

  it('types input from the contract', () => {
    const { client } = setup(respond(200, { id: 't1' }))
    const check = () => {
      // @ts-expect-error params are required by getThing
      void client.request(getThing)
      // @ts-expect-error body must match createThing
      void client.request(createThing, { body: { name: 1 } })
      // @ts-expect-error getHealth takes no body
      void client.request(getHealth, { body: {} })
    }
    expect(check).toBeTypeOf('function')
  })
})
