'use client'

import {
  COST_DESCRIPTION_MAX,
  COST_SHARES_LIMIT,
  createTripCost,
  deleteTripCost,
  deleteTripPayment,
  recordTripPayment,
  updateTripCost,
  type SaveTripCostBody,
  type TripCost,
  type TripCostParty,
  type TripCostsValue,
  type TripPartyValue,
  type TripTransfer,
} from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { formatCents, type Cents } from '@ghar/core/money'
import { partyKey, splitCost } from '@ghar/core/trip-costs'
import { useState, type SyntheticEvent } from 'react'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { cn } from '@/lib/utils'

// Who paid for what on the trip, and who owes whom. The household is one party and each guest
// another. Everyone on the trip sees the same ledger; balances come from the server every time.

type Names = ReadonlyMap<string, TripCostParty>

function nameOf(names: Names, party: TripPartyValue): string {
  const entry = names.get(partyKey(party))
  if (!entry) return 'Someone'
  return entry.you ? 'You' : (entry.name ?? 'A guest')
}

const shortDate = (date: string) => formatCalendarDate(date as CalendarDate, 'MMM d')

export function TripCosts({ tripId, value, today }: { tripId: string; value: TripCostsValue; today: string }) {
  const [adding, setAdding] = useState(false)
  const names: Names = new Map(value.parties.map(entry => [partyKey(entry.party), entry]))
  const money = (cents: Cents) => formatCents(cents, { currency: value.currency })

  // With no one else on the trip there's nothing to share yet.
  if (value.parties.length < 2 && value.costs.length === 0 && value.payments.length === 0) return null

  const mine = value.parties.find(entry => entry.you)?.balanceCents ?? 0

  return (
    <section aria-labelledby='costs-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='costs-heading' className='text-lg font-semibold'>
          Shared costs
        </h2>
        <p className='text-sm text-ink-muted'>Who paid for what, and who owes whom.</p>
      </div>

      {value.costs.length === 0 && value.payments.length === 0 ? (
        <div className='rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>Nothing shared yet</p>
          <p className='text-sm text-ink-muted'>
            {value.canAdd
              ? 'Add something you paid for and who it’s for. Everyone on the trip sees who owes whom.'
              : 'When someone adds what they paid for, you’ll see who owes whom here.'}
          </p>
        </div>
      ) : (
        <>
          <div className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
            <div className='flex items-baseline justify-between gap-3'>
              <p className='text-base'>{mine < 0 ? 'You owe' : mine > 0 ? 'You’re owed' : 'All square'}</p>
              {mine === 0 ? null : (
                <p className={cn('text-2xl font-semibold tracking-[-0.02em] tabular-nums', mine < 0 ? 'text-caution' : 'text-positive')}>
                  {money(Math.abs(mine))}
                </p>
              )}
            </div>
            <p className='text-sm text-ink-muted tabular-nums'>{money(value.totalCents)} spent together so far</p>
            {value.transfers.length > 0 ? (
              <ul className='flex flex-col divide-y divide-line border-t border-line'>
                {value.transfers.map(transfer => (
                  <TransferRow
                    key={`${partyKey(transfer.from)}>${partyKey(transfer.to)}`}
                    tripId={tripId}
                    transfer={transfer}
                    names={names}
                    money={money}
                    today={today}
                  />
                ))}
              </ul>
            ) : null}
          </div>

          {value.costs.length > 0 ? (
            <ul className='grid gap-3 md:grid-cols-2'>
              {value.costs.map(cost => (
                <CostCard key={cost.id} tripId={tripId} cost={cost} value={value} names={names} money={money} today={today} />
              ))}
            </ul>
          ) : null}

          {value.payments.length > 0 ? (
            <div className='flex flex-col gap-1'>
              <h3 className='text-base font-semibold'>Paid back</h3>
              <ul className='flex flex-col divide-y divide-line'>
                {value.payments.map(payment => (
                  <PaymentRow key={payment.id} tripId={tripId} payment={payment} names={names} money={money} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {value.canAdd ? (
        adding ? (
          <CostForm
            tripId={tripId}
            value={value}
            names={names}
            today={today}
            onDone={() => {
              setAdding(false)
            }}
          />
        ) : (
          <Button
            type='button'
            variant='outline'
            className='self-start'
            onClick={() => {
              setAdding(true)
            }}
          >
            Add a cost
          </Button>
        )
      ) : null}
    </section>
  )
}

function TransferRow({
  tripId,
  transfer,
  names,
  money,
  today,
}: {
  tripId: string
  transfer: TripTransfer
  names: Names
  money: (cents: Cents) => string
  today: string
}) {
  const record = useMutation(() =>
    api.request(recordTripPayment, {
      params: { tripId },
      body: { from: transfer.from, to: transfer.to, amountCents: transfer.amountCents, paidOn: today },
    })
  )
  const from = nameOf(names, transfer.from)
  const to = nameOf(names, transfer.to)

  return (
    <li className='flex flex-col gap-1 pt-2'>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <p className='min-w-0 text-base break-words'>
          {from} {from === 'You' ? 'pay' : 'pays'} {to === 'You' ? 'you' : to}{' '}
          <span className='font-semibold tabular-nums'>{money(transfer.amountCents)}</span>
        </p>
        {transfer.canRecord ? (
          <Button
            type='button'
            variant='outline'
            disabled={record.pending}
            onClick={() => {
              record.mutate()
            }}
          >
            {record.pending ? 'Saving…' : 'Mark as paid'}
          </Button>
        ) : null}
      </div>
      <FormError>{record.error}</FormError>
    </li>
  )
}

function CostCard({
  tripId,
  cost,
  value,
  names,
  money,
  today,
}: {
  tripId: string
  cost: TripCost
  value: TripCostsValue
  names: Names
  money: (cents: Cents) => string
  today: string
}) {
  const [editing, setEditing] = useState(false)
  const remove = useMutation(() => api.request(deleteTripCost, { params: { tripId, costId: cost.id } }))
  const split = cost.shares
    .map(share => {
      const name = nameOf(names, share.party)
      return share.shares > 1 ? `${name} ×${String(share.shares)}` : name
    })
    .join(', ')

  if (editing) {
    return (
      <li>
        <CostForm
          tripId={tripId}
          value={value}
          names={names}
          today={today}
          cost={cost}
          onDone={() => {
            setEditing(false)
          }}
        />
      </li>
    )
  }

  return (
    <li className='flex flex-col gap-1 rounded-card border border-line bg-surface p-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='min-w-0 text-base font-semibold break-words'>{cost.description}</h3>
        <p className='shrink-0 text-base font-semibold tabular-nums'>{money(cost.amountCents)}</p>
      </div>
      <p className='text-sm text-ink-muted'>
        {nameOf(names, cost.paidBy)} paid · {shortDate(cost.spentOn)}
      </p>
      <p className='text-sm text-ink-muted'>Split between {split}</p>
      {cost.yourCents > 0 ? <p className='text-sm tabular-nums'>Your share {money(cost.yourCents)}</p> : null}
      {cost.canEdit ? (
        <div className='flex flex-wrap gap-x-4'>
          <button
            type='button'
            onClick={() => {
              setEditing(true)
            }}
            className='min-h-tap text-sm text-ink underline underline-offset-2'
          >
            Change
          </button>
          <button
            type='button'
            disabled={remove.pending}
            onClick={() => {
              remove.mutate()
            }}
            className='min-h-tap text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
          >
            {remove.pending ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : null}
      <FormError>{remove.error}</FormError>
    </li>
  )
}

function PaymentRow({
  tripId,
  payment,
  names,
  money,
}: {
  tripId: string
  payment: TripCostsValue['payments'][number]
  names: Names
  money: (cents: Cents) => string
}) {
  const remove = useMutation(() => api.request(deleteTripPayment, { params: { tripId, paymentId: payment.id } }))
  const to = nameOf(names, payment.to)

  return (
    <li className='flex flex-col gap-1 py-2'>
      <div className='flex flex-wrap items-center justify-between gap-x-3'>
        <p className='min-w-0 text-base break-words'>
          {nameOf(names, payment.from)} paid {to === 'You' ? 'you' : to} <span className='tabular-nums'>{money(payment.amountCents)}</span>
          <span className='text-sm text-ink-muted'> · {shortDate(payment.paidOn)}</span>
        </p>
        {payment.canDelete ? (
          <button
            type='button'
            disabled={remove.pending}
            onClick={() => {
              remove.mutate()
            }}
            className='min-h-tap text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
          >
            {remove.pending ? 'Undoing…' : 'Undo'}
          </button>
        ) : null}
      </div>
      <FormError>{remove.error}</FormError>
    </li>
  )
}

interface SplitRow {
  on: boolean
  shares: number
}

function CostForm({
  tripId,
  value,
  names,
  today,
  cost,
  onDone,
}: {
  tripId: string
  value: TripCostsValue
  names: Names
  today: string
  cost?: TripCost
  onDone: () => void
}) {
  // Everyone still going, and anyone already in this cost's split.
  const parties = value.parties.filter(
    entry => entry.active || cost?.shares.some(share => partyKey(share.party) === partyKey(entry.party)) === true
  )
  const [amount, setAmount] = useState<Cents | null>(cost?.amountCents ?? null)
  const [split, setSplit] = useState<Record<string, SplitRow>>(() =>
    Object.fromEntries(
      parties.map(entry => {
        const existing = cost?.shares.find(share => partyKey(share.party) === partyKey(entry.party))
        return [partyKey(entry.party), { on: cost ? existing !== undefined : true, shares: existing?.shares ?? entry.heads }]
      })
    )
  )
  const [problem, setProblem] = useState<string | null>(null)
  const save = useMutation(async (body: SaveTripCostBody) => {
    if (cost) await api.request(updateTripCost, { params: { tripId, costId: cost.id }, body })
    else await api.request(createTripCost, { params: { tripId }, body })
    onDone()
  })

  const chosen = parties.flatMap(entry => {
    const row = split[partyKey(entry.party)]
    return row?.on ? [{ party: entry.party, shares: row.shares }] : []
  })
  const valid = chosen.every(share => Number.isInteger(share.shares) && share.shares >= 1 && share.shares <= COST_SHARES_LIMIT)
  const preview =
    amount !== null && amount > 0 && valid && chosen.length > 0
      ? // However the form lists people, the pennies land where the ledger will put them.
        splitCost(amount, chosen)
      : null
  const payerOptions = value.parties.filter(entry => entry.active || (cost && partyKey(cost.paidBy) === partyKey(entry.party)))

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setProblem(null)
    if (chosen.length === 0) return setProblem('Pick who it’s split between.')
    if (!valid) return setProblem(`Shares go from 1 to ${String(COST_SHARES_LIMIT)}.`)
    const paidKey = formText(data, 'paidBy')
    const paidBy = value.canPickPayer ? value.parties.find(entry => partyKey(entry.party) === paidKey)?.party : value.you
    if (!paidBy) return setProblem('Pick who paid.')
    save.mutate({
      description: formText(data, 'description'),
      amountCents: Number(formText(data, 'amountCents')),
      spentOn: formText(data, 'spentOn'),
      paidBy,
      shares: chosen,
    })
  }

  return (
    <form onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <h3 className='text-base font-semibold'>{cost ? 'Change cost' : 'Add a cost'}</h3>
      <Field label='What for'>
        <Input
          name='description'
          required
          maxLength={COST_DESCRIPTION_MAX}
          defaultValue={cost?.description}
          placeholder='Dinner at Ramiro'
        />
      </Field>
      <div className='grid grid-cols-2 gap-3'>
        <MoneyInput
          id={`amount-${cost?.id ?? 'new'}`}
          name='amountCents'
          label='Amount'
          currency={value.currency}
          required
          defaultValue={cost?.amountCents}
          onValueChange={setAmount}
        />
        <Field label='Date'>
          <Input name='spentOn' type='date' required defaultValue={cost?.spentOn ?? today} />
        </Field>
      </div>
      {value.canPickPayer ? (
        <Field label='Paid by'>
          <NativeSelect name='paidBy' defaultValue={partyKey(cost?.paidBy ?? value.you)}>
            {payerOptions.map(entry => (
              <option key={partyKey(entry.party)} value={partyKey(entry.party)}>
                {entry.you ? `${entry.name ?? 'You'} (you)` : (entry.name ?? 'A guest')}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <p className='text-sm text-ink-muted'>Paid by you</p>
      )}

      <fieldset className='flex flex-col gap-1'>
        <legend className='text-sm font-medium'>Split between</legend>
        <p className='text-sm text-ink-muted'>Shares start at how many people each party is. Change them for an uneven split.</p>
        <ul className='flex flex-col divide-y divide-line'>
          {parties.map((entry, index) => {
            const key = partyKey(entry.party)
            const row = split[key] ?? { on: false, shares: entry.heads }
            const position = chosen.findIndex(share => partyKey(share.party) === key)
            const part = preview && position >= 0 ? preview[position] : undefined
            const id = `split-${cost?.id ?? 'new'}-${String(index)}`
            return (
              <li key={key} className='flex items-center justify-between gap-3 py-1'>
                <label htmlFor={id} className='flex min-h-tap min-w-0 flex-1 items-center gap-3'>
                  <input
                    id={id}
                    type='checkbox'
                    checked={row.on}
                    onChange={event => {
                      setSplit({ ...split, [key]: { ...row, on: event.target.checked } })
                    }}
                    className='size-5 shrink-0 accent-ink'
                  />
                  <span className='min-w-0 break-words'>{nameOf(names, entry.party)}</span>
                  {part === undefined ? null : (
                    <span className='text-sm text-ink-muted tabular-nums'>{formatCents(part, { currency: value.currency })}</span>
                  )}
                </label>
                <Input
                  aria-label={`Shares for ${nameOf(names, entry.party)}`}
                  type='number'
                  inputMode='numeric'
                  min={1}
                  max={COST_SHARES_LIMIT}
                  disabled={!row.on}
                  value={row.shares}
                  onChange={event => {
                    setSplit({ ...split, [key]: { ...row, shares: Number(event.target.value) } })
                  }}
                  className='w-20 shrink-0 tabular-nums'
                />
              </li>
            )
          })}
        </ul>
      </fieldset>

      <div className='flex gap-2'>
        <Button type='submit' disabled={save.pending}>
          {save.pending ? 'Saving…' : cost ? 'Save changes' : 'Add cost'}
        </Button>
        <Button type='button' variant='ghost' onClick={onDone}>
          Cancel
        </Button>
      </div>
      <FormError>{problem ?? save.error}</FormError>
    </form>
  )
}
