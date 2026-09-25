import type { HealthCard } from '@ghar/contracts'
import { bloodTypeLabel } from '@ghar/core/health'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * What's on one person's health card, most urgent first: allergies before anything else, because
 * that's what a stranger helping most needs to know. Only what's filled in shows. Shared by the
 * health page, travel mode and the printed card, so it takes no interaction and needs no client.
 */
export function HealthCardDetails({ card, large = false, links = true }: { card: HealthCard; large?: boolean; links?: boolean }) {
  const rows: { label: string; value: ReactNode }[] = []
  if (card.allergies.length > 0) rows.push({ label: 'Allergies', value: <span className='font-medium'>{card.allergies.join(', ')}</span> })
  if (card.conditions.length > 0) rows.push({ label: 'Conditions', value: card.conditions.join(', ') })
  if (card.medicines.length > 0) {
    rows.push({
      label: 'Medicines',
      value: (
        <ul className='flex flex-col gap-0.5'>
          {card.medicines.map(medicine => (
            <li key={medicine.id}>
              {medicine.name}
              {medicine.dose === null ? null : <span className='text-ink-muted'> · {medicine.dose}</span>}
            </li>
          ))}
        </ul>
      ),
    })
  }
  if (card.bloodType !== null)
    rows.push({ label: 'Blood type', value: <span className='tabular-nums'>{bloodTypeLabel(card.bloodType)}</span> })
  if (card.doctorName !== null) {
    rows.push({
      label: 'Doctor',
      value: (
        <span className='flex flex-col items-start'>
          <span>{card.doctorName}</span>
          {card.doctorPhone === null ? null : links ? (
            <a
              href={`tel:${card.doctorPhone.replace(/[^\d+]/g, '')}`}
              className='-mb-2.5 inline-flex min-h-tap items-center tabular-nums underline underline-offset-4'
            >
              {card.doctorPhone}
            </a>
          ) : (
            <span className='tabular-nums'>{card.doctorPhone}</span>
          )}
        </span>
      ),
    })
  }
  if (card.insuranceDocumentId !== null) {
    rows.push({
      label: 'Insurance',
      value:
        card.insuranceDocumentTitle !== null && links ? (
          <Link
            href={`/documents/${card.insuranceDocumentId}`}
            className='-my-2.5 inline-flex min-h-tap items-center underline underline-offset-4'
          >
            {card.insuranceDocumentTitle}
          </Link>
        ) : (
          (card.insuranceDocumentTitle ?? 'Card on file')
        ),
    })
  }
  if (card.emergencyNote !== null) rows.push({ label: 'Note', value: <span className='whitespace-pre-line'>{card.emergencyNote}</span> })

  return (
    <dl className={cn('grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2', large ? 'text-lg' : 'text-base')}>
      {rows.map(row => (
        <div key={row.label} className='contents'>
          <dt className={cn('text-ink-muted', large ? 'text-base leading-7' : 'text-sm leading-6')}>{row.label}</dt>
          <dd className='min-w-0 break-words'>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
