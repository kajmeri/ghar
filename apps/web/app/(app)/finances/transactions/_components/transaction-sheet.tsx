'use client'

import { getRuleSuggestion, saveCategoryRule, tagTransaction, type Category, type RuleSuggestion, type Transaction } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { useId, useState } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { CATEGORY_SOURCE_LABELS } from '@/lib/finances/display'

interface Change {
  categoryId: string | null
  isExcluded: boolean
  notes: string | null
}

/**
 * One charge, and the three things a person owns on it: what it is filed under, whether it counts
 * towards spending, and a note for whoever reads the list next. Everything else on a charge came
 * from the bank and is not ours to change.
 *
 * The list mounts a fresh one each time a row is opened, so the form always starts from that
 * charge's own answers.
 */
export function TransactionSheet({
  transaction,
  categories,
  currency,
  canManage,
  open,
  onClose,
  onSaved,
}: {
  transaction: Transaction
  categories: Category[]
  currency: string
  canManage: boolean
  open: boolean
  onClose: () => void
  onSaved: (transaction: Transaction) => void
}) {
  const formId = useId()
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? '')
  const [isExcluded, setIsExcluded] = useState(transaction.isExcluded)
  const [notes, setNotes] = useState(transaction.notes ?? '')
  const [offer, setOffer] = useState<RuleSuggestion | null>(null)

  const save = useMutation<[Change]>(async change => {
    const { transaction: saved } = await api.request(tagTransaction, { params: { transactionId: transaction.id }, body: change })
    onSaved(saved)

    // Filing one by hand is the moment to learn from: ask whether this merchant always goes here.
    // The charge is saved either way, so a suggestion that can't be fetched just closes the sheet.
    if (canManage && change.categoryId !== null) {
      try {
        const { suggestion } = await api.request(getRuleSuggestion, { params: { transactionId: transaction.id } })
        if (suggestion !== null) {
          setOffer(suggestion)
          return
        }
      } catch {
        // Nothing to offer, then.
      }
    }
    onClose()
  })

  const makeRule = useMutation<[RuleSuggestion]>(async suggestion => {
    await api.request(saveCategoryRule, {
      body: {
        matcherType: suggestion.matcherType,
        matcherValue: suggestion.matcherValue,
        categoryId: suggestion.categoryId,
        priority: 0,
      },
    })
    onClose()
  })

  const suggested = categories.find(category => category.id === transaction.suggestedCategoryId)
  const source = transaction.categorySource ? CATEGORY_SOURCE_LABELS[transaction.categorySource] : null

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (next) return
        save.clearError()
        onClose()
      }}
      title={offer === null ? (transaction.merchant ?? transaction.description) : 'File it this way every time?'}
      description={
        offer === null ? `${formatCalendarDate(transaction.postedOn)} · ${formatCents(transaction.amountCents, { currency })}` : undefined
      }
      footer={
        offer !== null ? (
          <>
            <SheetClose asChild>
              <Button variant='outline'>Not now</Button>
            </SheetClose>
            <Button
              type='button'
              disabled={makeRule.pending}
              onClick={() => {
                makeRule.mutate(offer)
              }}
            >
              {makeRule.pending ? 'Saving…' : 'Make the rule'}
            </Button>
          </>
        ) : canManage ? (
          <>
            <SheetClose asChild>
              <Button variant='outline'>Cancel</Button>
            </SheetClose>
            <Button form={formId} type='submit' disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        ) : undefined
      }
    >
      {offer === null ? null : (
        <div className='flex flex-col gap-3'>
          <p>
            Always file {offer.merchantLabel} as {offer.categoryName}?
          </p>
          <p className='text-sm text-ink-muted'>
            {offer.matchingCount === 0
              ? 'Charges from this merchant will be filed there from now on.'
              : offer.matchingCount === 1
                ? 'One charge waiting to be filed would go there now, and so would the ones after it.'
                : `${String(offer.matchingCount)} charges waiting to be filed would go there now, and so would the ones after them.`}
          </p>
          <FormError>{makeRule.error}</FormError>
        </div>
      )}

      <form
        hidden={offer !== null}
        id={formId}
        className='flex flex-col gap-4'
        onSubmit={event => {
          event.preventDefault()
          const note = notes.trim()
          save.mutate({ categoryId: categoryId === '' ? null : categoryId, isExcluded, notes: note === '' ? null : note })
        }}
      >
        <dl className='flex flex-col gap-1 text-sm'>
          <Detail label='Description'>{transaction.description}</Detail>
          <Detail label='Account'>{transaction.accountLabel ?? 'Typed in by hand'}</Detail>
          {transaction.isPending ? <Detail label='Status'>Still pending at the bank</Detail> : null}
        </dl>

        <Field
          label='Category'
          hint={
            suggested ? `Ghar thought ${suggested.name}, but wasn’t sure enough to file it.` : (source ?? 'Nothing has filed this one yet.')
          }
        >
          <NativeSelect
            value={categoryId}
            disabled={!canManage}
            onChange={event => {
              setCategoryId(event.target.value)
            }}
          >
            <option value=''>Not filed</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <CheckboxField
          label='Leave this out of spending'
          hint='For a transfer between your own accounts, or money someone paid you back.'
          checked={isExcluded}
          disabled={!canManage}
          onChange={event => {
            setIsExcluded(event.target.checked)
          }}
        />

        <Field label='Note' hint='For whoever reads this list next.'>
          <Textarea
            rows={3}
            maxLength={4000}
            value={notes}
            disabled={!canManage}
            onChange={event => {
              setNotes(event.target.value)
            }}
          />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}

function Detail({ label, children }: { label: string; children: string }) {
  return (
    <div className='flex justify-between gap-4'>
      <dt className='text-ink-muted'>{label}</dt>
      <dd className='min-w-0 text-right break-words'>{children}</dd>
    </div>
  )
}
