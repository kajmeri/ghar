'use client'

import { ApiClientError, type DocumentSuggestionValue } from '@ghar/contracts'
import { ScanText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { UploadError } from '@/lib/documents/upload'
import { NOTHING_FILLED, scanReport, type ScanOutcome, type ScanReport } from '@/lib/documents/scan-form'

function problemOf(cause: unknown): string {
  if (cause instanceof UploadError) return cause.message
  if (cause instanceof ApiClientError) {
    return cause.code === 'network_error' ? 'No connection. Ghar couldn’t read the file.' : cause.message
  }
  return 'Something went wrong. Fill in the dates yourself.'
}

/**
 * Asks Claude to read the dates off a file and puts them in the form for the person to check. It
 * saves nothing, and never reads an ID number. Give it a new key for a new file.
 */
export function ScanDates({
  read,
  onRead,
  disabled = false,
}: {
  /** Uploads the file if it has to, then has the server read it. Null when it couldn't. */
  read: () => Promise<DocumentSuggestionValue | null>
  /** Fills the form in, and says what it did. */
  onRead: (suggestion: DocumentSuggestionValue) => ScanOutcome
  disabled?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [report, setReport] = useState<ScanReport | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const scan = async () => {
    setPending(true)
    setProblem(null)
    setReport(null)
    try {
      const suggestion = await read()
      setReport(scanReport(suggestion, suggestion === null ? NOTHING_FILLED : onRead(suggestion)))
    } catch (cause) {
      setProblem(problemOf(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={disabled || pending}
        onClick={() => {
          void scan()
        }}
      >
        <ScanText aria-hidden />
        {pending ? 'Reading the file…' : 'Read the dates'}
      </Button>
      <div role='status' className='flex flex-col gap-2 text-sm'>
        {report === null ? (
          <p className='text-ink-muted'>{pending ? 'Claude is reading it.' : 'Claude reads the file for its dates. It never reads ID numbers.'}</p>
        ) : (
          <>
            {report.message ? <p className='text-ink-muted'>{report.message}</p> : null}
            {report.warnings.map(warning => (
              <p key={warning} className='flex items-start gap-2'>
                <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
                {warning}
              </p>
            ))}
          </>
        )}
      </div>
      <FormError>{problem}</FormError>
    </div>
  )
}
