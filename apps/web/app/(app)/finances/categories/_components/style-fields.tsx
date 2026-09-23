'use client'

import type { CategoryColorTokenValue, CategoryIconValue } from '@ghar/contracts'
import { CATEGORY_COLOR_TOKENS, CATEGORY_ICONS } from '@ghar/core/finances'
import { cn } from '@/lib/utils'
import { CATEGORY_COLOR_CLASSES, CATEGORY_ICON_COMPONENTS } from './category-icon'

// How a category looks: the icon it wears and the token it is tinted with. Both are picked from a
// fixed list rather than typed, so the form never has to guess at what someone meant.

const CHOICE =
  'flex size-11 items-center justify-center rounded-input border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
const CHOSEN = 'border-ink bg-paper'
const UNCHOSEN = 'border-line hover:bg-paper'

/** What each token is called where someone picks one. Colour on a category is decoration. */
const COLOR_LABELS: Record<CategoryColorTokenValue, string> = {
  ink: 'Black',
  'ink-muted': 'Grey',
  positive: 'Green',
  caution: 'Amber',
  negative: 'Red',
}

export function IconField({ value, onChange }: { value: CategoryIconValue; onChange: (icon: CategoryIconValue) => void }) {
  return (
    <fieldset className='flex flex-col gap-2'>
      <legend className='pb-2 text-sm font-medium'>Icon</legend>
      {/* A scrollable tray rather than a long page: the icon is the least of this form. */}
      <div className='flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-card border border-line p-2'>
        {CATEGORY_ICONS.map(choice => {
          const Icon = CATEGORY_ICON_COMPONENTS[choice]
          return (
            <button
              key={choice}
              type='button'
              aria-pressed={choice === value}
              className={cn(CHOICE, choice === value ? CHOSEN : UNCHOSEN)}
              onClick={() => {
                onChange(choice)
              }}
            >
              <Icon aria-hidden className='size-5' />
              <span className='sr-only'>{choice.replaceAll('-', ' ')}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function ColorField({
  value,
  onChange,
}: {
  value: CategoryColorTokenValue
  onChange: (colorToken: CategoryColorTokenValue) => void
}) {
  return (
    <fieldset className='flex flex-col gap-2'>
      <legend className='pb-2 text-sm font-medium'>Colour</legend>
      <div className='flex flex-wrap gap-2'>
        {CATEGORY_COLOR_TOKENS.map(choice => (
          <button
            key={choice}
            type='button'
            aria-pressed={choice === value}
            className={cn(CHOICE, choice === value ? CHOSEN : UNCHOSEN)}
            onClick={() => {
              onChange(choice)
            }}
          >
            <span aria-hidden className={cn('size-4 rounded-pill bg-current', CATEGORY_COLOR_CLASSES[choice])} />
            <span className='sr-only'>{COLOR_LABELS[choice]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
