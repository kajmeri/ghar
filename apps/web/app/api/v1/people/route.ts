import { createPerson, listPeople } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as people from '@/lib/people/service'

export const GET = authedRoute(listPeople, async (_input, session) => ({ people: await people.listPeople(session.context) }))

export const POST = authedRoute(createPerson, async ({ body }, session) => ({ person: await people.createPerson(session, body) }), {
  status: 201,
})
