'use client'

import {
  clearNotRenewing,
  discardDocumentUpload,
  markNotRenewing,
  renewExpiry,
  scanDocumentUpload,
  type DocumentSuggestionValue,
  type Expiry,
} from '@ghar/contracts'
import { addCalendarDays, formatCalendarDate } from '@ghar/core/dates'
import { isScannableMimeType } from '@ghar/core/document-scan'
import { BellOff, BellRing, FileText, FileUp, RotateCw } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { FilePicker } from '@/app/(app)/documents/_components/file-picker'
import { ScanDates } from '@/app/(app)/documents/_components/scan-dates'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { fileTypeLabel, formatFileSize } from '@/lib/documents/display'
import { fillFromScan, NOTHING_FILLED, type ScanField, type ScanOutcome } from '@/lib/documents/scan-form'
import { prepareDocumentFile, uploadDocumentFile, UploadError, type PreparedFile } from '@/lib/documents/upload'
import { formText } from '@/lib/form'
import { expiryLabel } from '@/lib/renewals/display'
import { cn } from '@/lib/utils'

// What someone can do about a thing that runs out: renew it, which moves its date on, or say it
// won't be, which stops the reminders for that date. Shown on a document, a thing in the house with
// a warranty, and a renewal.

function paramsOf(expiry: Expiry) {
  switch (expiry.kind) {
    case 'document':
      return { kind: expiry.kind, subjectId: expiry.documentId }
    case 'warranty':
      return { kind: expiry.kind, subjectId: expiry.assetId }
    case 'renewal':
      return { kind: expiry.kind, subjectId: expiry.renewalId }
  }
}

export function ExpiryActions({ expiry }: { expiry: Expiry }) {
  const params = paramsOf(expiry)
  const toggle = useMutation<[]>(async () => {
    if (expiry.notRenewing) {
      await api.request(clearNotRenewing, { params })
    } else {
      await api.request(markNotRenewing, { params, body: { expiresOn: expiry.expiresOn } })
    }
  })

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-2'>
        <RenewSheet expiry={expiry} />
        <Button
          variant='outline'
          disabled={toggle.pending}
          onClick={() => {
            toggle.mutate()
          }}
        >
          {expiry.notRenewing ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
          {toggle.pending ? 'Saving…' : expiry.notRenewing ? 'Remind me again' : expiry.kind === 'warranty' ? 'Not extending' : 'Not renewing'}
        </Button>
      </div>
      <FormError>{toggle.error}</FormError>
    </div>
  )
}

/** Only a document has an issue date and a file to replace. */
function RenewSheet({ expiry }: { expiry: Expiry }) {
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<PreparedFile | null>(null)
  // A new one for each file picked, so a scan of the last one doesn't linger.
  const [pickCount, setPickCount] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  // A retry after the date failed to save, or a save after a scan, reuses the file that already uploaded.
  const uploaded = useRef<{ file: PreparedFile; storagePath: string } | null>(null)
  // What the last scan put in the form, which the next scan may replace.
  const scanned = useRef<Partial<Record<ScanField, string>>>({})
  const params = paramsOf(expiry)

  async function uploadOnce(file: PreparedFile): Promise<string> {
    if (uploaded.current?.file === file) return uploaded.current.storagePath
    const storagePath = await uploadDocumentFile(file)
    uploaded.current = { file, storagePath }
    return storagePath
  }

  /** An upload that won't be the new file, because the sheet closed or another file was picked. */
  function discardUploaded() {
    const stray = uploaded.current
    uploaded.current = null
    // Best effort: a stray file in the private bucket is untidy, not exposed.
    if (stray) api.request(discardDocumentUpload, { body: { storagePath: stray.storagePath } }).catch(() => undefined)
  }

  const save = useMutation<[{ expiresOn: string; issuedOn?: string | null }, PreparedFile | null]>(async (dates, file) => {
    let storagePath: string | undefined
    if (file !== null) {
      try {
        storagePath = await uploadOnce(file)
      } catch (cause) {
        if (!(cause instanceof UploadError)) throw cause
        setFileError(cause.message)
        return
      }
    }
    await api.request(renewExpiry, { params, body: { ...dates, storagePath } })
    uploaded.current = null
    scanned.current = {}
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      save.clearError()
      setPicked(null)
      discardUploaded()
      scanned.current = {}
      setFileError(null)
    }
  }

  const readScan = async (): Promise<DocumentSuggestionValue | null> => {
    if (picked === null) return null
    const storagePath = await uploadOnce(picked)
    return (await api.request(scanDocumentUpload, { body: { storagePath } })).suggestion
  }

  const onScanned = (suggestion: DocumentSuggestionValue): ScanOutcome => {
    const form = formRef.current
    if (form === null) return NOTHING_FILLED
    // A scan of the one being replaced has nothing new to say.
    if (suggestion.expiresOn !== null && suggestion.expiresOn <= expiry.expiresOn) {
      return {
        ...NOTHING_FILLED,
        notes: [`That one runs out ${formatCalendarDate(suggestion.expiresOn)}, which isn’t after the date Ghar has now. Is it the old one?`],
      }
    }
    // The date one term on is Ghar's guess, which the paper beats.
    const outcome = fillFromScan(form, suggestion, {
      fields: ['expiresOn', 'issuedOn'],
      replaceable: { expiresOn: expiry.suggestedRenewalOn ?? undefined, ...scanned.current },
    })
    scanned.current = { ...scanned.current, ...outcome.values }
    return outcome
  }

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    setFileError(null)
    setPreparing(true)
    try {
      const file = await prepareDocumentFile(chosen)
      discardUploaded()
      setPicked(file)
      setPickCount(count => count + 1)
    } catch (cause) {
      setFileError(cause instanceof UploadError ? cause.message : 'That file couldn’t be read. Try another one.')
    } finally {
      setPreparing(false)
    }
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFileError(null)
    const data = new FormData(event.currentTarget)
    const expiresOn = formText(data, 'expiresOn')
    save.mutate(expiry.kind === 'document' ? { expiresOn, issuedOn: formText(data, 'issuedOn') || null } : { expiresOn }, picked)
  }

  const busy = save.pending || preparing
  const isWarranty = expiry.kind === 'warranty'

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='outline'>
          <RotateCw aria-hidden />
          {isWarranty ? 'Extend' : 'Renew'}
        </Button>
      }
      title={isWarranty ? `Extend the ${expiryLabel(expiry)}` : `Renew ${expiryLabel(expiry)}`}
      description={`${isWarranty ? 'It ends' : 'It runs out'} ${formatCalendarDate(expiry.expiresOn)} now. Reminders start over for the new date.`}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={busy}>
            {save.pending ? 'Saving…' : 'Save new date'}
          </Button>
        </>
      }
    >
      <form ref={formRef} id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <DateField
          id={`${formId}-expires`}
          name='expiresOn'
          label={isWarranty ? 'Now ends on' : 'Now runs out on'}
          hint={expiry.suggestedRenewalOn ? 'One term on from the date it has now. Change it if the new one is different.' : undefined}
          required
          min={addCalendarDays(expiry.expiresOn, 1)}
          defaultValue={expiry.suggestedRenewalOn ?? undefined}
        />

        {expiry.kind === 'document' ? (
          <DateField
            id={`${formId}-issued`}
            name='issuedOn'
            label='New one issued on'
            hint='Leave it blank if you don’t know. The old issue date goes, since it was for the old one.'
          />
        ) : null}

        {expiry.kind === 'document' ? (
          <div className='flex flex-col gap-3'>
            <div>
              <p className='font-medium'>The new one</p>
              <p className='text-sm text-ink-muted'>A photo or PDF of it replaces the file Ghar has now. Leave it out to keep the old file.</p>
            </div>
            {picked ? (
              <div className='flex items-center gap-3 rounded-card border border-line p-3'>
                <span className='flex size-12 shrink-0 items-center justify-center rounded-control bg-paper'>
                  <FileText aria-hidden className='size-5 text-ink-muted' />
                </span>
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{picked.name}</p>
                  <p className='text-sm text-ink-muted'>
                    {fileTypeLabel(picked.mimeType)} · {formatFileSize(picked.blob.size)}
                  </p>
                </div>
              </div>
            ) : null}
            {picked && isScannableMimeType(picked.mimeType) ? (
              <ScanDates key={pickCount} read={readScan} onRead={onScanned} disabled={busy} />
            ) : null}
            <FilePicker
              icon={FileUp}
              label={picked ? 'Choose another' : 'Add the new file'}
              accept='image/*,application/pdf'
              disabled={busy}
              onChange={event => {
                void onPick(event)
              }}
            />
            <p role='status' className={cn('text-sm text-ink-muted', !preparing && 'sr-only')}>
              {preparing ? 'Getting the file ready…' : ''}
            </p>
            <FormError>{fileError}</FormError>
          </div>
        ) : null}

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
