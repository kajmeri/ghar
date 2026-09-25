import type { HealthEventKind } from '@ghar/core/health'

/** An example title for each kind, shown in the empty title field. */
export const HEALTH_TITLE_PLACEHOLDERS: Record<HealthEventKind, string> = {
  vaccine: 'Flu shot',
  checkup: 'Annual physical',
  dental: 'Cleaning',
  eye: 'Eye exam',
  visit: 'Follow-up',
  test: 'Blood test',
}
