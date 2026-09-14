import 'server-only';
import type { EndpointDefinition, EndpointParsedInput, EndpointResponse } from '@ghar/contracts';
import { getHousehold } from '@ghar/db/queries';
import { getPageContext, getRequestContext, type RequestContext } from '@/lib/auth/context';
import { getDb } from '@/lib/db';
import { route } from './handler';

/**
 * The request context, with the household facts the travel answers lean on. The household's
 * time zone decides what "today" is, so it rides along instead of each handler looking it up.
 */
export interface Session {
  readonly context: RequestContext;
  readonly household: { readonly id: string; readonly name: string; readonly timeZone: string };
}

async function sessionFor(context: RequestContext): Promise<Session> {
  const household = await getHousehold(context, getDb());
  return {
    context,
    household: { id: household.id, name: household.name, timeZone: household.timezone },
  };
}

/** For route handlers. Throws UnauthorizedError when signed out, NotFoundError before onboarding. */
export async function requireSession(): Promise<Session> {
  return sessionFor(await getRequestContext());
}

/** For pages. Redirects to sign-in or onboarding instead of throwing. */
export async function getPageSession(): Promise<Session> {
  const { ctx } = await getPageContext();
  return sessionFor(ctx);
}

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
