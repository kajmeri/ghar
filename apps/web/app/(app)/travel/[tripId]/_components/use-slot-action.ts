'use client'

import {
  chooseOption,
  deleteOption,
  deleteSlot,
  moveSlot,
  rejectOption,
  reopenSlot,
  restoreOption,
  skipSlot,
  voteOnOption,
} from '@ghar/contracts'
import type { OptionVote, SlotBand } from '@ghar/core/itinerary'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { useItinerary } from './itinerary-context'

/** Every one-tap change to a slot or an option. Forms have their own mutations. */
export type SlotAction =
  | { type: 'choose'; slotId: string; optionId: string }
  | { type: 'reject'; slotId: string; optionId: string }
  | { type: 'restore'; slotId: string; optionId: string }
  | { type: 'vote'; slotId: string; optionId: string; vote: OptionVote | null }
  | { type: 'delete-option'; slotId: string; optionId: string }
  | { type: 'reopen'; slotId: string }
  | { type: 'skip'; slotId: string }
  | { type: 'delete-slot'; slotId: string }
  | { type: 'move'; slotId: string; day: string; band: SlotBand; toIndex?: number }

function perform(tripId: string, action: SlotAction): Promise<unknown> {
  switch (action.type) {
    case 'choose':
      return api.request(chooseOption, { params: { tripId, optionId: action.optionId } })
    case 'reject':
      return api.request(rejectOption, { params: { tripId, optionId: action.optionId } })
    case 'restore':
      return api.request(restoreOption, { params: { tripId, optionId: action.optionId } })
    case 'vote':
      return api.request(voteOnOption, { params: { tripId, optionId: action.optionId }, body: { vote: action.vote } })
    case 'delete-option':
      return api.request(deleteOption, { params: { tripId, optionId: action.optionId } })
    case 'reopen':
      return api.request(reopenSlot, { params: { tripId, slotId: action.slotId } })
    case 'skip':
      return api.request(skipSlot, { params: { tripId, slotId: action.slotId } })
    case 'delete-slot':
      return api.request(deleteSlot, { params: { tripId, slotId: action.slotId } })
    case 'move':
      return api.request(moveSlot, {
        params: { tripId, slotId: action.slotId },
        body: { day: action.day, band: action.band, toIndex: action.toIndex },
      })
  }
}

/**
 * Runs a SlotAction, then re-reads the page. Choosing settles the slot, so the comparison closes
 * and the row folds back to one line; the rest leave the view where it was.
 */
export function useSlotAction() {
  const { tripId, closeSheet, setExpanded } = useItinerary()
  return useMutation(async (action: SlotAction) => {
    await perform(tripId, action)
    if (action.type === 'choose' || action.type === 'skip' || action.type === 'delete-slot' || action.type === 'move') {
      setExpanded(action.slotId, false)
      closeSheet()
    }
    if (action.type === 'reopen') {
      setExpanded(action.slotId, true)
      closeSheet()
    }
  })
}
