'use client'

import { refillHealthMedicine, type HealthMedicine } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Pill } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { refillStatus } from '@/lib/health/display'
import type { HealthFormOptions } from '@/lib/health/service'
import { HealthMedicineSheet } from './health-medicine-sheet'

type Opened = { medicineId: string; turn: number; visible: boolean }

/** "500 mg twice a day · Dr Rao", or whichever of the two there is. */
function detail(medicine: HealthMedicine): string | null {
  const parts = [medicine.dose, medicine.contactName === null ? null : `from ${medicine.contactName}`].filter(part => part !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * What one person takes now, with when each needs refilling, and what they used to take, folded
 * away underneath. "Refilled" moves the refill date on by one supply.
 */
export function HealthMedicines({
  medicines,
  personId,
  personName,
  options,
  today,
}: {
  medicines: HealthMedicine[]
  personId: string
  personName: string
  /** Null when the caller can't log for this person. */
  options: HealthFormOptions | null
  today: CalendarDate
}) {
  // `turn` mounts a fresh sheet on each open, and the id is kept while the sheet slides away.
  const [open, setOpen] = useState<Opened | null>(null)
  const opened = open === null ? null : (medicines.find(medicine => medicine.id === open.medicineId) ?? null)
  const show = (medicineId: string) => {
    setOpen(current => ({ medicineId, turn: (current?.turn ?? 0) + 1, visible: true }))
  }
  const hide = () => {
    setOpen(current => (current === null ? null : { ...current, visible: false }))
  }
  const refill = useMutation(async (medicineId: string) => {
    await api.request(refillHealthMedicine, { params: { medicineId } })
  })

  const current = medicines.filter(medicine => medicine.stoppedOn === null)
  const stopped = medicines.filter(medicine => medicine.stoppedOn !== null)
  const you = personName === 'You'

  if (medicines.length === 0 && options === null) return null

  const addButton =
    options === null ? undefined : (
      <HealthMedicineSheet
        personId={personId}
        personName={personName}
        options={options}
        today={today}
        trigger={
          <Button variant={current.length === 0 ? 'outline' : 'ghost'}>
            <Plus aria-hidden />
            Add a medicine
          </Button>
        }
      />
    )
  const select =
    options === null
      ? undefined
      : (medicine: HealthMedicine) => {
          if (medicine.canEdit) show(medicine.id)
        }

  return (
    <section aria-labelledby='health-medicines'>
      <SectionHeader
        id='health-medicines'
        title='Medicines'
        description={current.length === 0 ? undefined : 'What’s taken now, and when each needs refilling'}
        action={current.length === 0 ? undefined : addButton}
      />
      {current.length === 0 ? (
        <div className='flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4'>
          <p className='text-ink-muted'>
            {options === null
              ? `Nothing ${you ? 'you take' : `${personName} takes`} right now.`
              : `Add what ${you ? 'you take' : `${personName} takes`}, with a refill date, and Ghar reminds you a week before it runs low.`}
          </p>
          {addButton}
        </div>
      ) : (
        <>
          <DataList
            label={`What ${you ? 'you take' : `${personName} takes`} now`}
            rows={current}
            rowKey={medicine => medicine.id}
            onSelect={select}
            selectPopup={options === null ? undefined : 'dialog'}
            primary={{ header: 'Medicine', cell: medicine => medicine.name }}
            secondary={medicine => {
              const about = detail(medicine)
              const canRefill = options !== null && medicine.canEdit && medicine.supplyDays !== null
              if (about === null && !canRefill) return null
              return (
                <span className='flex flex-col items-start gap-2'>
                  {about === null ? null : <span className='break-words'>{about}</span>}
                  {canRefill ? (
                    <Button
                      type='button'
                      variant='outline'
                      className='relative z-10'
                      disabled={refill.pending}
                      onClick={() => {
                        refill.mutate(medicine.id)
                      }}
                    >
                      Refilled
                    </Button>
                  ) : null}
                </span>
              )
            }}
            trailing={{
              header: 'Refill',
              cell: medicine => {
                if (medicine.refillBy === null || medicine.refillState === null) {
                  return <span className='text-sm text-ink-muted'>No refill date</span>
                }
                const status = refillStatus({ refillBy: medicine.refillBy, refillState: medicine.refillState }, today)
                return (
                  <span className='flex flex-col items-end gap-1'>
                    <Pill tone={status.tone}>{status.phrase}</Pill>
                    <span className='text-sm text-ink-muted tabular-nums'>{formatCalendarDate(medicine.refillBy)}</span>
                  </span>
                )
              },
            }}
          />
          <FormError>{refill.error}</FormError>
        </>
      )}

      {stopped.length === 0 ? null : (
        <details className='group mt-3 rounded-card border border-line bg-surface'>
          <summary className='flex min-h-tap list-none items-center justify-between gap-3 px-4 text-sm text-ink-muted [&::-webkit-details-marker]:hidden'>
            {stopped.length === 1 ? '1 stopped medicine' : `${String(stopped.length)} stopped medicines`}
            <ChevronDown aria-hidden className='size-4 group-open:rotate-180' />
          </summary>
          <div className='border-t border-line p-2'>
            <DataList
              label={`What ${you ? 'you' : personName} used to take`}
              rows={stopped}
              rowKey={medicine => medicine.id}
              onSelect={select}
              selectPopup={options === null ? undefined : 'dialog'}
              primary={{ header: 'Medicine', cell: medicine => medicine.name }}
              secondary={medicine => detail(medicine)}
              trailing={{
                header: 'Stopped',
                cell: medicine => (
                  <span className='text-sm text-ink-muted tabular-nums'>
                    {medicine.stoppedOn === null ? null : `Stopped ${formatCalendarDate(medicine.stoppedOn)}`}
                  </span>
                ),
              }}
            />
          </div>
        </details>
      )}

      {open === null || opened === null || options === null ? null : (
        <HealthMedicineSheet
          key={open.turn}
          personId={personId}
          personName={personName}
          medicine={opened}
          options={options}
          today={today}
          open={open.visible}
          onClose={hide}
        />
      )}
    </section>
  )
}
