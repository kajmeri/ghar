/**
 * The data access layer. Every function here takes a `ctx: RequestContext` and scopes its
 * work to `ctx.householdId`; none of them accept a household id from a caller.
 *
 * Imported by apps/web only. See CLAUDE.md.
 */
export * from './bookings';
export * from './household';
export * from './ideas';
export * from './itinerary';
export * from './packing';
export * from './scope';
export * from './transactions';
export * from './trips';
