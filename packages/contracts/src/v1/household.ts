import { z } from 'zod';
import { householdRoleSchema } from '../context';
import { defineEndpoint } from '../endpoint';

/**
 * A person in the household.
 *
 * `displayName` is the household's own name for them, and the only name the app has:
 * Supabase owns the account, and nothing here reads it. Null means nobody has filled one
 * in yet, and clients fall back through `memberLabel` in @casa/core rather than showing a
 * raw user id.
 */
export const householdMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: householdRoleSchema,
});
export type HouseholdMember = z.infer<typeof householdMemberSchema>;

export const householdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** IANA zone. Every date without a time is rendered in it. */
  timeZone: z.string(),
  members: z.array(householdMemberSchema),
});
export type Household = z.infer<typeof householdSchema>;

export const getHousehold = defineEndpoint({
  method: 'GET',
  path: '/api/v1/household',
  response: z.object({ household: householdSchema, currentUserId: z.uuid() }),
});

/**
 * Naming someone. Anyone may rename themselves; renaming somebody else is an owner's call.
 * An empty name clears it back to the fallback rather than storing a blank.
 */
export const updateHouseholdMember = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/household/members/:userId',
  params: z.object({ userId: z.uuid() }),
  body: z.object({ displayName: z.string().max(100).nullable() }),
  response: z.object({ member: householdMemberSchema }),
});
