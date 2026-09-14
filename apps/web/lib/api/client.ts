'use client'

import { ApiClientError, createClient, type EndpointDefinition, type EndpointInput } from '@ghar/contracts'

/**
 * The browser's client for app/api/v1, built on the same typed client apps/mobile uses.
 *
 * Same-origin, so there is no base URL and no bearer token: fetch sends the session cookie
 * on its own. The mobile app passes its token through `getToken` instead, which is the
 * only difference between the two.
 */
export const api = createClient({ baseUrl: '', getToken: () => null })

/**
 * The body an endpoint takes, for a form that assembles one before sending it. It carries
 * `| undefined` for an endpoint whose body is entirely optional, and for one with no body.
 */
export type BodyOf<T extends EndpointDefinition> = EndpointInput<T>['body']

/** The message to put in front of a person when a request fails. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.code === 'network_error' ? 'No connection. Your change was not saved.' : error.message
  }
  return 'Something went wrong. Your change was not saved.'
}
