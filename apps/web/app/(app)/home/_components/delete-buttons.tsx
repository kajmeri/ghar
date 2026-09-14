'use client'

import { deleteAsset, deleteMaintenanceTask } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'

export function DeleteAsset({ assetId, name }: { assetId: string; name: string }) {
  return (
    <DeleteButton
      label='Delete this thing'
      title={`Delete ${name}?`}
      description='Its jobs and their history go with it. Its documents stay, just not linked to anything.'
      redirectTo='/home'
      onDelete={() => api.request(deleteAsset, { params: { assetId } })}
    />
  )
}

export function DeleteTask({ taskId, title, redirectTo }: { taskId: string; title: string; redirectTo: string }) {
  return (
    <DeleteButton
      label='Delete job'
      title={`Delete ${title}?`}
      description='Its history goes with it. This can’t be undone.'
      redirectTo={redirectTo}
      onDelete={() => api.request(deleteMaintenanceTask, { params: { taskId } })}
    />
  )
}
