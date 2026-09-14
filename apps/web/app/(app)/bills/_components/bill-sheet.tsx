'use client'

import { billCadenceSchema, createBill, updateBill, type Bill, type BillCadenceValue } from '@ghar/contracts'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { BILL_CADENCE_LABELS, MONTH_OPTIONS } from '@/lib/bills/display'
import type { BillFormOptions } from '@/lib/bills/service'
import { formText } from '@/lib/form'
import { withScheme } from '@/lib/urls'

type Fields = NonNullable<BodyOf<typeof updateBill>>

const CADENCES = billCadenceSchema.options

/** Adds a bill the household pays, or edits one. */
export function BillSheet({ bill, options, currency }: { bill?: Bill; options: BillFormOptions; currency: string }) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [cadence, setCadence] = useState<BillCadenceValue>(bill?.cadence ?? 'monthly')

  const save = useMutation<[Fields]>(async fields => {
    if (bill) {
      await api.request(updateBill, { params: { billId: bill.id }, body: fields })
    } else {
      await api.request(createBill, { body: fields })
    }
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    setCadence(bill?.cadence ?? 'monthly')
    if (!next) save.clearError()
  }

  // A bill on a hidden account or an archived category keeps it; nothing new gets filed there.
  const accounts =
    bill?.accountId && !options.accounts.some(account => account.id === bill.accountId)
      ? [...options.accounts, { id: bill.accountId, label: bill.accountName ?? 'Its current account' }]
      : options.accounts
  const categories = options.categories.filter(category => !category.isArchived || category.id === bill?.categoryId)

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const parsed = billCadenceSchema.safeParse(formText(data, 'cadence'))
    const chosen = parsed.success ? parsed.data : 'monthly'
    const amount = formText(data, 'amountCents')
    const month = formText(data, 'dueMonth')
    save.mutate({
      name: formText(data, 'name'),
      payee: formText(data, 'payee'),
      amountCents: amount === '' ? null : Number(amount),
      isVariable: data.get('isVariable') === 'on',
      cadence: chosen,
      dueDay: Number(formText(data, 'dueDay')),
      dueMonth: chosen === 'monthly' || month === '' ? null : Number(month),
      autopay: data.get('autopay') === 'on',
      accountId: formText(data, 'accountId') || null,
      categoryId: formText(data, 'categoryId') || null,
      url: withScheme(formText(data, 'url')) || null,
      notes: formText(data, 'notes') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        bill ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit bill
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            Add a bill
          </Button>
        )
      }
      title={bill ? 'Edit bill' : 'Add a bill'}
      description={bill ? undefined : 'Ghar finds the payment in your bank transactions, so there’s nothing to tick off.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : bill ? 'Save changes' : 'Save bill'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={120} defaultValue={bill?.name} placeholder='Electricity' />
        </Field>

        <Field label='Paid to' hint='As it shows on your bank statement. It’s how Ghar spots the payment.'>
          <Input name='payee' required maxLength={120} defaultValue={bill?.payee} placeholder='PG&E' autoComplete='off' />
        </Field>

        <MoneyInput
          id={`${formId}-amount`}
          name='amountCents'
          label='Usual amount'
          hint='Leave it empty to count a payment of any size.'
          currency={currency}
          defaultValue={bill?.amountCents ?? undefined}
        />
        <CheckboxField
          name='isVariable'
          label='The amount changes'
          hint='For utilities. A payment a fair bit higher or lower still counts.'
          defaultChecked={bill?.isVariable}
        />

        <Field label='How often'>
          <NativeSelect
            name='cadence'
            value={cadence}
            onChange={event => {
              const next = billCadenceSchema.safeParse(event.target.value)
              if (next.success) setCadence(next.data)
            }}
          >
            {CADENCES.map(value => (
              <option key={value} value={value}>
                {BILL_CADENCE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          {cadence === 'monthly' ? null : (
            <Field label={cadence === 'quarterly' ? 'Starting in' : 'Month'}>
              <NativeSelect name='dueMonth' required defaultValue={bill?.dueMonth ?? ''}>
                <option value='' disabled>
                  Pick a month
                </option>
                {MONTH_OPTIONS.map(month => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label='Due on day' hint={cadence === 'monthly' ? 'Late in a short month, it’s the last day.' : undefined}>
            <Input
              name='dueDay'
              type='number'
              inputMode='numeric'
              required
              min={1}
              max={31}
              step={1}
              defaultValue={bill?.dueDay}
              placeholder='15'
            />
          </Field>
        </div>

        <CheckboxField
          name='autopay'
          label='Paid automatically'
          hint='It still shows as late if no payment turns up.'
          defaultChecked={bill?.autopay}
        />

        {accounts.length > 0 ? (
          <Field label='Paid from' hint='Only payments from this account count.'>
            <NativeSelect name='accountId' defaultValue={bill?.accountId ?? ''}>
              <option value=''>Any account</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {categories.length > 0 ? (
          <Field label='Category'>
            <NativeSelect name='categoryId' defaultValue={bill?.categoryId ?? ''}>
              <option value=''>None</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Where to pay it'>
          <Input
            name='url'
            inputMode='url'
            defaultValue={bill?.url ?? undefined}
            placeholder='pge.com'
            autoComplete='off'
            autoCapitalize='none'
          />
        </Field>

        <Field label='Notes' hint='Account number, who to call about it.'>
          <Textarea name='notes' rows={3} maxLength={4000} defaultValue={bill?.notes ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
