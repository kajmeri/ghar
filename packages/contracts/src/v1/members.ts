import { z } from 'zod'
import { householdRoleSchema } from '../context'
import { defineEndpoint } from '../endpoint'

export const memberSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  role: householdRoleSchema,
  joinedAt: z.iso.datetime(),
})
export type Member = z.infer<typeof memberSchema>

export const memberParamsSchema = z.object({ userId: z.uuid() })

export const listMembers = defineEndpoint({
  method: 'GET',
  path: '/api/v1/households/me/members',
  response: z.object({ members: z.array(memberSchema) }),
})

/** Owners only. Nobody changes their own role, and a household keeps at least one owner. */
export const updateMemberRole = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/households/me/members/:userId',
  params: memberParamsSchema,
  body: z.object({ role: householdRoleSchema }),
  response: z.object({ member: memberSchema }),
})

/** Owners only. Nobody removes themselves, and a household keeps at least one owner. */
export const removeMember = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/households/me/members/:userId',
  params: memberParamsSchema,
  response: z.object({ userId: z.uuid() }),
})
