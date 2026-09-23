'use client'

import type { Category } from '@ghar/contracts'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RuleSheet } from './rule-sheet'

/** The one action the rules screen has of its own. */
export function AddRule({ categories, label = 'Add a rule' }: { categories: Category[]; label?: string }) {
  const [open, setOpen] = useState(false)
  // Counted up on every close, so the next rule starts from a blank form rather than the last one.
  const [round, setRound] = useState(0)
  return (
    <RuleSheet
      key={round}
      categories={categories}
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) setRound(current => current + 1)
      }}
      trigger={
        <Button>
          <Plus aria-hidden />
          {label}
        </Button>
      }
    />
  )
}
