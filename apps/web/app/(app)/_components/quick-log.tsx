'use client'

import {
  applyQuickLog,
  deleteHealthEvent,
  deleteMaintenanceCompletion,
  HEALTH_TITLE_MAX,
  healthEventKindSchema,
  parseQuickLog,
  QUICK_LOG_TEXT_MAX,
  undoHealthMedicineRefill,
  unmarkBillPaid,
  type QuickLogApplyBody,
  type QuickLogProposal,
  type QuickLogUndo,
} from '@ghar/contracts'
import { formatCalendarDate, isCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { HEALTH_EVENT_KINDS, HEALTH_KIND_LABELS, type HealthEventKind } from '@ghar/core/health'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Notice } from '@/app/(app)/_components/ui/notice'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { FormError } from '@/components/ui/form-error'
import { api, errorMessage } from '@/lib/api/client'

type State =
  | { step: 'write'; problem: string | null }
  | { step: 'confirm'; choices: QuickLogProposal[]; round: number }
  | { step: 'done'; message: string; undo: QuickLogUndo }

/** "you" mid-sentence, or their name. */
function whom(personName: string): string {
  return personName === 'You' ? 'you' : personName
}

function choiceKey(choice: QuickLogProposal): string {
  switch (choice.action) {
    case 'bill_paid':
      return choice.billId
    case 'task_done':
      return choice.taskId
    case 'health_event':
      return choice.personId
    case 'medicine_refilled':
      return choice.medicineId
  }
}

function choiceLabel(choice: QuickLogProposal): string {
  switch (choice.action) {
    case 'bill_paid':
      return `${choice.billName}, due ${formatCalendarDate(choice.dueOn, 'EEE d MMM')}`
    case 'task_done':
      return choice.assetName === null ? choice.taskTitle : `${choice.taskTitle} (${choice.assetName})`
    case 'health_event':
      return choice.personName
    case 'medicine_refilled':
      return choice.personName === 'You' ? `${choice.medicineName} (yours)` : `${choice.medicineName} (${choice.personName})`
  }
}

/** What a health record will be called, as the card has it now. */
interface EventEdits {
  kind: HealthEventKind
  title: string
}

function eventName(edits: EventEdits): string {
  return edits.title.trim() === '' ? HEALTH_KIND_LABELS[edits.kind] : edits.title.trim()
}

function headline(choice: QuickLogProposal, edits: EventEdits): string {
  switch (choice.action) {
    case 'bill_paid':
      return `Mark ${choice.billName} paid`
    case 'task_done':
      return `Log ${choice.taskTitle} as done`
    case 'health_event':
      return `Add ${eventName(edits)} for ${whom(choice.personName)}`
    case 'medicine_refilled':
      return `Mark ${choice.medicineName} refilled`
  }
}

/** The line under the headline, when there's more to say. */
function detail(choice: QuickLogProposal): string | null {
  switch (choice.action) {
    case 'bill_paid':
      return `For the bill due ${formatCalendarDate(choice.dueOn, 'EEE d MMM yyyy')}`
    case 'task_done':
      return choice.assetName
    case 'health_event':
      return 'It goes on their health record.'
    case 'medicine_refilled':
      return choice.personName === 'You' ? null : `${choice.personName}’s medicine`
  }
}

const DATE_LABELS: Record<QuickLogProposal['action'], string> = {
  bill_paid: 'Paid on',
  task_done: 'Done on',
  health_event: 'When',
  medicine_refilled: 'Refilled on',
}

const SUBMIT_LABELS: Record<QuickLogProposal['action'], string> = {
  bill_paid: 'Mark paid',
  task_done: 'Log it',
  health_event: 'Add it',
  medicine_refilled: 'Mark refilled',
}

function proposedDate(choice: QuickLogProposal): CalendarDate {
  switch (choice.action) {
    case 'bill_paid':
      return choice.paidOn
    case 'task_done':
      return choice.completedOn
    case 'health_event':
      return choice.occurredOn
    case 'medicine_refilled':
      return choice.refilledOn
  }
}

function applyBody(choice: QuickLogProposal, edits: EventEdits, on: CalendarDate, cost: number | null): QuickLogApplyBody {
  switch (choice.action) {
    case 'bill_paid':
      return { action: 'bill_paid', billId: choice.billId, dueOn: choice.dueOn, paidOn: on }
    case 'task_done':
      return { action: 'task_done', taskId: choice.taskId, completedOn: on, costCents: cost }
    case 'health_event':
      return {
        action: 'health_event',
        personId: choice.personId,
        kind: edits.kind,
        title: edits.title.trim() === '' ? null : edits.title.trim(),
        occurredOn: on,
      }
    case 'medicine_refilled':
      return { action: 'medicine_refilled', medicineId: choice.medicineId, refilledOn: on }
  }
}

async function undoRequest(what: QuickLogUndo): Promise<void> {
  switch (what.action) {
    case 'bill_paid':
      await api.request(unmarkBillPaid, { params: { billId: what.billId, dueOn: what.dueOn } })
      return
    case 'task_done':
      await api.request(deleteMaintenanceCompletion, { params: { taskId: what.taskId, entryId: what.entryId } })
      return
    case 'health_event':
      await api.request(deleteHealthEvent, { params: { eventId: what.eventId } })
      return
    case 'medicine_refilled':
      await api.request(undoHealthMedicineRefill, {
        params: { medicineId: what.medicineId },
        body: {
          refilledOn: what.refilledOn,
          previousRefillBy: what.previousRefillBy,
          previousLastRefilledOn: what.previousLastRefilledOn,
        },
      })
  }
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
  const [edits, setEdits] = useState<EventEdits>({ kind: 'visit', title: '' })
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
        pick(first, 0)
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

  /** Fresh cost and kind for each choice, as suggested. */
  function pick(choice: QuickLogProposal, index: number) {
    setPicked(index)
    setCost(choice.action === 'task_done' ? choice.costCents : null)
    if (choice.action === 'health_event') setEdits({ kind: choice.kind, title: choice.title ?? '' })
  }

  const confirm = async (event: SyntheticEvent<HTMLFormElement>, choice: QuickLogProposal) => {
    event.preventDefault()
    const on = new FormData(event.currentTarget).get('on')
    if (typeof on !== 'string' || !isCalendarDate(on)) return
    const body = applyBody(choice, edits, on, cost)
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
      await undoRequest(what)
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
    const below = detail(choice)
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
            {headline(choice, edits)}
          </h2>
          {below === null ? null : <p className='text-sm text-ink-muted'>{below}</p>}
        </div>

        {state.choices.length > 1 ? (
          <fieldset className='flex flex-col gap-1'>
            <legend className='mb-1 text-sm font-medium'>
              {choice.action === 'health_event' ? 'Who was it for?' : 'Which one did you mean?'}
            </legend>
            {state.choices.map((option, index) => (
              <label key={choiceKey(option)} className='flex min-h-tap items-center gap-3'>
                <input
                  type='radio'
                  name='choice'
                  className='size-5 accent-ink'
                  checked={index === picked}
                  onChange={() => {
                    pick(option, index)
                  }}
                />
                <span className='min-w-0 break-words'>{choiceLabel(option)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {choice.action === 'health_event' ? (
          <div className='grid gap-3 md:grid-cols-2'>
            <Field id={`${id}-kind`} label='What it was'>
              <NativeSelect
                id={`${id}-kind`}
                name='kind'
                value={edits.kind}
                onChange={change => {
                  const next = healthEventKindSchema.safeParse(change.target.value)
                  if (next.success) setEdits(current => ({ ...current, kind: next.data }))
                }}
              >
                {HEALTH_EVENT_KINDS.map(option => (
                  <option key={option} value={option}>
                    {HEALTH_KIND_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`${id}-title`} label='Name' hint={`Leave it empty to call it “${HEALTH_KIND_LABELS[edits.kind]}”.`}>
              <Input
                id={`${id}-title`}
                name='title'
                maxLength={HEALTH_TITLE_MAX}
                value={edits.title}
                onChange={change => {
                  setEdits(current => ({ ...current, title: change.target.value }))
                }}
              />
            </Field>
          </div>
        ) : null}

        <div className='grid gap-3 md:grid-cols-2'>
          <DateField
            id={`${id}-on`}
            name='on'
            label={DATE_LABELS[choice.action]}
            defaultValue={proposedDate(choice)}
            max={today}
            required
          />
          {choice.action !== 'task_done' ? null : (
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
            {busy === 'saving' ? 'Saving…' : SUBMIT_LABELS[choice.action]}
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
          : (state.problem ??
            'Say what you paid, did around the house, or a visit, shot or refill. You check it before anything is saved.')}
      </p>
      <FormError>{error}</FormError>
    </form>
  )
}
