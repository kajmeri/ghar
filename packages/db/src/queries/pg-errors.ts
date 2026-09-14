/**
 * Whether a unique constraint rejected the write. Drizzle wraps driver errors, so this walks
 * the cause chain. postgres-js names the constraint `constraint_name`, PGlite `constraint`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const fields = current as Record<string, unknown>
    if (fields.code === '23505' && (fields.constraint_name === constraint || fields.constraint === constraint)) {
      return true
    }
    current = fields.cause
  }
  return false
}
