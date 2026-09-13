import { z } from 'zod';

export const householdRoleSchema = z.enum(['owner', 'member']);
export type HouseholdRole = z.infer<typeof householdRoleSchema>;

/**
 * Who is acting, and in which household. Every data access function takes one.
 *
 * Built on the server from the session. A `householdId` from a request body or query
 * param is never trusted, so this schema never appears in a request contract.
 */
export const requestContextSchema = z.object({
  userId: z.uuid(),
  householdId: z.uuid(),
  role: householdRoleSchema,
});
export type RequestContext = Readonly<z.infer<typeof requestContextSchema>>;
