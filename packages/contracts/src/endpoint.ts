import type { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * One API route, described once and shared by the route handler in apps/web and every
 * client. Path segments written as `:name` are filled from `params`. Query values arrive
 * as strings, so query schemas should coerce.
 */
export interface EndpointDefinition {
  method: HttpMethod
  path: `/api/v1/${string}`
  params?: z.ZodType<unknown, Record<string, string>>
  query?: z.ZodType
  body?: z.ZodType
  response: z.ZodType
  /**
   * Who may call this endpoint. Without it, every endpoint requires a session: the web
   * app's session cookie or a bearer access token. `'public'` means no session is needed
   * (a health check, signing in, or a request authorized by something in the request
   * itself, such as a signed one-tap token).
   */
  access?: 'public'
}

export function defineEndpoint<const T extends EndpointDefinition>(endpoint: T): T {
  return endpoint
}

type InputKey = 'params' | 'query' | 'body'

/** True when X is an object whose keys are all optional, so an empty object satisfies it. */
type AllOptional<X> = [X] extends [object] ? (Partial<X> extends X ? true : false) : false

/**
 * A client may leave out a part whose schema accepts an empty object (a query of optional
 * filters, say) or no value at all (a body with `.prefault({})`, which the server reads from an
 * empty request). The handler always receives the parsed part.
 */
type Part<T, K extends InputKey, Side extends 'input' | 'output'> =
  T extends Record<K, infer Schema extends z.ZodType>
    ? Side extends 'output'
      ? { [P in K]: z.output<Schema> }
      : undefined extends z.input<Schema>
        ? { [P in K]?: z.input<Schema> }
        : AllOptional<z.input<Schema>> extends true
          ? { [P in K]?: z.input<Schema> }
          : { [P in K]: z.input<Schema> }
    : { [P in K]?: undefined }

/** What a client sends. */
export type EndpointInput<T extends EndpointDefinition> = Part<T, 'params', 'input'> & Part<T, 'query', 'input'> & Part<T, 'body', 'input'>

/** What a route handler receives once the request has been validated. */
export type EndpointParsedInput<T extends EndpointDefinition> = Part<T, 'params', 'output'> &
  Part<T, 'query', 'output'> &
  Part<T, 'body', 'output'>

export type EndpointResponse<T extends EndpointDefinition> = z.output<T['response']>

/** Input is required exactly when some declared part cannot be left out. */
export type EndpointArgs<T extends EndpointDefinition> =
  AllOptional<EndpointInput<T>> extends true ? [input?: EndpointInput<T>] : [input: EndpointInput<T>]
