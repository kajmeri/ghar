'use client'

import { useActionState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { fieldError, IDLE } from '@/lib/actions/state'
import { changeRoleAction, removeMemberAction } from '../actions'

/** An owner's controls on someone else's member card: change their role, or remove them. */
export function MemberControls({
  userId,
  name,
  role,
  roles,
  canChangeRole,
  canRemove,
}: {
  userId: string
  name: string
  role: string
  roles: { value: string; label: string }[]
  canChangeRole: boolean
  canRemove: boolean
}) {
  const [state, formAction, pending] = useActionState(changeRoleAction, IDLE)
  const selectId = `role-${userId}`
  const roleError = fieldError(state, 'role')

  return (
    <div className='mt-4 flex flex-col gap-3 border-t border-line pt-4'>
      <div className='flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
        {canChangeRole ? (
          <form action={formAction} className='flex flex-col gap-3 md:flex-row md:items-end'>
            <input type='hidden' name='userId' value={userId} />
            <Field id={selectId} label='Role' error={roleError} className='md:w-56'>
              <NativeSelect
                key={role}
                id={selectId}
                name='role'
                defaultValue={role}
                aria-invalid={Boolean(roleError)}
                aria-describedby={describedBy(selectId, roleError)}
              >
                {roles.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type='submit' variant='outline' disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        ) : null}
        {canRemove ? <RemoveMember userId={userId} name={name} /> : null}
      </div>
      {state.status === 'idle' || roleError ? null : <FormMessage state={state} />}
    </div>
  )
}

function RemoveMember({ userId, name }: { userId: string; name: string }) {
  const [state, formAction, pending] = useActionState(removeMemberAction, IDLE)

  return (
    <ConfirmDialog
      trigger={
        <Button variant='outline'>
          Remove<span className='sr-only'> {name}</span>
        </Button>
      }
      title={`Remove ${name}?`}
      description='They lose access to the household straight away. You can invite them again later.'
      confirmLabel='Remove'
      pendingLabel='Removing…'
      tone='destructive'
      formAction={formAction}
      fields={{ userId }}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  )
}
