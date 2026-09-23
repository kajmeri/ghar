'use client'

import { saveCategoryRule, type Category, type CategoryMatcherTypeValue } from '@ghar/contracts'
import { CATEGORY_MATCHER_TYPES } from '@ghar/core/finances'
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Notice } from '@/app/(app)/_components/ui/notice'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { MATCHER_TYPE_HINTS, MATCHER_TYPE_LABELS } from '@/lib/finances/display'
import { formText } from '@/lib/form'

const PLACEHOLDERS: Record<CategoryMatcherTypeValue, string> = {
  merchant_exact: 'Trader Joe’s',
  merchant_contains: 'uber',
  name_regex: '^AMZN',
  amount_range: '-5000..-1000',
}

function matcherType(value: string): CategoryMatcherTypeValue {
  return CATEGORY_MATCHER_TYPES.find(type => type === value) ?? 'merchant_exact'
}

/**
 * A new rule. Saving one also files the charges nobody has filed yet, so the sheet stays open to
 * say how many it caught: that number is the whole reason to make a rule.
 */
export function RuleSheet({
  categories,
  suggestedValue,
  suggestedCategoryId,
  trigger,
  open,
  onOpenChange,
}: {
  /** The categories a rule may file into: the household's own, still in use. */
  categories: Category[]
  suggestedValue?: string
  suggestedCategoryId?: string
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const formId = useId()
  const [type, setType] = useState<CategoryMatcherTypeValue>('merchant_exact')
  const [applied, setApplied] = useState<number | null>(null)

  const save = useMutation<[FormData]>(async data => {
    const { applied: filed } = await api.request(saveCategoryRule, {
      body: {
        matcherType: type,
        matcherValue: formText(data, 'matcherValue'),
        categoryId: formText(data, 'categoryId'),
        priority: 0,
      },
    })
    if (filed > 0) setApplied(filed)
    else onOpenChange(false)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(new FormData(event.currentTarget))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) save.clearError()
        onOpenChange(next)
      }}
      trigger={trigger}
      title='Add a rule'
      description={applied === null ? 'Ghar files a charge this way before it tries to work it out itself.' : undefined}
      footer={
        applied === null ? (
          <>
            <SheetClose asChild>
              <Button type='button' variant='outline'>
                Cancel
              </Button>
            </SheetClose>
            <Button type='submit' form={formId} disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save rule'}
            </Button>
          </>
        ) : (
          <SheetClose asChild>
            <Button type='button'>Done</Button>
          </SheetClose>
        )
      }
    >
      {applied === null ? (
        <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
          <Field label='When'>
            <NativeSelect
              value={type}
              onChange={event => {
                setType(matcherType(event.target.value))
              }}
            >
              {CATEGORY_MATCHER_TYPES.map(value => (
                <option key={value} value={value}>
                  {MATCHER_TYPE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label='This' hint={MATCHER_TYPE_HINTS[type]}>
            <Input
              name='matcherValue'
              required
              maxLength={200}
              autoComplete='off'
              placeholder={PLACEHOLDERS[type]}
              defaultValue={suggestedValue}
            />
          </Field>

          <Field label='File it as'>
            <NativeSelect name='categoryId' required defaultValue={suggestedCategoryId ?? ''}>
              <option value='' disabled>
                Pick a category
              </option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <FormError>{save.error}</FormError>
        </form>
      ) : (
        <Notice tone='positive' role='status'>
          {applied === 1
            ? 'Saved. It filed one charge that was waiting.'
            : `Saved. It filed ${String(applied)} charges that were waiting.`}
        </Notice>
      )}
    </Sheet>
  )
}
