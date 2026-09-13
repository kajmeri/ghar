import 'server-only';
import type { EndpointDefinition, EndpointParsedInput, EndpointResponse } from '@casa/contracts';
import { ValidationError } from '@casa/core/errors';
import type { z } from 'zod';
import { errorResponse } from './errors';

interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

type Handler<T extends EndpointDefinition> = (
  input: EndpointParsedInput<T>,
  request: Request,
) => EndpointResponse<T> | Promise<EndpointResponse<T>>;

/**
 * Binds a route handler to its contract. Params, query and body are validated before the
 * handler runs, the response is validated after, and anything thrown goes through
 * errorResponse. Handlers only parse, authorize, call into core or db, and return.
 */
export function route<T extends EndpointDefinition>(
  endpoint: T,
  // T comes from the contract alone, so the handler's return value is checked against it
  // (and literals like status: 'ok' keep their literal type) instead of widening T.
  handler: NoInfer<Handler<T>>,
  { status = 200 }: { status?: number } = {},
) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const input = {
        params: endpoint.params && parseInput('params', endpoint.params, await context.params),
        query:
          endpoint.query &&
          parseInput(
            'query',
            endpoint.query,
            searchParamsToObject(new URL(request.url).searchParams),
          ),
        body: endpoint.body && parseInput('body', endpoint.body, await readJson(request)),
      } as EndpointParsedInput<T>;

      const output = endpoint.response.safeParse(await handler(input, request));
      if (!output.success) {
        throw new Error(
          `${endpoint.method} ${endpoint.path} returned a response outside its contract`,
          {
            cause: output.error,
          },
        );
      }
      return Response.json(output.data, { status, headers: { 'x-request-id': requestId } });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

function parseInput<S extends z.ZodType>(part: string, schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`The request ${part} is invalid`, {
      details: result.error.issues.map(({ path, message }) => ({
        path: [part, ...path.map(String)],
        message,
      })),
    });
  }
  return result.data;
}

/** Repeated keys become arrays. Values stay strings, so query schemas coerce. */
function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  return result;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('The request body is not valid JSON');
  }
}
