import type { HealthCard as HealthCardValue } from '@ghar/contracts'
import { hasHealthCardDetails } from '@ghar/core/health'
import { Pencil, Printer } from 'lucide-react'
import Link from 'next/link'
import { HealthCardDetails } from '@/app/(app)/_components/health-card-details'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import { Button } from '@/components/ui/button'
import type { HealthFormOptions } from '@/lib/health/service'
import { HealthCardSheet } from './health-card-sheet'

/**
 * One person's health card at the top of their page: allergies, conditions, what they take now,
 * blood type, their doctor and insurance. Printable, and on hand in travel mode.
 */
export function HealthCard({ card, options }: { card: HealthCardValue; options: HealthFormOptions | null }) {
  const filled = hasHealthCardDetails(card)
  const you = card.personName === 'You'
  if (!filled && options === null) return null

  const editButton =
    options === null ? null : (
      <HealthCardSheet
        card={card}
        options={options}
        trigger={
          <Button variant={filled ? 'ghost' : 'outline'}>
            <Pencil aria-hidden />
            {filled ? 'Edit card' : 'Fill in the card'}
          </Button>
        }
      />
    )

  return (
    <section aria-labelledby='health-card'>
      <SectionHeader
        id='health-card'
        title='Health card'
        description={filled ? `What someone helping ${you ? 'you' : card.personName} would need to know` : undefined}
        action={
          filled ? (
            <>
              <Button asChild variant='ghost'>
                <Link href={`/health/cards?person=${card.personId}`}>
                  <Printer aria-hidden />
                  Print
                </Link>
              </Button>
              {editButton}
            </>
          ) : undefined
        }
      />
      {filled ? (
        <div className='rounded-card border border-line bg-surface p-4'>
          <HealthCardDetails card={card} />
        </div>
      ) : (
        <div className='flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4'>
          <p className='text-ink-muted'>
            Add {you ? 'your' : `${card.personName}’s`} allergies, blood type and doctor, so it’s all in one place when someone needs it. It
            comes along in travel mode.
          </p>
          {editButton}
        </div>
      )}
    </section>
  )
}
