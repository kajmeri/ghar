'use client'

import {
  applyQuickLog,
  deleteMaintenanceCompletion,
  parseQuickLog,
  QUICK_LOG_TEXT_MAX,
  unmarkBillPaid,
  type QuickLogApplyBody,
  type QuickLogProposal,
  type QuickLogUndo,
} from '@ghar/contracts'
import { formatCalendarDate, isCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Notice } from '@/app/(app)/_components/ui/notice'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { api, errorMessage } from '@/lib/api/client'

type State =
  | { step: 'write'; problem: string | null }
  | { step: 'confirm'; choices: QuickLogProposal[]; round: number }
  | { step: 'done'; message: string; undo: QuickLogUndo }

function choiceLabel(choice: QuickLogProposal): string {
  if (choice.action === 'bill_paid') return `${choice.billName}, due ${formatCalendarDate(choice.dueOn, 'EEE d MMM')}`
  return choice.assetName === null ? choice.taskTitle : `${choice.taskTitle} (${choice.assetName})`
}

function headline(choice: QuickLogProposal): string {
  return choice.action === 'bill_paid' ? `Mark ${choice.billName} paid` : `Log ${choice.taskTitle} as done`
}

/**
 * One sentence about something that happened, like "paid the water bill yesterday". Claude
 * suggests what to record, the person checks it, and only then is it saved, with a way to take it
 * back straight after.
 */
export function QuickLog({ today, currency }: { today: CalendarDate; currency: string }) {
  const id = useId()
  const router = useRouter()
  const [text, setText] = useState('')
  const [state, setState] = useState<State>({ step: 'write', problem: null })
  const [picked, setPicked] = useState(0)
  const [cost, setCost] = useState<number | null>(null)
  const [busy, setBusy] = useState<'reading' | 'saving' | 'undoing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, startTransition] = useTransition()

  const read = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (text.trim() === '') return
    setError(null)
    setBusy('reading')
    try {
      const result = await api.request(parseQuickLog, { body: { text } })
      const [first] = result.choices
      if (first) {
        setPicked(0)
        setCost(first.action === 'task_done' ? first.costCents : null)
        setState(current => ({ step: 'confirm', choices: result.choices, round: (current.step === 'confirm' ? current.round : 0) + 1 }))
      } else {
        setState({ step: 'write', problem: result.problem })
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const confirm = async (event: SyntheticEvent<HTMLFormElement>, choice: QuickLogProposal) => {
    event.preventDefault()
    const on = new FormData(event.currentTarget).get('on')
    if (typeof on !== 'string' || !isCalendarDate(on)) return
    const body: QuickLogApplyBody =
      choice.action === 'bill_paid'
        ? { action: 'bill_paid', billId: choice.billId, dueOn: choice.dueOn, paidOn: on }
        : { action: 'task_done', taskId: choice.taskId, completedOn: on, costCents: cost }
    setError(null)
    setBusy('saving')
    try {
      const done = await api.request(applyQuickLog, { body })
      setText('')
      setState({ step: 'done', message: done.message, undo: done.undo })
      startTransition(() => router.refresh())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const undo = async (what: QuickLogUndo) => {
    setError(null)
    setBusy('undoing')
    try {
      if (what.action === 'bill_paid') await api.request(unmarkBillPaid, { params: { billId: what.billId, dueOn: what.dueOn } })
      else await api.request(deleteMaintenanceCompletion, { params: { taskId: what.taskId, entryId: what.entryId } })
      setState({ step: 'write', problem: 'Taken back. Nothing was left recorded.' })
      startTransition(() => router.refresh())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const startOver = () => {
    setError(null)
    setState({ step: 'write', problem: null })
  }

  if (state.step === 'done') {
    return (
      <div className='flex flex-col gap-2'>
        <Notice
          tone='positive'
          role='status'
          action={
            <div className='flex gap-2'>
              <Button type='button' variant='outline' disabled={busy !== null || refreshing} onClick={() => void undo(state.undo)}>
                {busy === 'undoing' ? 'Taking back…' : 'Undo'}
              </Button>
              <Button type='button' variant='ghost' disabled={busy !== null} onClick={startOver}>
                Log another
              </Button>
            </div>
          }
        >
          {state.message}
        </Notice>
        <FormError>{error}</FormError>
      </div>
    )
  }

  if (state.step === 'confirm') {
    const choice = state.choices[picked] ?? state.choices[0]
    if (!choice) return null
    const isBill = choice.action === 'bill_paid'
    return (
      <form
        // Fresh defaults for every new suggestion and every choice.
        key={`${String(state.round)}-${String(picked)}`}
        aria-labelledby={`${id}-headline`}
        onSubmit={event => void confirm(event, choice)}
        className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'
      >
        <div className='flex flex-col gap-1'>
          <p className='text-sm text-ink-muted'>“{text.trim()}”</p>
          <h2 id={`${id}-headline`} className='text-lg font-semibold break-words'>
            {headline(choice)}
          </h2>
          {isBill ? (
            <p className='text-sm text-ink-muted'>For the bill due {formatCalendarDate(choice.dueOn, 'EEE d MMM yyyy')}</p>
          ) : choice.assetName === null ? null : (
            <p className='text-sm text-ink-muted'>{choice.assetName}</p>
          )}
        </div>

        {state.choices.length > 1 ? (
          <fieldset className='flex flex-col gap-1'>
            <legend className='mb-1 text-sm font-medium'>Which one did you mean?</legend>
            {state.choices.map((option, index) => (
              <label key={option.action === 'bill_paid' ? option.billId : option.taskId} className='flex min-h-tap items-center gap-3'>
                <input
                  type='radio'
                  name='choice'
                  className='size-5 accent-ink'
                  checked={index === picked}
                  onChange={() => {
                    setPicked(index)
                    setCost(option.action === 'task_done' ? option.costCents : null)
                  }}
                />
                <span className='min-w-0 break-words'>{choiceLabel(option)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className='grid gap-3 md:grid-cols-2'>
          <DateField
            id={`${id}-on`}
            name='on'
            label={isBill ? 'Paid on' : 'Done on'}
            defaultValue={isBill ? choice.paidOn : choice.completedOn}
            max={today}
            required
          />
          {isBill ? null : (
            <MoneyInput
              id={`${id}-cost`}
              name='costCents'
              label='Cost'
              hint='Optional'
              currency={currency}
              defaultValue={choice.costCents ?? undefined}
              onValueChange={setCost}
            />
          )}
        </div>

        <FormError>{error}</FormError>
        <div className='flex flex-col-reverse gap-2 md:flex-row md:justify-end'>
          <Button type='button' variant='outline' disabled={busy !== null} onClick={startOver}>
            Cancel
          </Button>
          <Button type='submit' disabled={busy !== null}>
            {busy === 'saving' ? 'Saving…' : isBill ? 'Mark paid' : 'Log it'}
          </Button>
        </div>
      </form>
    )
  }

  const reading = busy === 'reading'
  return (
    <form onSubmit={event => void read(event)} className='flex flex-col gap-2'>
      <div className='flex items-end gap-2'>
        <Field id={`${id}-text`} label='Log something' className='min-w-0 flex-1'>
          <Input
            id={`${id}-text`}
            value={text}
            maxLength={QUICK_LOG_TEXT_MAX}
            placeholder='Paid the water bill yesterday'
            autoComplete='off'
            enterKeyHint='go'
            disabled={reading}
            aria-describedby={`${id}-status`}
            onChange={change => {
              setText(change.target.value)
            }}
          />
        </Field>
        <Button type='submit' disabled={reading || text.trim() === ''}>
          {reading ? 'Reading…' : 'Next'}
        </Button>
      </div>
      <p id={`${id}-status`} role='status' className='text-sm text-ink-muted'>
        {reading
          ? 'Claude is reading it…'
          : (state.problem ?? 'Say what you paid or did around the house. You check it before anything is saved.')}
      </p>
      <FormError>{error}</FormError>
    </form>
  )
}
