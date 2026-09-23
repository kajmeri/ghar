'use client'

import {
  createCategory,
  setCategoryArchived,
  updateCategory,
  type Category,
  type CategoryColorTokenValue,
  type CategoryIconValue,
  type CategoryKindValue,
} from '@ghar/contracts'
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { CATEGORY_KIND_LABELS, CATEGORY_KINDS_IN_ORDER, toCategoryKind } from './kinds'
import { ColorField, IconField } from './style-fields'

/**
 * One category. What it is for and where it sits are settled when it is made: a category already
 * has charges filed under it, and moving it would quietly rewrite months of spending. Everything
 * else — its name, its icon, its colour, whether it is still in use — can change.
 *
 * The list mounts a fresh one for each category it opens, so the form starts from that category.
 */
export function CategorySheet({
  category,
  parents,
  trigger,
  open,
  onOpenChange,
}: {
  /** The category being edited. Left out when adding one. */
  category?: Category
  /** The top-level categories still in use, as possible parents. */
  parents: Category[]
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const formId = useId()
  const [kind, setKind] = useState<CategoryKindValue>('expense')
  const [icon, setIcon] = useState<CategoryIconValue>(category?.icon ?? 'tag')
  const [colorToken, setColorToken] = useState<CategoryColorTokenValue>(category?.colorToken ?? 'ink-muted')
  const parent = parents.find(row => row.id === category?.parentId)

  const save = useMutation<[FormData]>(async data => {
    const name = formText(data, 'name')
    if (category) {
      await api.request(updateCategory, { params: { categoryId: category.id }, body: { name, icon, colorToken } })
    } else {
      const parentId = formText(data, 'parentId')
      await api.request(createCategory, {
        body: { name, kind, parentId: parentId === '' ? null : parentId, icon, colorToken },
      })
    }
    onOpenChange(false)
  })

  const archive = useMutation<[boolean]>(async isArchived => {
    if (!category) return
    await api.request(setCategoryArchived, { params: { categoryId: category.id }, body: { isArchived } })
    onOpenChange(false)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(new FormData(event.currentTarget))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) {
          save.clearError()
          archive.clearError()
        }
        onOpenChange(next)
      }}
      trigger={trigger}
      title={category ? 'Edit category' : 'Add a category'}
      description={
        category
          ? `${CATEGORY_KIND_LABELS[category.kind].one}${parent ? ` under ${parent.name}` : ''}`
          : 'What it is for and where it sits are settled now; the rest can change later.'
      }
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : category ? 'Save changes' : 'Save category'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={40} autoComplete='off' placeholder='Coffee' defaultValue={category?.name} />
        </Field>

        {category ? null : (
          <>
            <Field label='What it is for'>
              <NativeSelect
                name='kind'
                value={kind}
                onChange={event => {
                  setKind(toCategoryKind(event.target.value))
                }}
              >
                {CATEGORY_KINDS_IN_ORDER.map(value => (
                  <option key={value} value={value}>
                    {CATEGORY_KIND_LABELS[value].one}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field label='Sits under' hint='Leave it on its own for a category of its own.'>
              <NativeSelect name='parentId' defaultValue=''>
                <option value=''>On its own</option>
                {parents
                  .filter(row => row.kind === kind)
                  .map(row => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          </>
        )}

        <IconField value={icon} onChange={setIcon} />
        <ColorField value={colorToken} onChange={setColorToken} />

        <FormError>{save.error}</FormError>

        {category ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            {category.isArchived ? (
              <Button
                type='button'
                variant='outline'
                disabled={archive.pending}
                onClick={() => {
                  archive.mutate(false)
                }}
              >
                {archive.pending ? 'Restoring…' : 'Bring it back'}
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button type='button' variant='outline' disabled={archive.pending}>
                    {archive.pending ? 'Archiving…' : 'Stop using it'}
                  </Button>
                }
                title={`Stop using ${category.name}?`}
                description='Everything filed under it stays where it is. It drops out of the pickers and out of what Ghar files by itself, and anything under it is archived with it. You can bring it back.'
                confirmLabel='Stop using it'
                onConfirm={() => {
                  archive.mutate(true)
                }}
              />
            )}
            <FormError>{archive.error}</FormError>
          </div>
        ) : null}
      </form>
    </Sheet>
  )
}
