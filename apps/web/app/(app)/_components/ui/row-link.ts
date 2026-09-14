/**
 * Stretches a link in a list row over the whole row, so the row is one big tap target. The row
 * needs `relative`; any button inside it needs `relative z-10` to stay above the link.
 */
export const ROW_LINK =
  'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset'
