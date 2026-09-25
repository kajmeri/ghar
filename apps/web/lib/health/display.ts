import type { CalendarDate } from '@ghar/core/dates'
import { healthDuePhrase, type HealthDueState, type HealthEventKind } from '@ghar/core/health'
import type { PillTone } from '@/components/ui/pill'

/** An example title for each kind, shown in the empty title field. */
export const HEALTH_TITLE_PLACEHOLDERS: Record<HealthEventKind, string> = {
  vaccine: 'Flu shot',
  checkup: 'Annual physical',
  dental: 'Cleaning',
  eye: 'Eye exam',
  visit: 'Follow-up',
  test: 'Blood test',
}

/** The pill a due date gets: overdue is negative, coming up is caution, further off has no colour. */
export const HEALTH_DUE_TONES: Record<HealthDueState, PillTone> = {
  overdue: 'negative',
  due_soon: 'caution',
  scheduled: 'neutral',
}

export function healthDueStatus(
  due: { dueOn: CalendarDate; state: HealthDueState },
  today: CalendarDate
): { phrase: string; tone: PillTone } {
  return { phrase: healthDuePhrase(due.dueOn, today), tone: HEALTH_DUE_TONES[due.state] }
}

/** The cadences the schedule form offers. Anything else stored still shows. */
export const HEALTH_CADENCE_OPTIONS: readonly number[] = [1, 3, 6, 12, 24, 36, 60, 120]
