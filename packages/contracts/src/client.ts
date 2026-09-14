import type { EndpointArgs, EndpointDefinition, EndpointResponse } from './endpoint';
import { apiErrorResponseSchema, type ApiErrorCode } from './errors';

/** The slice of fetch the client needs. The global fetch in browsers, Node and React Native fits. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface ClientOptions {
  /** Origin of apps/web, such as "https://ghar.example.com". Endpoint paths start with /api/v1. */
  baseUrl: string;
  /** Returns the current access token, or null when signed out. Called before every request. */
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Defaults to the global fetch. */
  fetch?: FetchLike;
}

export type ApiClientErrorCode = ApiErrorCode | 'network_error' | 'invalid_response';

export class ApiClientError extends Error {
  override readonly name = 'ApiClientError';
  /** HTTP status, or 0 when the server was never reached. */
  readonly status: number;
  readonly code: ApiClientErrorCode;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    code: ApiClientErrorCode;
    message: string;
    details?: unknown;
    requestId?: string | undefined;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

export type GharClient = ReturnType<typeof createClient>;

interface WireInput {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Typed client for app/api/v1, shared by apps/web and apps/mobile.
 *
 *   const api = createClient({ baseUrl, getToken });
 *   const health = await api.request(getHealth);
 *
 * Responses are validated against the contract. Failures throw ApiClientError.
 */
export function createClient({ baseUrl, getToken, fetch: fetchOverride }: ClientOptions) {
  const origin = baseUrl.replace(/\/+$/, '');

  async function request<T extends EndpointDefinition>(
    endpoint: T,
    ...args: EndpointArgs<T>
  ): Promise<EndpointResponse<T>> {
    const [rawInput] = args;
    const input: WireInput = rawInput ?? {};
    const fetchImpl = fetchOverride ?? globalFetch();
    const label = `${endpoint.method} ${endpoint.path}`;

    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await getToken();
    if (token) headers.authorization = `Bearer ${token}`;

    const init: FetchInit = { method: endpoint.method, headers };
    if (input.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(input.body);
    }

    const url = origin + fillPath(endpoint.path, input.params) + toQueryString(input.query);

    let response: FetchResponseLike;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      throw new ApiClientError({
        status: 0,
        code: 'network_error',
        message: `Could not reach the server for ${label}`,
        cause,
      });
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const payload = await readJson(response);

    if (!response.ok) {
      const apiError = apiErrorResponseSchema.safeParse(payload);
      if (apiError.success) {
        throw new ApiClientError({ status: response.status, requestId, ...apiError.data.error });
      }
      throw new ApiClientError({
        status: response.status,
        code: 'invalid_response',
        message: `Unexpected ${response.status} response from ${label}`,
        requestId,
      });
    }

    const parsed = endpoint.response.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError({
        status: response.status,
        code: 'invalid_response',
        message: `Response from ${label} does not match its contract`,
        details: parsed.error.issues,
        requestId,
      });
    }
    return parsed.data as EndpointResponse<T>;
  }

  return { request };
}

function globalFetch(): FetchLike {
  const candidate: unknown = Reflect.get(globalThis, 'fetch');
  if (typeof candidate !== 'function') {
    throw new Error('No global fetch is available. Pass `fetch` to createClient.');
  }
  return candidate as FetchLike;
}

function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_segment, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

function toQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item === undefined || item === null) continue;
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        throw new Error(`Query param "${key}" must be a string, number or boolean`);
      }
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

async function readJson(response: FetchResponseLike): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
