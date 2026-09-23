'use client'

import type { Account } from '@ghar/contracts'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GoalSheet } from './goal-sheet'

/** The one action the goals screen has of its own. */
export function AddGoal({
  accounts,
  currency,
  today,
  label = 'Add a goal',
}: {
  accounts: Account[]
  currency: string
  today: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <GoalSheet
      accounts={accounts}
      currency={currency}
      today={today}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus aria-hidden />
          {label}
        </Button>
      }
    />
  )
}
