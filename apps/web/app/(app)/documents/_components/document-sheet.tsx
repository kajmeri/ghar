'use client'

import {
  createDocument,
  discardDocumentUpload,
  documentKindSchema,
  scanDocument,
  scanDocumentUpload,
  updateDocument,
  type DocumentSuggestionValue,
  type HouseholdDocument,
} from '@ghar/contracts'
import { isScannableMimeType } from '@ghar/core/document-scan'
import { DOCUMENT_KINDS, type DocumentKind } from '@ghar/core/documents'
import { defaultReminderLeadDays } from '@ghar/core/expiries'
import { Camera, FileText, FileUp, Pencil, Plus } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { PersonField, type PersonOption } from '@/app/(app)/_components/ui/person-field'
import { ReminderLeadField, remindFromDaysOf } from '@/app/(app)/_components/ui/reminder-lead-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { DOCUMENT_KIND_LABELS, fileTypeLabel, formatFileSize } from '@/lib/documents/display'
import { prepareDocumentFile, uploadDocumentFile, UploadError, type PreparedFile } from '@/lib/documents/upload'
import { fillFromScan, NOTHING_FILLED, type ScanField, type ScanOutcome } from '@/lib/documents/scan-form'
import { formText } from '@/lib/form'
import { cn } from '@/lib/utils'
import { FilePicker } from './file-picker'
import { ScanDates } from './scan-dates'

export interface AssetOption {
  id: string
  name: string
}

type Fields = NonNullable<BodyOf<typeof updateDocument>>

interface Picked {
  /** New for each file picked, so a scan of the last one doesn't linger. */
  id: string
  file: PreparedFile
  previewUrl: string | null
}

/** Types every browser can draw in an img. HEIC outside Safari shows its name instead. */
const PREVIEWABLE = new Set<string>(['image/jpeg', 'image/png', 'image/webp'])

const SCAN_FIELDS: readonly ScanField[] = ['expiresOn', 'issuedOn', 'kind', 'title', 'issuer']

/**
 * Adds a document, or edits one's details. Adding starts with the camera, because the paper is
 * usually in someone's hand: a photo, a title, save. Everything else is optional.
 */
export function DocumentSheet({
  document,
  assets,
  people,
  canMarkSensitive,
  assetId,
  variant = 'default',
}: {
  /** Edits this document. Leave it out to add one. */
  document?: HouseholdDocument
  assets: AssetOption[]
  /** Everyone a document can belong to, as the picker shows them. */
  people: PersonOption[]
  /**
   * Owners and adults, who may make any document private. Anyone else may make only their own
   * private, since a private document is hidden from everyone but owners, adults and its person.
   */
  canMarkSensitive: boolean
  /** Links a new document to this asset to start with. */
  assetId?: string
  /** The add button's look. Outline where it isn't the page's main action. */
  variant?: 'default' | 'outline'
}) {
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  // The default reminder lead time depends on the kind: an ID needs months to renew.
  const [kind, setKind] = useState<DocumentKind>(document?.kind ?? 'other')
  // Whose it is decides whether a member may keep it private.
  const [personId, setPersonId] = useState<string | null>(document?.personId ?? null)
  const mayMarkPrivate = canMarkSensitive || people.some(person => person.you === true && person.id === personId)
  // A retry after the details failed to save, or a save after a scan, reuses the file that already uploaded.
  const uploaded = useRef<{ file: PreparedFile; storagePath: string } | null>(null)
  // What the last scan put in the form, which the next scan may replace.
  const scanned = useRef<Partial<Record<ScanField, string>>>({})

  const replacePicked = (next: Picked | null) => {
    if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl)
    setPicked(next)
  }

  async function uploadOnce(file: PreparedFile): Promise<string> {
    if (uploaded.current?.file === file) return uploaded.current.storagePath
    const storagePath = await uploadDocumentFile(file)
    uploaded.current = { file, storagePath }
    return storagePath
  }

  /** An upload that won't become a document, because the sheet closed or another file was picked. */
  function discardUploaded() {
    const stray = uploaded.current
    uploaded.current = null
    // Best effort: a stray file in the private bucket is untidy, not exposed.
    if (stray) api.request(discardDocumentUpload, { body: { storagePath: stray.storagePath } }).catch(() => undefined)
  }

  const save = useMutation<[Fields, Picked | null]>(async (fields, file) => {
    if (document) {
      await api.request(updateDocument, { params: { documentId: document.id }, body: fields })
    } else {
      if (file === null) return
      let storagePath: string
      try {
        storagePath = await uploadOnce(file.file)
      } catch (cause) {
        if (!(cause instanceof UploadError)) throw cause
        setFileError(cause.message)
        return
      }
      await api.request(createDocument, { body: { ...fields, storagePath } })
      // The document's file now, not a stray one.
      uploaded.current = null
    }
    onOpenChange(false)
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    setKind(document?.kind ?? 'other')
    setPersonId(document?.personId ?? null)
    if (!next) {
      replacePicked(null)
      discardUploaded()
      scanned.current = {}
      setFileError(null)
      save.clearError()
    }
  }

  const readScan = async (): Promise<DocumentSuggestionValue | null> => {
    if (document) return (await api.request(scanDocument, { params: { documentId: document.id } })).suggestion
    if (picked === null) return null
    const storagePath = await uploadOnce(picked.file)
    return (await api.request(scanDocumentUpload, { body: { storagePath } })).suggestion
  }

  const onScanned = (suggestion: DocumentSuggestionValue): ScanOutcome => {
    const form = formRef.current
    if (form === null) return NOTHING_FILLED
    // A kind of Other is the form's default, not a choice.
    const outcome = fillFromScan(form, suggestion, { fields: SCAN_FIELDS, replaceable: { kind: 'other', ...scanned.current } })
    scanned.current = { ...scanned.current, ...outcome.values }
    if (outcome.filled.includes('kind') && suggestion.kind !== null) setKind(suggestion.kind)
    return outcome
  }

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const chosen = input.files?.[0]
    // Cleared so choosing the same file again still counts as a change.
    input.value = ''
    if (!chosen) return
    setFileError(null)
    setPreparing(true)
    try {
      const file = await prepareDocumentFile(chosen)
      discardUploaded()
      replacePicked({ id: crypto.randomUUID(), file, previewUrl: PREVIEWABLE.has(file.mimeType) ? URL.createObjectURL(file.blob) : null })
    } catch (cause) {
      setFileError(cause instanceof UploadError ? cause.message : 'That file couldn’t be read. Try another one.')
    } finally {
      setPreparing(false)
    }
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFileError(null)
    if (!document && picked === null) {
      setFileError('Take a photo or choose a file first.')
      return
    }
    const data = new FormData(event.currentTarget)
    const kind = documentKindSchema.safeParse(formText(data, 'kind'))
    save.mutate(
      {
        title: formText(data, 'title'),
        kind: kind.success ? kind.data : 'other',
        issuedOn: formText(data, 'issuedOn') || null,
        expiresOn: formText(data, 'expiresOn') || null,
        remindFromDays: remindFromDaysOf(data),
        issuer: formText(data, 'issuer') || null,
        referenceNumber: formText(data, 'referenceNumber') || null,
        assetId: formText(data, 'assetId') || null,
        personId: formText(data, 'personId') || null,
        notes: formText(data, 'notes') || null,
        // Left as it was when the box isn't offered. Moving your own private document to someone
        // else then fails with a reason, rather than quietly showing it to the whole household.
        isSensitive: mayMarkPrivate ? data.get('isSensitive') === 'on' : (document?.isSensitive ?? false),
      },
      picked
    )
  }

  const busy = save.pending || preparing

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        document ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit details
          </Button>
        ) : (
          <Button variant={variant}>
            <Plus aria-hidden />
            Add a document
          </Button>
        )
      }
      title={document ? 'Edit details' : 'Add a document'}
      description={document ? undefined : 'A photo or a PDF, up to 20 MB.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={busy}>
            {save.pending ? (document ? 'Saving…' : 'Uploading…') : document ? 'Save changes' : 'Save document'}
          </Button>
        </>
      }
    >
      <form ref={formRef} id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        {document && isScannableMimeType(document.mimeType) ? <ScanDates read={readScan} onRead={onScanned} disabled={busy} /> : null}

        {document ? null : (
          <div className='flex flex-col gap-3'>
            {picked ? (
              <div className='flex items-center gap-3 rounded-card border border-line p-3'>
                {picked.previewUrl ? (
                  <img
                    src={picked.previewUrl}
                    alt=''
                    width={64}
                    height={64}
                    decoding='async'
                    className='size-16 shrink-0 rounded-control object-cover'
                  />
                ) : (
                  <span className='flex size-16 shrink-0 items-center justify-center rounded-control bg-paper'>
                    <FileText aria-hidden className='size-6 text-ink-muted' />
                  </span>
                )}
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{picked.file.name}</p>
                  <p className='text-sm text-ink-muted'>
                    {fileTypeLabel(picked.file.mimeType)} · {formatFileSize(picked.file.blob.size)}
                  </p>
                </div>
              </div>
            ) : null}
            {picked && isScannableMimeType(picked.file.mimeType) ? (
              <ScanDates key={picked.id} read={readScan} onRead={onScanned} disabled={busy} />
            ) : null}
            <div className='grid grid-cols-2 gap-3'>
              <FilePicker
                icon={Camera}
                label={picked ? 'Retake' : 'Take a photo'}
                accept='image/*'
                capture='environment'
                disabled={busy}
                onChange={event => {
                  void onPick(event)
                }}
              />
              <FilePicker
                icon={FileUp}
                label={picked ? 'Choose another' : 'Choose a file'}
                accept='image/*,application/pdf'
                disabled={busy}
                onChange={event => {
                  void onPick(event)
                }}
              />
            </div>
            <p role='status' className={cn('text-sm text-ink-muted', !preparing && 'sr-only')}>
              {preparing ? 'Getting the file ready…' : ''}
            </p>
            <FormError>{fileError}</FormError>
          </div>
        )}

        <Field label='Title'>
          <Input name='title' required maxLength={200} defaultValue={document?.title} placeholder='Car insurance policy' />
        </Field>

        <Field label='Kind'>
          <NativeSelect
            name='kind'
            defaultValue={document?.kind ?? 'other'}
            onChange={event => {
              const chosen = documentKindSchema.safeParse(event.currentTarget.value)
              setKind(chosen.success ? chosen.data : 'other')
            }}
          >
            {DOCUMENT_KINDS.map(kind => (
              <option key={kind} value={kind}>
                {DOCUMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <PersonField
          people={people}
          defaultValue={document?.personId ?? null}
          hint='A passport or licence belongs to someone.'
          onChange={setPersonId}
        />

        <div className='grid grid-cols-2 gap-3'>
          <DateField id={`${formId}-issued`} name='issuedOn' label='Issued' defaultValue={document?.issuedOn ?? undefined} />
          <DateField id={`${formId}-expires`} name='expiresOn' label='Expires' defaultValue={document?.expiresOn ?? undefined} />
        </div>

        <ReminderLeadField
          value={document?.remindFromDays}
          defaultLeadDays={defaultReminderLeadDays({ kind: 'document', documentKind: kind })}
          hint='When it has an expiry date. The first email goes then, and more follow as the date gets closer.'
        />

        <Field label='Reference number' hint='A policy, passport or account number.'>
          <Input name='referenceNumber' maxLength={200} defaultValue={document?.referenceNumber ?? undefined} autoComplete='off' />
        </Field>

        <Field label='Issued by'>
          <Input name='issuer' maxLength={200} defaultValue={document?.issuer ?? undefined} placeholder='State Farm' />
        </Field>

        {assets.length > 0 ? (
          <Field label='For' hint='Link a warranty or manual to the thing it covers.'>
            <NativeSelect name='assetId' defaultValue={document?.assetId ?? assetId ?? ''}>
              <option value=''>Nothing in particular</option>
              {assets.map(asset => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Notes'>
          <Textarea name='notes' rows={3} maxLength={4000} defaultValue={document?.notes ?? undefined} />
        </Field>

        {mayMarkPrivate ? (
          <CheckboxField
            name='isSensitive'
            label='Private'
            hint={personId === null ? 'Only owners and adults can see it.' : 'Only owners, adults and the person it belongs to can see it.'}
            defaultChecked={document?.isSensitive ?? false}
          />
        ) : null}

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
