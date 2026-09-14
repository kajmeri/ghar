import 'server-only';
import type { EndpointDefinition, EndpointParsedInput, EndpointResponse } from '@casa/contracts';
import { requireSession, type Session } from '../auth';
import { route } from './handler';

/**
 * `route`, with the session resolved first. Every endpoint under /api/v1 except health
 * uses this, so no handler has to remember to authorize, and none of them can see a
 * household id that did not come from the session.
 */
export function authedRoute<T extends EndpointDefinition>(
  endpoint: T,
  handler: NoInfer<
    (
      input: EndpointParsedInput<T>,
      session: Session,
      request: Request,
    ) => EndpointResponse<T> | Promise<EndpointResponse<T>>
  >,
  options?: { status?: number },
) {
  return route(
    endpoint,
    async (input, request) => handler(input, await requireSession(), request),
    options,
  );
}
