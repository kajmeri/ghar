'use client'

import { deleteRenewal } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'

export function DeleteRenewal({ renewalId, title }: { renewalId: string; title: string }) {
  return (
    <DeleteButton
      label='Delete renewal'
      title={`Delete ${title}?`}
      description='Its reminders stop. Anything it was linked to stays.'
      redirectTo='/renewals'
      onDelete={() => api.request(deleteRenewal, { params: { renewalId } })}
    />
  )
}
