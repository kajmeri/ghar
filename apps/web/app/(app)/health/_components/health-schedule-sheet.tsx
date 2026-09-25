'use client'

import {
  createHealthSchedule,
  deleteHealthSchedule,
  healthEventKindSchema,
  updateHealthSchedule,
  type HealthSchedule,
} from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { HEALTH_EARLIEST_DATE, HEALTH_KIND_LABELS, HEALTH_SCHEDULE_PRESETS, type HealthEventKind } from '@ghar/core/health'
import { renewalCadenceLabel } from '@ghar/core/renewals'
import { Trash2 } from 'lucide-react'
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { HEALTH_CADENCE_OPTIONS, HEALTH_TITLE_PLACEHOLDERS } from '@/lib/health/display'

const KINDS = healthEventKindSchema.options

/**
 * Sets how often one person has one kind of visit, or edits that. A new one starts from a preset
 * or from scratch; its first due date is today unless changed, so it never starts out overdue.
 */
export function HealthScheduleSheet({
  personId,
  personName,
  schedule,
  today,
  open: controlledOpen,
  onClose,
  trigger,
}: {
  personId: string
  /** "You" or their name. */
  personName: string
  schedule?: HealthSchedule
  today: CalendarDate
  open?: boolean
  onClose?: () => void
  trigger?: ReactElement
}) {
  const formId = useId()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const [kind, setKind] = useState<HealthEventKind>(schedule?.kind ?? 'dental')
  const [title, setTitle] = useState(schedule?.title ?? '')
  const [cadence, setCadence] = useState(schedule?.cadenceMonths ?? 6)
  const [preset, setPreset] = useState<string | null>(null)

  const close = () => {
    setOwnOpen(false)
    onClose?.()
  }

  const save = useMutation(async (fields: BodyOf<typeof createHealthSchedule>) => {
    if (schedule) await api.request(updateHealthSchedule, { params: { scheduleId: schedule.id }, body: fields })
    else await api.request(createHealthSchedule, { body: fields })
    close()
  })
  const remove = useMutation(async () => {
    if (!schedule) return
    await api.request(deleteHealthSchedule, { params: { scheduleId: schedule.id } })
    close()
  })

  const onSubmit = (submitted: SyntheticEvent<HTMLFormElement>) => {
    submitted.preventDefault()
    const data = new FormData(submitted.currentTarget)
    save.mutate({ personId, kind, title: title.trim() || null, cadenceMonths: cadence, firstDueOn: formText(data, 'firstDueOn') })
  }

  const cadences = HEALTH_CADENCE_OPTIONS.includes(cadence)
    ? HEALTH_CADENCE_OPTIONS
    : [...HEALTH_CADENCE_OPTIONS, cadence].toSorted((a, b) => a - b)
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
      title={schedule ? 'Edit schedule' : 'Add a schedule'}
      description={`Ghar works out when it’s next due from the last visit logged${personName === 'You' ? '' : ` for ${personName}`}.`}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending || remove.pending}>
            {save.pending ? 'Saving…' : schedule ? 'Save changes' : 'Save schedule'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        {schedule ? null : (
          <div className='flex flex-col gap-2'>
            <p id={`${formId}-presets`} className='text-sm font-medium text-ink'>
              Start from
            </p>
            <div role='group' aria-labelledby={`${formId}-presets`} className='grid grid-cols-2 gap-2'>
              {HEALTH_SCHEDULE_PRESETS.map(option => (
                <Button
                  key={option.key}
                  type='button'
                  variant={preset === option.key ? 'default' : 'outline'}
                  aria-pressed={preset === option.key}
                  className='h-auto min-h-tap flex-col items-start gap-0 py-2 text-left whitespace-normal'
                  onClick={() => {
                    setPreset(option.key)
                    setKind(option.kind)
                    setTitle(option.title ?? '')
                    setCadence(option.cadenceMonths)
                  }}
                >
                  <span>{option.title ?? HEALTH_KIND_LABELS[option.kind]}</span>
                  <span className='text-sm font-normal opacity-80'>{renewalCadenceLabel(option.cadenceMonths)}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='What it is'>
            <NativeSelect
              name='kind'
              value={kind}
              onChange={change => {
                const next = healthEventKindSchema.safeParse(change.target.value)
                if (next.success) {
                  setKind(next.data)
                  setPreset(null)
                }
              }}
            >
              {KINDS.map(option => (
                <option key={option} value={option}>
                  {HEALTH_KIND_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label='How often'>
            <NativeSelect
              name='cadenceMonths'
              value={String(cadence)}
              onChange={change => {
                setCadence(Number(change.target.value))
                setPreset(null)
              }}
            >
              {cadences.map(months => (
                <option key={months} value={months}>
                  {renewalCadenceLabel(months)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <Field
          label='Name'
          hint={`Leave it empty to count any ${HEALTH_KIND_LABELS[kind].toLowerCase()} record. With a name, only records called that count.`}
        >
          <Input
            name='title'
            maxLength={120}
            value={title}
            onChange={change => {
              setTitle(change.target.value)
              setPreset(null)
            }}
            placeholder={HEALTH_TITLE_PLACEHOLDERS[kind]}
          />
        </Field>

        <DateField
          id={`${formId}-first`}
          name='firstDueOn'
          label='Due from'
          hint='The first time it’s due. After that, it follows the last visit.'
          required
          min={HEALTH_EARLIEST_DATE}
          defaultValue={schedule?.firstDueOn ?? today}
        />

        <FormError>{save.error}</FormError>

        {schedule ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            <ConfirmDialog
              trigger={
                <Button type='button' variant='outline' disabled={remove.pending || save.pending}>
                  <Trash2 aria-hidden />
                  {remove.pending ? 'Deleting…' : 'Delete schedule'}
                </Button>
              }
              title='Delete this schedule?'
              description={`Reminders for it stop. ${whose.charAt(0).toUpperCase()}${whose.slice(1)} records stay as they are.`}
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
