'use client'

import { assertCalendarDate } from '@ghar/core/dates'
import type { Cents } from '@ghar/core/money'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

// Fixed dates keep the page the same from one day to the next.
const DUE = assertCalendarDate('2026-09-30')
const TRIP_RETURN = assertCalendarDate('2026-09-02')

export function FieldsDemo() {
  const [cents, setCents] = useState<Cents | null>(12_450)

  return (
    <div className='grid gap-x-6 gap-y-5 rounded-card border border-line bg-surface p-4 md:grid-cols-2 md:p-6'>
      <div className='flex flex-col gap-2'>
        <MoneyInput
          id='sg-amount'
          name='amount'
          label='Amount'
          defaultValue={12_450}
          hint='Type it however you write it: 1234.5, $1,234.56 or (40).'
          onValueChange={setCents}
        />
        <p className='text-sm text-ink-muted' aria-live='polite'>
          Submits <span className='font-medium text-ink'>{cents === null ? 'nothing until it’s a valid amount' : `${cents} cents`}</span>
        </p>
      </div>
      <DateField id='sg-due' name='due' label='Due date' defaultValue={DUE} hint='The platform’s own picker, so phones get their wheel.' />
      <MoneyInput id='sg-limit' name='limit' label='Monthly limit' defaultValue={0} error='Enter a limit above zero' />
      <DateField id='sg-return' name='return' label='Return date' defaultValue={TRIP_RETURN} error='Pick a date after the trip starts' />
      <Field id='sg-name' label='Bill name'>
        <Input id='sg-name' name='name' defaultValue='Water and sewer' />
      </Field>
      <MoneyInput
        id='sg-opening'
        name='opening'
        label='Opening balance'
        defaultValue={250_000}
        hint='Set when the account was connected.'
        disabled
      />
    </div>
  )
}

export function SheetDemo() {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <div className='flex flex-col items-start gap-3'>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button>
            <Plus aria-hidden />
            Add a bill
          </Button>
        }
        title='Add a bill'
        description='Ghar reminds everyone a few days before it’s due.'
        footer={
          <>
            <SheetClose asChild>
              <Button type='button' variant='outline'>
                Cancel
              </Button>
            </SheetClose>
            <Button type='submit' form='sg-bill'>
              Save bill
            </Button>
          </>
        }
      >
        <form
          id='sg-bill'
          className='flex flex-col gap-5'
          onSubmit={event => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            setSaved(`${text(data.get('name'))}, ${text(data.get('amount'))} cents, due ${text(data.get('due'))}`)
            setOpen(false)
          }}
        >
          <Field id='sg-bill-name' label='Name'>
            <Input id='sg-bill-name' name='name' defaultValue='Water and sewer' required />
          </Field>
          <MoneyInput id='sg-bill-amount' name='amount' label='Amount' required />
          <DateField id='sg-bill-due' name='due' label='Due date' defaultValue={DUE} required />
        </form>
      </Sheet>
      <p role='status' className='text-sm text-ink-muted'>
        {saved ? `Would save: ${saved}.` : 'Rises from the bottom on a phone and slides in from the right on a wider screen.'}
      </p>
    </div>
  )
}

export function ConfirmDemo() {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className='flex flex-col items-start gap-3'>
      <ConfirmDialog
        trigger={<Button variant='outline'>Delete document</Button>}
        title='Delete the passport scan?'
        description='It’s removed for everyone in the household and can’t be recovered.'
        confirmLabel='Delete document'
        tone='destructive'
        onConfirm={() => {
          setConfirmed(true)
        }}
      />
      <p role='status' className='text-sm text-ink-muted'>
        {confirmed ? 'Confirmed. Nothing was deleted; this is the styleguide.' : 'Focus starts on Cancel.'}
      </p>
    </div>
  )
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}
