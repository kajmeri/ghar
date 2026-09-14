import { deleteContact, getContact, updateContact } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'

export const GET = authedRoute(getContact, ({ params }, session) => contacts.getContactDetail(session, params.contactId))

export const PUT = authedRoute(updateContact, async ({ params, body }, session) => ({
  contact: await contacts.updateContact(session, params.contactId, body),
}))

export const DELETE = authedRoute(deleteContact, ({ params }, session) => contacts.deleteContact(session, params.contactId))
