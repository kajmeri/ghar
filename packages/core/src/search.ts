// Search for the lists a person scans while standing in front of something: contacts, assets,
// documents. Every word typed has to appear somewhere in the row, in any order, ignoring case and
// accents. A run of digits also matches a phone or serial number however it was punctuated.

function fold(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

export function searchTokens(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

const NUMBERISH = /^[\d+().\-/]+$/

/** Whether every word of `query` appears in one of the fields. An empty query matches everything. */
export function matchesSearch(fields: readonly (string | null | undefined)[], query: string): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const present = fields.filter((field): field is string => typeof field === 'string' && field !== '').map(fold)
  return tokens.every(token => {
    if (present.some(field => field.includes(token))) return true
    if (!NUMBERISH.test(token)) return false
    const digits = token.replace(/\D/g, '')
    return digits.length >= 3 && present.some(field => field.replace(/\D/g, '').includes(digits))
  })
}
