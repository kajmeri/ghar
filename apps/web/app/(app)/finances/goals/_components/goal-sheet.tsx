'use client'

import { createGoal, deleteGoal, updateGoal, type Account, type Goal } from '@ghar/contracts'
import { Trash2 } from 'lucide-react'
import { useId, type ReactNode, type SyntheticEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'

type GoalFields = NonNullable<BodyOf<typeof createGoal>>

/**
 * One thing the household is saving towards. The amount saved is never typed in: it is whatever
 * the linked account holds, so the goal can't drift from the money behind it.
 *
 * The list mounts a fresh one for each goal it opens, so the form starts from that goal.
 */
export function GoalSheet({
  goal,
  accounts,
  currency,
  today,
  trigger,
  open,
  onOpenChange,
}: {
  /** The goal being edited. Left out when adding one. */
  goal?: Goal
  /** The accounts a goal can follow. */
  accounts: Account[]
  currency: string
  today: string
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const formId = useId()

  const save = useMutation<[GoalFields]>(async fields => {
    if (goal) await api.request(updateGoal, { params: { goalId: goal.id }, body: fields })
    else await api.request(createGoal, { body: fields })
    onOpenChange(false)
  })

  const remove = useMutation(async () => {
    if (!goal) return
    await api.request(deleteGoal, { params: { goalId: goal.id } })
    onOpenChange(false)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const targetCents = formText(data, 'targetCents')
    if (targetCents === '') return
    const linkedAccountId = formText(data, 'linkedAccountId')
    save.mutate({
      name: formText(data, 'name'),
      targetCents: Number(targetCents),
      targetDate: formText(data, 'targetDate') || null,
      notes: formText(data, 'notes') || null,
      linkedAccountId: linkedAccountId === '' ? null : linkedAccountId,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) {
          save.clearError()
          remove.clearError()
        }
        onOpenChange(next)
      }}
      trigger={trigger}
      title={goal ? 'Edit goal' : 'Add a goal'}
      description={goal ? undefined : 'Something you’re putting money aside for, and the account it lands in.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : goal ? 'Save changes' : 'Save goal'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={80} autoComplete='off' placeholder='Emergency fund' defaultValue={goal?.name} />
        </Field>

        <MoneyInput
          id={`${formId}-target`}
          name='targetCents'
          label='Target'
          required
          currency={currency}
          defaultValue={goal?.targetCents}
        />

        <DateField
          id={`${formId}-date`}
          name='targetDate'
          label='Have it by'
          hint='Leave it empty for a goal with no deadline.'
          min={today}
          defaultValue={goal?.targetDate ?? undefined}
        />

        <Field label='Account' hint='Its balance is the progress. Leave it empty until the money has somewhere to live.'>
          <NativeSelect name='linkedAccountId' defaultValue={goal?.linkedAccountId ?? ''}>
            <option value=''>No account yet</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label='Notes'>
          <Textarea name='notes' rows={3} maxLength={500} defaultValue={goal?.notes ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>

        {goal ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            <ConfirmDialog
              trigger={
                <Button type='button' variant='outline' disabled={remove.pending}>
                  <Trash2 aria-hidden />
                  {remove.pending ? 'Deleting…' : 'Delete goal'}
                </Button>
              }
              title={`Delete ${goal.name}?`}
              description='The goal goes. The account it followed, and the money in it, are untouched.'
              confirmLabel='Delete'
              tone='destructive'
              onConfirm={() => {
                remove.mutate()
              }}
            />
            <FormError>{remove.error}</FormError>
          </div>
        ) : null}
      </form>
    </Sheet>
  )
}
