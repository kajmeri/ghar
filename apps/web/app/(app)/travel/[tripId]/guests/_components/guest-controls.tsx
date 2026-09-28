'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { approveGuestAction, createLinkAction, removeGuestAction, setLinkApprovalAction } from '../actions'

interface GuestControlsProps {
  tripId: string
  guestId: string
  who: string
  waiting: boolean
  /**
   * They came through the link, and the link still lets people straight in, so taking them off
   * wouldn't keep them off: they could answer again and be back.
   */
  canComeBack: boolean
}

/**
 * Let in someone waiting, or take someone off. Turning down a request is the same as removing.
 * Taking someone off asks first, since it can't be undone from here.
 */
export function GuestControls({ tripId, guestId, who, waiting, canComeBack }: GuestControlsProps) {
  const [approveState, approveAction, approving] = useActionState(approveGuestAction, IDLE)
  const [removeState, removeAction, removing] = useActionState(removeGuestAction, IDLE)
  const [linkApprovalState, linkApprovalAction, savingLink] = useActionState(setLinkApprovalAction, IDLE)
  const [newLinkState, newLinkAction, makingLink] = useActionState(createLinkAction, IDLE)
  const [confirming, setConfirming] = useState(false)
  const message =
    [removeState, approveState, linkApprovalState, newLinkState].find(state => state.status === 'error') ??
    [linkApprovalState, newLinkState].find(state => state.status === 'success') ??
    IDLE

  const keepRef = useRef<HTMLButtonElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)
  const consequenceId = useId()
  const wasConfirming = useRef(confirming)
  useEffect(() => {
    if (wasConfirming.current === confirming) return
    wasConfirming.current = confirming
    if (confirming) keepRef.current?.focus()
    else removeRef.current?.focus()
  }, [confirming])

  if (confirming) {
    return (
      <div className='flex flex-col gap-3 rounded-control border border-line bg-paper p-3 md:max-w-sm'>
        <p id={consequenceId} className='text-sm'>
          {waiting ? `Turn down ${who}?` : `Take ${who} off the trip?`}{' '}
          {canComeBack
            ? 'The link lets people straight in, so they could answer through it again and be back on the trip.'
            : 'They’d need to be asked again to come back.'}
        </p>
        <div className='flex flex-col gap-2 md:flex-row'>
          <form action={removeAction}>
            <input type='hidden' name='tripId' value={tripId} />
            <input type='hidden' name='guestId' value={guestId} />
            <Button type='submit' variant='destructive' aria-describedby={consequenceId} disabled={removing} className='w-full'>
              {removing ? 'Removing…' : waiting ? 'Turn down' : 'Take them off'}
            </Button>
          </form>
          <Button
            ref={keepRef}
            type='button'
            variant='ghost'
            aria-describedby={consequenceId}
            onClick={() => {
              setConfirming(false)
            }}
          >
            Keep them
          </Button>
        </div>
        {canComeBack ? (
          <div className='flex flex-col gap-2 border-t border-line pt-3'>
            <p className='text-sm text-ink-muted'>
              To keep them off, let people in yourself, or make a new link so the old one stops working.
            </p>
            <div className='flex flex-col gap-2 md:flex-row'>
              <form action={linkApprovalAction}>
                <input type='hidden' name='tripId' value={tripId} />
                <input type='hidden' name='requiresApproval' value='true' />
                <Button type='submit' variant='outline' disabled={savingLink} className='w-full'>
                  {savingLink ? 'Saving…' : 'Let people in myself'}
                </Button>
              </form>
              <form action={newLinkAction}>
                <input type='hidden' name='tripId' value={tripId} />
                <Button type='submit' variant='outline' disabled={makingLink} className='w-full'>
                  {makingLink ? 'Making a new link…' : 'Make a new link'}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
        <FormMessage state={message} />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 md:items-end'>
      <div className='flex gap-2'>
        {waiting ? (
          <form action={approveAction} className='flex-1 md:flex-none'>
            <input type='hidden' name='tripId' value={tripId} />
            <input type='hidden' name='guestId' value={guestId} />
            <Button type='submit' disabled={approving} className='w-full'>
              {approving ? 'Letting in…' : 'Let in'}
              <span className='sr-only'> {who}</span>
            </Button>
          </form>
        ) : null}
        <Button
          ref={removeRef}
          type='button'
          variant='outline'
          disabled={approving}
          onClick={() => {
            setConfirming(true)
          }}
          className='flex-1 md:flex-none'
        >
          {waiting ? 'Turn down' : 'Remove'}
          <span className='sr-only'> {who}</span>
        </Button>
      </div>
      <FormMessage state={message} />
    </div>
  )
}
