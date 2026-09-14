'use client'

import { deleteContact } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'

export function DeleteContact({ contactId, name }: { contactId: string; name: string }) {
  return (
    <DeleteButton
      label='Delete contact'
      title={`Delete ${name}?`}
      description='Jobs that name them keep going, just without someone to call.'
      redirectTo='/contacts'
      onDelete={() => api.request(deleteContact, { params: { contactId } })}
    />
  )
}
