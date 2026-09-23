/**
 * Stretches a link in a list row over the whole row, so the row is one big tap target. The row
 * needs `relative`; any button inside it needs `relative z-10` to stay above the link.
 */
export const ROW_LINK =
  'after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset'
