'use client'

import { deleteBill } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'

export function DeleteBill({ billId, name }: { billId: string; name: string }) {
  return (
    <DeleteButton
      label='Delete bill'
      title={`Delete ${name}?`}
      description='It stops showing as due. The payments stay in your transactions.'
      redirectTo='/bills'
      onDelete={() => api.request(deleteBill, { params: { billId } })}
    />
  )
}
