'use client'

import {
  ApiClientError,
  discardDocumentUpload,
  healthEventKindSchema,
  saveHealthScan,
  scanHealthRecord,
  type HealthEventKindValue,
  type HealthScanEvent,
} from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { isScannableMimeType } from '@ghar/core/document-scan'
import { HEALTH_KIND_LABELS } from '@ghar/core/health'
import { Camera, FileUp } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { FilePicker } from '@/app/(app)/documents/_components/file-picker'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { prepareDocumentFile, uploadDocumentFile, UploadError } from '@/lib/documents/upload'
import { HEALTH_TITLE_PLACEHOLDERS } from '@/lib/health/display'

const KINDS = healthEventKindSchema.options

/** One suggested record as the person has it now: ticked or not, and whatever they corrected. */
interface Row {
  key: string
  include: boolean
  kind: HealthEventKindValue
  title: string
  occurredOn: string
  alreadyLogged: boolean
  /** What it was called when it was read, for its checkbox, so the label holds still while they edit. */
  read: string
}

type Step = 'pick' | 'reading' | 'review' | 'nothing'

function toRow(event: HealthScanEvent): Row {
  return {
    key: crypto.randomUUID(),
    // One already on the history starts unticked, so it isn't logged twice.
    include: !event.alreadyLogged,
    kind: event.kind,
    title: event.title ?? '',
    occurredOn: event.occurredOn ?? '',
    alreadyLogged: event.alreadyLogged,
    read: event.title ?? HEALTH_KIND_LABELS[event.kind],
  }
}

function problemOf(cause: unknown): string {
  if (cause instanceof UploadError) return cause.message
  if (cause instanceof ApiClientError) return cause.code === 'network_error' ? 'No connection. Ghar couldn’t read the file.' : cause.message
  return 'Something went wrong. Try again, or log the records yourself.'
}

/**
 * Claude reads a vaccine card or a visit summary into records for one person. They tick the ones
 * to keep, correct anything it misread, and save them together. Nothing is saved before that, and
 * the file is kept as a document only if they want it.
 */
export function HealthScanSheet({
  personId,
  personName,
  today,
  keepsPrivate,
  trigger,
}: {
  personId: string
  /** "You" or their name. */
  personName: string
  today: CalendarDate
  /** Whether the caller can mark a document sensitive, so a kept scan is for owners and adults only. */
  keepsPrivate: boolean
  trigger: ReactElement
}) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('pick')
  const [problem, setProblem] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [keep, setKeep] = useState(true)
  const [documentTitle, setDocumentTitle] = useState('')
  // The file in the bucket while it's being checked. It's deleted if they cancel or pick another.
  const uploaded = useRef<string | null>(null)

  const discardUploaded = () => {
    const stray = uploaded.current
    uploaded.current = null
    // Best effort: a stray upload costs a little storage, never someone's records.
    if (stray) api.request(discardDocumentUpload, { body: { storagePath: stray } }).catch(() => undefined)
  }

  const save = useMutation(async (storagePath: string, events: Row[]) => {
    await api.request(saveHealthScan, {
      body: {
        personId,
        storagePath,
        events: events.map(row => ({ kind: row.kind, title: row.title.trim() || null, occurredOn: row.occurredOn })),
        keepAs: keep ? { title: documentTitle.trim() || 'Health record' } : null,
      },
    })
    // Saved, so the file is the document's now, or already gone.
    uploaded.current = null
    setOpen(false)
  })

  /** Every opening starts from a fresh pick. */
  const startOver = () => {
    setStep('pick')
    setProblem(null)
    setRows([])
    setKeep(true)
    setDocumentTitle('')
    save.clearError()
  }

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const chosen = input.files?.[0]
    // Cleared so choosing the same file again still counts as a change.
    input.value = ''
    if (!chosen) return
    setProblem(null)
    save.clearError()
    setStep('reading')
    try {
      const file = await prepareDocumentFile(chosen)
      if (!isScannableMimeType(file.mimeType)) {
        throw new UploadError('Ghar can’t read a HEIC photo. Use a JPEG or a PDF, or log the records yourself.')
      }
      discardUploaded()
      const storagePath = await uploadDocumentFile(file)
      uploaded.current = storagePath
      const { suggestion } = await api.request(scanHealthRecord, { body: { personId, storagePath } })
      if (suggestion === null || suggestion.events.length === 0) {
        discardUploaded()
        setStep('nothing')
        return
      }
      setRows(suggestion.events.map(toRow))
      setDocumentTitle(suggestion.documentTitle ?? 'Health record')
      setStep('review')
    } catch (cause) {
      setProblem(problemOf(cause))
      setStep('pick')
    }
  }

  const update = (key: string, patch: Partial<Row>) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }

  const chosen = rows.filter(row => row.include)

  const onSubmit = (submitted: SyntheticEvent<HTMLFormElement>) => {
    submitted.preventDefault()
    const storagePath = uploaded.current
    if (storagePath === null || chosen.length === 0) return
    const undated = chosen.find(row => row.occurredOn === '')
    if (undated) {
      setProblem(`Add the date for “${undated.title.trim() || HEALTH_KIND_LABELS[undated.kind]}”, or untick it.`)
      return
    }
    setProblem(null)
    save.mutate(storagePath, chosen)
  }

  const forWhom = personName === 'You' ? 'you' : personName
  const reading = step === 'reading'

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (next) startOver()
        else discardUploaded()
        setOpen(next)
      }}
      trigger={trigger}
      title='Scan a record'
      description={`For ${forWhom}. Claude reads a vaccine card or visit summary for what happened and when, and you check each one before it’s saved.`}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          {step === 'review' ? (
            <Button type='submit' form={formId} disabled={save.pending || chosen.length === 0}>
              {save.pending ? 'Saving…' : chosen.length === 1 ? 'Save 1 record' : `Save ${String(chosen.length)} records`}
            </Button>
          ) : null}
        </>
      }
    >
      {step === 'review' ? (
        <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
          <p className='text-sm text-ink-muted'>Check each one against the paper. Untick any you don’t want.</p>
          <ul className='flex flex-col gap-3'>
            {rows.map(row => (
              <li key={row.key} className='flex flex-col gap-3 rounded-card border border-line px-3 pb-3'>
                <CheckboxField
                  label={row.read}
                  hint={row.alreadyLogged ? 'Already on the history' : row.occurredOn === '' ? 'Add the date it happened' : undefined}
                  checked={row.include}
                  onChange={change => {
                    update(row.key, { include: change.target.checked })
                  }}
                />
                {row.include ? (
                  <div className='grid grid-cols-2 gap-3'>
                    <Field label='What it was'>
                      <NativeSelect
                        value={row.kind}
                        onChange={change => {
                          const kind = healthEventKindSchema.safeParse(change.target.value)
                          if (kind.success) update(row.key, { kind: kind.data })
                        }}
                      >
                        {KINDS.map(option => (
                          <option key={option} value={option}>
                            {HEALTH_KIND_LABELS[option]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label='When'>
                      <Input
                        type='date'
                        required
                        max={today}
                        value={row.occurredOn}
                        onChange={change => {
                          update(row.key, { occurredOn: change.target.value })
                        }}
                      />
                    </Field>
                    <Field label='Name' className='col-span-2'>
                      <Input
                        maxLength={120}
                        value={row.title}
                        placeholder={HEALTH_TITLE_PLACEHOLDERS[row.kind]}
                        onChange={change => {
                          update(row.key, { title: change.target.value })
                        }}
                      />
                    </Field>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          <div className='flex flex-col gap-3 border-t border-line pt-2'>
            <CheckboxField
              label='Keep the scan in Documents'
              hint={
                keepsPrivate
                  ? 'As a medical document only owners and adults can open. Each record links to it.'
                  : 'As a medical document. Each record links to it.'
              }
              checked={keep}
              onChange={change => {
                setKeep(change.target.checked)
              }}
            />
            {keep ? (
              <Field label='Name for the scan'>
                <Input
                  maxLength={200}
                  value={documentTitle}
                  onChange={change => {
                    setDocumentTitle(change.target.value)
                  }}
                />
              </Field>
            ) : null}
          </div>

          <FormError>{problem ?? save.error}</FormError>
        </form>
      ) : (
        <div className='flex flex-col gap-4'>
          <p className='text-sm text-ink-muted'>
            {step === 'nothing'
              ? 'Claude couldn’t find any shots or visits on that. Try a clearer photo, or log them yourself.'
              : 'A clear photo or a PDF works best. It never reads results, diagnoses, names or ID numbers.'}
          </p>
          <div className='grid grid-cols-2 gap-3'>
            <FilePicker
              icon={Camera}
              label='Take a photo'
              accept='image/*'
              capture='environment'
              disabled={reading}
              onChange={event => {
                void onPick(event)
              }}
            />
            <FilePicker
              icon={FileUp}
              label='Choose a file'
              accept='image/*,application/pdf'
              disabled={reading}
              onChange={event => {
                void onPick(event)
              }}
            />
          </div>
          <p role='status' className={reading ? 'text-sm text-ink-muted' : 'sr-only'}>
            {reading ? 'Claude is reading it…' : ''}
          </p>
          <FormError>{problem}</FormError>
        </div>
      )}
    </Sheet>
  )
}
