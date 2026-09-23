'use client'

import type { Category } from '@ghar/contracts'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CategorySheet } from './category-sheet'

/** The one action the categories screen has of its own. */
export function AddCategory({ parents }: { parents: Category[] }) {
  const [open, setOpen] = useState(false)
  // Counted up on every close, so the next category starts from a blank form rather than the last one.
  const [round, setRound] = useState(0)
  return (
    <CategorySheet
      key={round}
      parents={parents}
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) setRound(current => current + 1)
      }}
      trigger={
        <Button>
          <Plus aria-hidden />
          Add a category
        </Button>
      }
    />
  )
}
