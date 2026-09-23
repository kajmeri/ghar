'use client'

import { deleteBudgetLine, setBudgetLine, type BudgetLine, type Category } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useId, type ReactNode, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { transactionsHref } from '@/lib/finances/display'

/**
 * What one category is planned for this month. Adding and editing are the same form: editing
 * fixes the category, because moving a plan from one category to another is two decisions.
 *
 * The caller mounts a fresh one for each line it opens, so the form starts from that line.
 */
export function BudgetLineSheet({
  periodStart,
  line,
  choices,
  range,
  currency,
  trigger,
  open,
  onOpenChange,
}: {
  periodStart: string
  /** The line being changed. Left out when planning a category for the first time. */
  line?: BudgetLine
  /** The categories still open to plan. Only read when adding. */
  choices?: Category[]
  range: { from: string; to: string }
  currency: string
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const formId = useId()

  const save = useMutation<[{ categoryId: string; plannedCents: number; rolloverEnabled: boolean }]>(async fields => {
    await api.request(setBudgetLine, { body: { periodStart, ...fields } })
    onOpenChange(false)
  })

  const remove = useMutation(async () => {
    if (!line) return
    await api.request(deleteBudgetLine, { params: { lineId: line.id } })
    onOpenChange(false)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const categoryId = line ? line.categoryId : formText(data, 'categoryId')
    const plannedCents = formText(data, 'plannedCents')
    if (categoryId === '' || plannedCents === '') return
    save.mutate({ categoryId, plannedCents: Number(plannedCents), rolloverEnabled: data.get('rolloverEnabled') === 'on' })
  }

  const money = (cents: number) => formatCents(cents, { currency })

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
      title={line ? line.categoryName : 'Plan a category'}
      description={line ? `${money(line.actualCents)} spent so far` : 'How much this month sets aside for it.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : line ? 'Save changes' : 'Save plan'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        {line ? null : (
          <Field label='Category' hint='Only expense categories can be planned for.'>
            <NativeSelect name='categoryId' required defaultValue=''>
              <option value='' disabled>
                Pick one
              </option>
              {(choices ?? []).map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}

        <MoneyInput
          id={`${formId}-planned`}
          name='plannedCents'
          label='Planned for the month'
          required
          currency={currency}
          defaultValue={line?.plannedCents}
        />

        <CheckboxField
          name='rolloverEnabled'
          label='Carry what’s left into next month'
          hint='Adds this month’s leftover to next month’s plan, or takes the overspend off it.'
          defaultChecked={line?.rolloverEnabled ?? false}
        />

        {line && line.rolloverInCents !== 0 ? (
          <p className='text-sm text-ink-muted'>
            {line.rolloverInCents > 0
              ? `${money(line.rolloverInCents)} carried in from the month before, so ${money(line.availableCents)} is available.`
              : `${money(-line.rolloverInCents)} of overspend came across from the month before, leaving ${money(line.availableCents)}.`}
          </p>
        ) : null}

        {line ? (
          <Link href={transactionsHref({ ...range, category: line.categoryId })} className='text-sm text-ink underline underline-offset-4'>
            See these charges
          </Link>
        ) : null}

        <FormError>{save.error}</FormError>

        {line ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            <ConfirmDialog
              trigger={
                <Button type='button' variant='outline' disabled={remove.pending}>
                  <Trash2 aria-hidden />
                  {remove.pending ? 'Removing…' : 'Remove from the plan'}
                </Button>
              }
              title={`Stop planning for ${line.categoryName}?`}
              description='What was spent under it stays where it is. The month just stops planning for it.'
              confirmLabel='Remove'
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
