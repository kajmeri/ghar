import { pgEnum } from 'drizzle-orm/pg-core';

/** Who may write in a household. Mirrors householdRoleSchema in @casa/contracts. */
export const householdRole = pgEnum('household_role', ['owner', 'member']);

/**
 * Where a trip is in its life. `past` is stored, not derived, so a trip can be filed away
 * early; @casa/core's `settleTripStatus` is what moves a finished trip into it.
 */
export const tripStatus = pgEnum('trip_status', ['idea', 'planned', 'booked', 'past']);

/** The shape of one row on a day's timeline. */
export const itineraryItemKind = pgEnum('itinerary_item_kind', [
  'flight',
  'lodging',
  'activity',
  'meal',
  'transport',
  'note',
]);

/** What was reserved. Wider than itineraryItemKind: a car rental is a booking, not a timeline shape. */
export const bookingKind = pgEnum('booking_kind', [
  'flight',
  'lodging',
  'car',
  'rail',
  'activity',
  'other',
]);
