'use client'

import { createDocument, documentKindSchema, updateDocument, type HouseholdDocument } from '@ghar/contracts'
import { DOCUMENT_KINDS } from '@ghar/core/documents'
import { Camera, FileText, FileUp, Pencil, Plus, type LucideIcon } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { DOCUMENT_KIND_LABELS, fileTypeLabel, formatFileSize } from '@/lib/documents/display'
import { prepareDocumentFile, uploadDocumentFile, UploadError, type PreparedFile } from '@/lib/documents/upload'
import { formText } from '@/lib/form'
import { cn } from '@/lib/utils'

export interface AssetOption {
  id: string
  name: string
}

type Fields = NonNullable<BodyOf<typeof updateDocument>>

interface Picked {
  file: PreparedFile
  previewUrl: string | null
}

/** Types every browser can draw in an img. HEIC outside Safari shows its name instead. */
const PREVIEWABLE = new Set<string>(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Adds a document, or edits one's details. Adding starts with the camera, because the paper is
 * usually in someone's hand: a photo, a title, save. Everything else is optional.
 */
export function DocumentSheet({
  document,
  assets,
  canMarkSensitive,
  assetId,
  variant = 'default',
}: {
  /** Edits this document. Leave it out to add one. */
  document?: HouseholdDocument
  assets: AssetOption[]
  /** Owners and adults. Anyone else can't see a private document, so can't make one. */
  canMarkSensitive: boolean
  /** Links a new document to this asset to start with. */
  assetId?: string
  /** The add button's look. Outline where it isn't the page's main action. */
  variant?: 'default' | 'outline'
}) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  // A retry after the details failed to save reuses the file that already uploaded.
  const uploaded = useRef<{ file: PreparedFile; storagePath: string } | null>(null)

  const replacePicked = (next: Picked | null) => {
    if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl)
    setPicked(next)
  }

  const save = useMutation<[Fields, Picked | null]>(async (fields, file) => {
    if (document) {
      await api.request(updateDocument, { params: { documentId: document.id }, body: fields })
    } else {
      if (file === null) return
      let storagePath: string
      if (uploaded.current?.file === file.file) {
        storagePath = uploaded.current.storagePath
      } else {
        try {
          storagePath = await uploadDocumentFile(file.file)
        } catch (cause) {
          if (!(cause instanceof UploadError)) throw cause
          setFileError(cause.message)
          return
        }
        uploaded.current = { file: file.file, storagePath }
      }
      await api.request(createDocument, { body: { ...fields, storagePath } })
    }
    onOpenChange(false)
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      replacePicked(null)
      uploaded.current = null
      setFileError(null)
      save.clearError()
    }
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
      replacePicked({ file, previewUrl: PREVIEWABLE.has(file.mimeType) ? URL.createObjectURL(file.blob) : null })
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
        issuer: formText(data, 'issuer') || null,
        referenceNumber: formText(data, 'referenceNumber') || null,
        assetId: formText(data, 'assetId') || null,
        notes: formText(data, 'notes') || null,
        isSensitive: canMarkSensitive ? data.get('isSensitive') === 'on' : (document?.isSensitive ?? false),
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
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        {document ? null : (
          <div className='flex flex-col gap-3'>
            {picked ? (
              <div className='flex items-center gap-3 rounded-card border border-line p-3'>
                {picked.previewUrl ? (
                  <img src={picked.previewUrl} alt='' className='size-16 shrink-0 rounded-control object-cover' />
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
          <NativeSelect name='kind' defaultValue={document?.kind ?? 'other'}>
            {DOCUMENT_KINDS.map(kind => (
              <option key={kind} value={kind}>
                {DOCUMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          <DateField id={`${formId}-issued`} name='issuedOn' label='Issued' defaultValue={document?.issuedOn ?? undefined} />
          <DateField
            id={`${formId}-expires`}
            name='expiresOn'
            label='Expires'
            defaultValue={document?.expiresOn ?? undefined}
          />
        </div>

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

        {canMarkSensitive ? (
          <CheckboxField
            name='isSensitive'
            label='Private'
            hint='Only owners and adults can see it.'
            defaultChecked={document?.isSensitive ?? false}
          />
        ) : null}

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}

/** A button that opens the file picker, or the camera on a phone. The input inside keeps it keyboard reachable. */
function FilePicker({
  icon: Icon,
  label,
  accept,
  capture,
  disabled,
  onChange,
}: {
  icon: LucideIcon
  label: string
  accept: string
  capture?: 'environment'
  disabled: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label
      className={cn(
        buttonVariants({ variant: 'outline' }),
        'cursor-pointer px-3 focus-within:ring-[3px] focus-within:ring-ring/50',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <Icon aria-hidden />
      {label}
      <input type='file' accept={accept} capture={capture} disabled={disabled} onChange={onChange} className='sr-only' />
    </label>
  )
}
