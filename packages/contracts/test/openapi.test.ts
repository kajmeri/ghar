import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateOpenApi, type GeneratedOpenApi } from '../scripts/openapi'

const OUTPUT_FILE = join(import.meta.dirname, '..', 'openapi.json')

interface Operation {
  operationId: string
  security?: unknown[]
  parameters?: { name: string; in: string; required: boolean }[]
  requestBody?: { required: boolean }
  responses: Record<string, unknown>
}

let generated: GeneratedOpenApi
let operations: (Operation & { method: string; path: string })[]

beforeAll(async () => {
  generated = await generateOpenApi()
  const document = JSON.parse(generated.json) as { paths: Record<string, Record<string, Operation>> }
  operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ ...operation, method, path }))
  )
})

describe('openapi.json', () => {
  it('matches the contracts', () => {
    const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf8') : ''
    expect(current === generated.json, 'packages/contracts/openapi.json is out of date. Run `pnpm openapi` and commit the result.').toBe(
      true
    )
  })

  it('has one operation per endpoint, each with its own id', () => {
    const ids = operations.map(operation => operation.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(generated.operationCount)
  })

  it('needs no session for public endpoints and a session for the rest', () => {
    const health = operations.find(operation => operation.operationId === 'getHealth')
    expect(health?.security).toEqual([])
    expect(health?.responses).not.toHaveProperty('401')

    const event = operations.find(operation => operation.operationId === 'getEvent')
    expect(event?.security).toBeUndefined()
    expect(event?.responses).toHaveProperty('401')
  })

  it('takes path parameters from the params schema and the status from the route', () => {
    const event = operations.find(operation => operation.operationId === 'getEvent')
    expect(event?.path).toBe('/api/v1/calendar/events/{eventId}')
    expect(event?.parameters).toContainEqual(expect.objectContaining({ name: 'eventId', in: 'path', required: true }))

    const created = operations.find(operation => operation.operationId === 'createEvent')
    expect(Object.keys(created?.responses ?? {})[0]).toBe('201')
    expect(created?.requestBody?.required).toBe(true)
  })
})
