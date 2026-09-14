import { createContact, listContacts } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'

export const GET = authedRoute(listContacts, async ({ query }, session) => ({
  contacts: await contacts.listContacts(session, query),
}))

export const POST = authedRoute(
  createContact,
  async ({ body }, session) => ({ contact: await contacts.createContact(session, body) }),
  { status: 201 }
)
