'use client'

import { deleteDocument } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'

export function DeleteDocument({ documentId, title }: { documentId: string; title: string }) {
  return (
    <DeleteButton
      label='Delete document'
      title={`Delete ${title}?`}
      description='The file goes with it. This can’t be undone.'
      redirectTo='/documents'
      onDelete={() => api.request(deleteDocument, { params: { documentId } })}
    />
  )
}
