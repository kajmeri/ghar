'use client'

import {
  applyQuickLog,
  clearNotRenewing,
  deleteHealthEvent,
  deleteMaintenanceCompletion,
  deleteTransaction,
  HEALTH_TITLE_MAX,
  healthEventKindSchema,
  parseQuickLog,
  QUICK_LOG_DESCRIPTION_MAX,
  QUICK_LOG_TEXT_MAX,
  undoHealthMedicineRefill,
  undoRenewExpiry,
  unmarkBillPaid,
  type QuickLogApplyBody,
  type QuickLogEntry,
  type QuickLogProposal,
  type QuickLogUndo,
} from '@ghar/contracts'
import { addCalendarDays, formatCalendarDate, isCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { HEALTH_EVENT_KINDS, HEALTH_KIND_LABELS, type HealthEventKind } from '@ghar/core/health'
import { formatCents } from '@ghar/core/money'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { FormError } from '@/components/ui/form-error'
import { api, errorMessage } from '@/lib/api/client'

/** Something recorded, and what takes it back. */
interface Logged {
  message: string
  undo: QuickLogUndo
  undone: boolean
}

/** Something the sentence mentioned that can't be logged, and why. */
interface Skipped {
  said: string | null
  problem: string
}

interface Confirming {
  step: 'confirm'
  /** The things to confirm, one at a time, each with at least one choice. */
  entries: QuickLogEntry[]
  at: number
  skipped: Skipped[]
  logged: Logged[]
  /** Counts every card shown, so each starts with fresh defaults. */
  round: number
}

type State = { step: 'write'; problem: string | null } | Confirming | { step: 'done'; logged: Logged[]; skipped: Skipped[] }

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
    case 'cash_spent':
      return 'cash'
    case 'renewed':
    case 'not_renewing':
      return `${choice.kind}:${choice.subjectId}`
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
    case 'cash_spent':
      return choice.description
    case 'renewed':
    case 'not_renewing':
      return `${choice.name}, runs out ${formatCalendarDate(choice.action === 'renewed' ? choice.currentExpiresOn : choice.expiresOn, 'd MMM yyyy')}`
  }
}

/** What the card has changed from the suggestion: a health record's kind and name, or a cash spend's. */
interface Edits {
  kind: HealthEventKind
  title: string
  description: string
  /** Empty for none. */
  categoryId: string
  /** The cost of a house job, or the amount of a cash spend. */
  cents: number | null
}

const NO_EDITS: Edits = { kind: 'visit', title: '', description: '', categoryId: '', cents: null }

function editsFor(choice: QuickLogProposal): Edits {
  switch (choice.action) {
    case 'health_event':
      return { ...NO_EDITS, kind: choice.kind, title: choice.title ?? '' }
    case 'task_done':
      return { ...NO_EDITS, cents: choice.costCents }
    case 'cash_spent':
      return { ...NO_EDITS, description: choice.description, categoryId: choice.categoryId ?? '', cents: choice.amountCents }
    default:
      return NO_EDITS
  }
}

function eventName(edits: Edits): string {
  return edits.title.trim() === '' ? HEALTH_KIND_LABELS[edits.kind] : edits.title.trim()
}

function headline(choice: QuickLogProposal, edits: Edits, currency: string): string {
  switch (choice.action) {
    case 'bill_paid':
      return `Mark ${choice.billName} paid`
    case 'task_done':
      return `Log ${choice.taskTitle} as done`
    case 'health_event':
      return `Add ${eventName(edits)} for ${whom(choice.personName)}`
    case 'medicine_refilled':
      return `Mark ${choice.medicineName} refilled`
    case 'cash_spent': {
      const what = edits.description.trim()
      const amount = edits.cents === null ? null : formatCents(edits.cents, { currency })
      // Nothing said about what it was for reads as plain cash.
      if (what === '' || what.toLocaleLowerCase('en') === 'cash') return amount === null ? 'Add cash spending' : `Add ${amount} in cash`
      return amount === null ? `Add ${what}` : `Add ${amount} for ${what}`
    }
    case 'renewed':
      return `Renew ${choice.name}`
    case 'not_renewing':
      return `Not renewing ${choice.name}`
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
    case 'cash_spent':
      return choice.merchant === null ? 'It goes on your transactions as a cash spend.' : `At ${choice.merchant}`
    case 'renewed':
      return `It runs out on ${formatCalendarDate(choice.currentExpiresOn, 'd MMM yyyy')} now.`
    case 'not_renewing':
      return `It runs out on ${formatCalendarDate(choice.expiresOn, 'd MMM yyyy')}. Ghar stops reminding anyone about it.`
  }
}

const DATE_LABELS: Record<QuickLogProposal['action'], string> = {
  bill_paid: 'Paid on',
  task_done: 'Done on',
  health_event: 'When',
  medicine_refilled: 'Refilled on',
  cash_spent: 'Spent on',
  renewed: 'New expiry date',
  not_renewing: 'Runs out on',
}

const SUBMIT_LABELS: Record<QuickLogProposal['action'], string> = {
  bill_paid: 'Mark paid',
  task_done: 'Log it',
  health_event: 'Add it',
  medicine_refilled: 'Mark refilled',
  cash_spent: 'Add it',
  renewed: 'Renew',
  not_renewing: 'Stop reminders',
}

/** The date the card starts with. Empty when it has to be asked for. */
function proposedDate(choice: QuickLogProposal): CalendarDate | undefined {
  switch (choice.action) {
    case 'bill_paid':
      return choice.paidOn
    case 'task_done':
      return choice.completedOn
    case 'health_event':
      return choice.occurredOn
    case 'medicine_refilled':
      return choice.refilledOn
    case 'cash_spent':
      return choice.spentOn
    case 'renewed':
      return choice.expiresOn ?? undefined
    case 'not_renewing':
      return choice.expiresOn
  }
}

/** What the confirm button sends, or why it can't yet. */
function applyBody(choice: QuickLogProposal, edits: Edits, on: CalendarDate): QuickLogApplyBody | string {
  switch (choice.action) {
    case 'bill_paid':
      return { action: 'bill_paid', billId: choice.billId, dueOn: choice.dueOn, paidOn: on }
    case 'task_done':
      return { action: 'task_done', taskId: choice.taskId, completedOn: on, costCents: edits.cents }
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
    case 'cash_spent': {
      if (edits.cents === null || edits.cents <= 0) return 'Say how much it was.'
      const description = edits.description.trim()
      if (description === '') return 'Say what it was for.'
      return {
        action: 'cash_spent',
        description,
        merchant: choice.merchant,
        amountCents: edits.cents,
        spentOn: on,
        categoryId: edits.categoryId === '' ? null : edits.categoryId,
      }
    }
    case 'renewed':
      return { action: 'renewed', kind: choice.kind, subjectId: choice.subjectId, expiresOn: on }
    case 'not_renewing':
      return { action: 'not_renewing', kind: choice.kind, subjectId: choice.subjectId, expiresOn: choice.expiresOn }
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
      return
    case 'cash_spent':
      await api.request(deleteTransaction, { params: { transactionId: what.transactionId } })
      return
    case 'renewed':
      await api.request(undoRenewExpiry, {
        params: { kind: what.kind, subjectId: what.subjectId },
        body: { renewedTo: what.renewedTo, previousExpiresOn: what.previousExpiresOn, previousIssuedOn: what.previousIssuedOn },
      })
      return
    case 'not_renewing':
      await api.request(clearNotRenewing, { params: { kind: what.kind, subjectId: what.subjectId } })
  }
}

export interface QuickLogCategoryOption {
  id: string
  name: string
}

/**
 * One sentence about something that happened, like "paid the water bill yesterday". Claude
 * suggests what to record, the person checks it, and only then is it saved, with a way to take it
 * back straight after.
 */
export function QuickLog({
  today,
  currency,
  categories,
  label = 'Log something',
}: {
  today: CalendarDate
  currency: string
  /** The categories cash can be filed under. Empty for someone who can't log spending. */
  categories: readonly QuickLogCategoryOption[]
  label?: string
}) {
  const id = useId()
  const router = useRouter()
  const [text, setText] = useState('')
  const [state, setState] = useState<State>({ step: 'write', problem: null })
  const [picked, setPicked] = useState(0)
  const [edits, setEdits] = useState<Edits>(NO_EDITS)
  /** A renewal's new date, once the suggested one is picked; it remounts the date field. */
  const [renewTo, setRenewTo] = useState<CalendarDate | null>(null)
  const [busy, setBusy] = useState<'reading' | 'saving' | 'undoing' | null>(null)
  /** Which of the logged things is being taken back. */
  const [undoingAt, setUndoingAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, startTransition] = useTransition()

  const read = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (text.trim() === '') return
    setError(null)
    setBusy('reading')
    try {
      const result = await api.request(parseQuickLog, { body: { text } })
      const entries = result.entries.filter(entry => entry.choices.length > 0)
      const skipped = result.entries.flatMap(entry =>
        entry.choices.length === 0 && entry.problem !== null ? [{ said: entry.said, problem: entry.problem }] : []
      )
      const first = entries[0]?.choices[0]
      if (first) {
        pick(first, 0)
        setState(current => ({
          step: 'confirm',
          entries,
          at: 0,
          skipped,
          logged: [],
          round: (current.step === 'confirm' ? current.round : 0) + 1,
        }))
      } else {
        setState({ step: 'write', problem: result.problem })
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  /** Fresh edits for each choice, as suggested. */
  function pick(choice: QuickLogProposal, index: number) {
    setPicked(index)
    setEdits(editsFor(choice))
    setRenewTo(null)
  }

  /** On to the next thing to confirm, or to what was logged once there's nothing left. */
  function next(current: Confirming, logged: Logged[]) {
    setError(null)
    const at = current.at + 1
    const first = current.entries[at]?.choices[0]
    if (first) {
      pick(first, 0)
      setState({ ...current, at, logged, round: current.round + 1 })
    } else if (logged.length === 0) {
      setState({ step: 'write', problem: 'Nothing was logged.' })
    } else {
      setText('')
      setState({ step: 'done', logged, skipped: current.skipped })
    }
  }

  const confirm = async (event: SyntheticEvent<HTMLFormElement>, current: Confirming, choice: QuickLogProposal) => {
    event.preventDefault()
    // Not renewing has no date to pick: it's the one it runs out on.
    const on = choice.action === 'not_renewing' ? choice.expiresOn : new FormData(event.currentTarget).get('on')
    if (typeof on !== 'string' || !isCalendarDate(on)) return
    const body = applyBody(choice, edits, on)
    if (typeof body === 'string') {
      setError(body)
      return
    }
    setError(null)
    setBusy('saving')
    try {
      const done = await api.request(applyQuickLog, { body })
      next(current, [...current.logged, { message: done.message, undo: done.undo, undone: false }])
      startTransition(() => router.refresh())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const undo = async (what: QuickLogUndo, index: number) => {
    setError(null)
    setBusy('undoing')
    setUndoingAt(index)
    try {
      await undoRequest(what)
      setState(current => {
        if (current.step !== 'done') return current
        const logged = current.logged.map((item, at) => (at === index ? { ...item, undone: true } : item))
        return logged.every(item => item.undone)
          ? { step: 'write', problem: 'Taken back. Nothing was left recorded.' }
          : { ...current, logged }
      })
      startTransition(() => router.refresh())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
      setUndoingAt(null)
    }
  }

  const startOver = () => {
    setError(null)
    setState({ step: 'write', problem: null })
  }

  if (state.step === 'done') {
    return (
      <div className='flex flex-col gap-2'>
        <div role='status' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
          <ul className='flex flex-col divide-y divide-line'>
            {state.logged.map((item, index) => (
              <li
                // One sentence gives each thing once, so its message is its own.
                key={item.message}
                className='flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between'
              >
                <div className='flex min-w-0 items-start gap-3'>
                  <CircleCheck
                    aria-hidden
                    className={item.undone ? 'mt-0.5 size-5 shrink-0 text-ink-muted' : 'mt-0.5 size-5 shrink-0 text-positive'}
                  />
                  <p className={item.undone ? 'min-w-0 break-words text-ink-muted' : 'min-w-0 break-words'}>
                    {item.undone ? `Taken back: ${item.message}` : item.message}
                  </p>
                </div>
                {item.undone ? null : (
                  <Button
                    type='button'
                    variant='outline'
                    className='shrink-0'
                    disabled={busy !== null || refreshing}
                    onClick={() => void undo(item.undo, index)}
                  >
                    {undoingAt === index ? 'Taking back…' : 'Undo'}
                  </Button>
                )}
              </li>
            ))}
            {state.skipped.map(item => (
              <SkippedRow key={`${item.said ?? ''}-${item.problem}`} item={item} />
            ))}
          </ul>
          <Button type='button' variant='ghost' className='self-start' disabled={busy !== null} onClick={startOver}>
            Log another
          </Button>
        </div>
        <FormError>{error}</FormError>
      </div>
    )
  }

  if (state.step === 'confirm') {
    const entry = state.entries[state.at]
    const choice = entry?.choices[picked] ?? entry?.choices[0]
    if (!entry || !choice) return null
    const below = detail(choice)
    const several = state.entries.length > 1
    return (
      <form
        // Fresh defaults for every new suggestion and every choice.
        key={`${String(state.round)}-${String(picked)}`}
        aria-labelledby={`${id}-headline`}
        onSubmit={event => void confirm(event, state, choice)}
        className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'
      >
        {state.at === 0 && state.skipped.length > 0 ? (
          <ul className='flex flex-col gap-2 border-b border-line pb-3'>
            {state.skipped.map(item => (
              <SkippedRow key={`${item.said ?? ''}-${item.problem}`} item={item} />
            ))}
          </ul>
        ) : null}
        <div className='flex flex-col gap-1'>
          <p className='text-sm text-ink-muted'>
            {several ? `${String(state.at + 1)} of ${String(state.entries.length)} · ` : null}“
            {several ? (entry.said ?? text.trim()) : text.trim()}”
          </p>
          <h2 id={`${id}-headline`} className='text-lg font-semibold break-words'>
            {headline(choice, edits, currency)}
          </h2>
          {below === null ? null : <p className='text-sm text-ink-muted'>{below}</p>}
        </div>

        {entry.choices.length > 1 ? (
          <fieldset className='flex flex-col gap-1'>
            <legend className='mb-1 text-sm font-medium'>
              {choice.action === 'health_event' ? 'Who was it for?' : 'Which one did you mean?'}
            </legend>
            {entry.choices.map((option, index) => (
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

        {choice.action === 'cash_spent' ? (
          <div className='grid gap-3 md:grid-cols-2'>
            <Field id={`${id}-description`} label='What it was for'>
              <Input
                id={`${id}-description`}
                name='description'
                maxLength={QUICK_LOG_DESCRIPTION_MAX}
                required
                value={edits.description}
                onChange={change => {
                  setEdits(current => ({ ...current, description: change.target.value }))
                }}
              />
            </Field>
            <Field id={`${id}-category`} label='Category'>
              <NativeSelect
                id={`${id}-category`}
                name='categoryId'
                value={edits.categoryId}
                onChange={change => {
                  setEdits(current => ({ ...current, categoryId: change.target.value }))
                }}
              >
                <option value=''>Leave it to review</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        ) : null}

        {choice.action === 'not_renewing' ? null : (
          <div className='grid gap-3 md:grid-cols-2'>
            {choice.action === 'renewed' ? (
              <div className='flex flex-col gap-2'>
                <DateField
                  // Picking the suggested date starts the field again with it.
                  key={renewTo ?? 'said'}
                  id={`${id}-on`}
                  name='on'
                  label={DATE_LABELS.renewed}
                  hint={choice.expiresOn === null ? 'When the new one runs out.' : undefined}
                  defaultValue={renewTo ?? proposedDate(choice)}
                  min={addCalendarDays(choice.currentExpiresOn, 1)}
                  required
                />
                {choice.suggestedRenewalOn === null || choice.suggestedRenewalOn === (renewTo ?? choice.expiresOn) ? null : (
                  <Button
                    type='button'
                    variant='outline'
                    className='self-start rounded-pill'
                    onClick={() => {
                      setRenewTo(choice.suggestedRenewalOn)
                    }}
                  >
                    Use {formatCalendarDate(choice.suggestedRenewalOn, 'd MMM yyyy')}
                  </Button>
                )}
              </div>
            ) : (
              <DateField
                id={`${id}-on`}
                name='on'
                label={DATE_LABELS[choice.action]}
                defaultValue={proposedDate(choice)}
                max={today}
                required
              />
            )}
            {choice.action === 'task_done' || choice.action === 'cash_spent' ? (
              <MoneyInput
                id={`${id}-cost`}
                name='costCents'
                label={choice.action === 'task_done' ? 'Cost' : 'Amount'}
                hint={choice.action === 'task_done' ? 'Optional' : undefined}
                required={choice.action === 'cash_spent'}
                currency={currency}
                defaultValue={edits.cents ?? undefined}
                onValueChange={cents => {
                  setEdits(current => ({ ...current, cents }))
                }}
              />
            ) : null}
          </div>
        )}

        <FormError>{error}</FormError>
        <div className='flex flex-col-reverse gap-2 md:flex-row md:justify-end'>
          {several ? (
            <Button
              type='button'
              variant='outline'
              disabled={busy !== null}
              onClick={() => {
                next(state, state.logged)
              }}
            >
              Skip
            </Button>
          ) : (
            <Button type='button' variant='outline' disabled={busy !== null} onClick={startOver}>
              Cancel
            </Button>
          )}
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
        <Field id={`${id}-text`} label={label} className='min-w-0 flex-1'>
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
            'Say what you paid or spent, did around the house, renewed, or a visit, shot or refill, up to three at once. You check each before anything is saved.')}
      </p>
      <FormError>{error}</FormError>
    </form>
  )
}

/** Something from the sentence that isn't being logged, and why. */
function SkippedRow({ item }: { item: Skipped }) {
  return (
    <li className='flex min-w-0 items-start gap-3 py-3 text-sm text-ink-muted first:pt-0 last:pb-0'>
      <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
      <span className='min-w-0 break-words'>{item.said === null ? item.problem : `Not logging “${item.said}”. ${item.problem}`}</span>
    </li>
  )
}
