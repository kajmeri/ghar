'use client'

import type {
  HouseholdMember,
  ItinerarySlot,
  ItineraryView,
  ItineraryWarningValue,
  OptionFactsValue,
  Trip,
  TripIdea,
} from '@ghar/contracts'
import { slotShape, type SlotBand } from '@ghar/core/itinerary'
import { tripDays } from '@ghar/core/trips'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { densityCookieName, type Density } from '@/lib/travel/itinerary-display'

/** The one sheet open over the itinerary, if any. Rows, the week grid and the queue all open the same ones. */
export type SheetRequest =
  | { kind: 'slot'; slotId: string }
  | { kind: 'compare'; slotId: string; focusOptionId?: string }
  | { kind: 'add-option'; slotId: string }
  | { kind: 'edit-option'; slotId: string; optionId: string }
  | { kind: 'edit-slot'; slotId: string }
  | { kind: 'add-slot'; day: string; band?: SlotBand }

interface ItineraryContextValue {
  tripId: string
  trip: Trip
  timeZone: string
  today: string
  travelers: number
  currentUserId: string
  canEdit: boolean
  members: readonly HouseholdMember[]
  ideas: readonly TripIdea[]
  slots: readonly ItinerarySlot[]
  slotById: ReadonlyMap<string, ItinerarySlot>
  dismissedDays: readonly string[]
  /** The trip's days, plus any day a slot sits on outside them. What "Move to" offers. */
  days: readonly string[]
  facts: ReadonlyMap<string, OptionFactsValue>
  warningsBySlot: ReadonlyMap<string, readonly ItineraryWarningValue[]>
  density: Density
  setDensity: (density: Density) => void
  expanded: ReadonlySet<string>
  setExpanded: (slotId: string, open: boolean) => void
  sheet: SheetRequest | null
  openSheet: (request: SheetRequest) => void
  closeSheet: () => void
  /** Opens whatever a tap on this slot should: the comparison, its details, or the add form. */
  openSlot: (slot: ItinerarySlot) => void
}

const ItineraryContext = createContext<ItineraryContextValue | null>(null)

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export function ItineraryProvider({
  trip,
  timeZone,
  today,
  itinerary,
  members,
  ideas,
  currentUserId,
  canEdit,
  density: initialDensity = 'compact',
  children,
}: {
  trip: Trip
  timeZone: string
  today: string
  itinerary: ItineraryView
  members: readonly HouseholdMember[]
  ideas: readonly TripIdea[]
  currentUserId: string
  canEdit: boolean
  density?: Density
  children: ReactNode
}) {
  const [density, setDensityState] = useState(initialDensity)
  const [expanded, setExpandedState] = useState<ReadonlySet<string>>(() => new Set())
  const [sheet, setSheet] = useState<SheetRequest | null>(null)

  const derived = useMemo(() => {
    const slotById = new Map(itinerary.slots.map(slot => [slot.id, slot]))
    const facts = new Map(itinerary.facts.map(each => [each.optionId, each]))
    const warningsBySlot = new Map<string, ItineraryWarningValue[]>()
    for (const warning of itinerary.warnings) {
      warningsBySlot.set(warning.slotId, [...(warningsBySlot.get(warning.slotId) ?? []), warning])
    }
    const days = [...new Set([...tripDays(trip), ...itinerary.slots.map(slot => slot.day)])].sort()
    return { slotById, facts, warningsBySlot, days }
  }, [itinerary, trip])

  const value: ItineraryContextValue = {
    tripId: trip.id,
    trip,
    timeZone,
    today,
    travelers: itinerary.travelers,
    currentUserId,
    canEdit,
    members,
    ideas,
    slots: itinerary.slots,
    dismissedDays: itinerary.dismissedDays,
    ...derived,
    density,
    setDensity: next => {
      setDensityState(next)
      document.cookie = `${densityCookieName(currentUserId)}=${next}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`
    },
    expanded,
    setExpanded: (slotId, open) => {
      setExpandedState(current => {
        if (current.has(slotId) === open) return current
        const next = new Set(current)
        if (open) next.add(slotId)
        else next.delete(slotId)
        return next
      })
    },
    sheet,
    openSheet: setSheet,
    closeSheet: () => {
      setSheet(null)
    },
    openSlot: slot => {
      const shape = slotShape(slot)
      if (shape === 'debating') setSheet({ kind: 'compare', slotId: slot.id })
      else if (shape === 'empty' && canEdit) setSheet({ kind: 'add-option', slotId: slot.id })
      else setSheet({ kind: 'slot', slotId: slot.id })
    },
  }

  return <ItineraryContext.Provider value={value}>{children}</ItineraryContext.Provider>
}

export function useItinerary(): ItineraryContextValue {
  const value = useContext(ItineraryContext)
  if (!value) throw new Error('useItinerary needs an ItineraryProvider above it')
  return value
}
