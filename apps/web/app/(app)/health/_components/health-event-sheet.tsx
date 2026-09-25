'use client'

import { createHealthEvent, deleteHealthEvent, healthEventKindSchema, updateHealthEvent, type HealthEvent } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { HEALTH_KIND_LABELS, type HealthEventKind } from '@ghar/core/health'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { HEALTH_TITLE_PLACEHOLDERS } from '@/lib/health/display'
import type { HealthFormOptions } from '@/lib/health/service'

const KINDS = healthEventKindSchema.options

/**
 * Logs a visit or a shot for one person, or edits one. Adding opens from its own button; editing is
 * opened by the timeline, which mounts a fresh sheet each time so the form starts from that record.
 */
export function HealthEventSheet({
  personId,
  personName,
  event,
  options,
  today,
  open: controlledOpen,
  onClose,
  trigger,
}: {
  personId: string
  /** "You" or their name, for the sheet's heading. */
  personName: string
  event?: HealthEvent
  options: HealthFormOptions
  today: CalendarDate
  /** Set by the timeline when it opens a record. Leave it out to open from `trigger`. */
  open?: boolean
  onClose?: () => void
  trigger?: ReactElement
}) {
  const formId = useId()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const [kind, setKind] = useState<HealthEventKind>(event?.kind ?? 'vaccine')

  const close = () => {
    setOwnOpen(false)
    onClose?.()
  }

  const save = useMutation(async (fields: BodyOf<typeof createHealthEvent>) => {
    if (event) await api.request(updateHealthEvent, { params: { eventId: event.id }, body: fields })
    else await api.request(createHealthEvent, { body: fields })
    close()
  })
  const remove = useMutation(async () => {
    if (!event) return
    await api.request(deleteHealthEvent, { params: { eventId: event.id } })
    close()
  })

  const onSubmit = (submitted: SyntheticEvent<HTMLFormElement>) => {
    submitted.preventDefault()
    const data = new FormData(submitted.currentTarget)
    const picked = healthEventKindSchema.safeParse(formText(data, 'kind'))
    save.mutate({
      personId,
      kind: picked.success ? picked.data : 'visit',
      title: formText(data, 'title') || null,
      occurredOn: formText(data, 'occurredOn'),
      contactId: formText(data, 'contactId') || null,
      documentId: hiddenDocument ? (event?.documentId ?? null) : formText(data, 'documentId') || null,
      note: formText(data, 'note') || null,
    })
  }

  // A linked document the editor can't see stays linked; it just can't be picked.
  const hiddenDocument = event?.documentId && !options.documents.some(document => document.id === event.documentId)
  const whose = personName === 'You' ? 'your' : `${personName}’s`

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (next) {
          setOwnOpen(true)
          return
        }
        save.clearError()
        remove.clearError()
        close()
      }}
      trigger={trigger}
      title={event ? 'Edit record' : 'Log a visit or shot'}
      description={event ? undefined : `For ${personName === 'You' ? 'you' : personName}.`}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending || remove.pending}>
            {save.pending ? 'Saving…' : event ? 'Save changes' : 'Save record'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div className='grid grid-cols-2 gap-3'>
          <Field label='What it was'>
            <NativeSelect
              name='kind'
              value={kind}
              onChange={change => {
                const next = healthEventKindSchema.safeParse(change.target.value)
                if (next.success) setKind(next.data)
              }}
            >
              {KINDS.map(option => (
                <option key={option} value={option}>
                  {HEALTH_KIND_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DateField id={`${formId}-on`} name='occurredOn' label='When' required max={today} defaultValue={event?.occurredOn ?? today} />
        </div>

        <Field label='Name' hint={`Leave it empty to call it “${HEALTH_KIND_LABELS[kind]}”.`}>
          <Input name='title' maxLength={120} defaultValue={event?.title} placeholder={HEALTH_TITLE_PLACEHOLDERS[kind]} />
        </Field>

        {options.contacts.length > 0 ? (
          <Field label='Doctor or clinic'>
            <NativeSelect name='contactId' defaultValue={event?.contactId ?? ''}>
              <option value=''>None</option>
              {options.contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {hiddenDocument ? null : options.documents.length > 0 ? (
          <Field label='Paperwork' hint='A certificate or a summary you’ve saved in Documents.'>
            <NativeSelect name='documentId' defaultValue={event?.documentId ?? ''}>
              <option value=''>None</option>
              {options.documents.map(document => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Note' hint='Keep it short. Results and reports belong in Documents, marked sensitive.'>
          <Textarea name='note' rows={3} maxLength={1000} defaultValue={event?.note ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>

        {event ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            <ConfirmDialog
              trigger={
                <Button type='button' variant='outline' disabled={remove.pending || save.pending}>
                  <Trash2 aria-hidden />
                  {remove.pending ? 'Deleting…' : 'Delete record'}
                </Button>
              }
              title='Delete this record?'
              description={`It comes off ${whose} history for good.`}
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

/** The button that opens a blank sheet. */
export function AddHealthEventButton(props: Omit<Parameters<typeof HealthEventSheet>[0], 'event' | 'open' | 'onClose' | 'trigger'>) {
  return (
    <HealthEventSheet
      {...props}
      trigger={
        <Button>
          <Plus aria-hidden />
          Log a visit
        </Button>
      }
    />
  )
}
