'use client'

import { AlertDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

const ACTIONS = 'mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end'

/**
 * Asks before something that can't be taken back. Focus starts on Cancel.
 *
 * Give it a `formAction` (from useActionState) and it submits a form with `fields` as hidden
 * inputs, staying open while `pending` so an `error` can show. Give it `onConfirm` instead for a
 * client-side action; the dialog closes as it runs.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  formAction,
  fields = {},
  pending = false,
  error,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode
  title: string
  description: string
  confirmLabel: string
  pendingLabel?: string
  cancelLabel?: string
  /** destructive only when the action deletes or removes something. */
  tone?: 'default' | 'destructive'
  onConfirm?: () => void
  formAction?: (formData: FormData) => void
  fields?: Record<string, string>
  pending?: boolean
  error?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const variant = tone === 'destructive' ? 'destructive' : 'default'
  const confirmText = pending && pendingLabel ? pendingLabel : confirmLabel
  const cancel = (
    <AlertDialog.Cancel asChild>
      <Button type='button' variant='outline'>
        {cancelLabel}
      </Button>
    </AlertDialog.Cancel>
  )

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className='fixed inset-0 z-50 bg-ink/30 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in' />
        <AlertDialog.Content className='fixed inset-x-4 bottom-[max(--spacing(4),env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-card border border-line bg-surface p-6 shadow-overlay focus:outline-hidden motion-safe:data-[state=closed]:animate-lift-out motion-safe:data-[state=open]:animate-lift-in md:top-1/2 md:bottom-auto md:-translate-y-1/2'>
          <AlertDialog.Title className='text-lg font-semibold break-words'>{title}</AlertDialog.Title>
          <AlertDialog.Description className='mt-2 text-base text-ink-muted'>{description}</AlertDialog.Description>
          {formAction ? (
            <form action={formAction} className={ACTIONS}>
              {Object.entries(fields).map(([name, value]) => (
                <input key={name} type='hidden' name={name} value={value} />
              ))}
              {cancel}
              <Button type='submit' variant={variant} disabled={pending}>
                {confirmText}
              </Button>
            </form>
          ) : (
            <div className={ACTIONS}>
              {cancel}
              <AlertDialog.Action asChild>
                <Button type='button' variant={variant} disabled={pending} onClick={onConfirm}>
                  {confirmText}
                </Button>
              </AlertDialog.Action>
            </div>
          )}
          {error ? <div className='mt-3'>{error}</div> : null}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
