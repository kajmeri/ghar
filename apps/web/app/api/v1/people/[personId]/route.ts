import { deletePerson, updatePerson } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as people from '@/lib/people/service'

export const PATCH = authedRoute(updatePerson, async ({ params, body }, session) => ({
  person: await people.updatePerson(session, params.personId, body),
}))

export const DELETE = authedRoute(deletePerson, ({ params }, session) => people.deletePerson(session.context, params.personId))
