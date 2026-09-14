import 'server-only'
import { describeError, ValidationError } from '@ghar/core/errors'
import { unstable_rethrow } from 'next/navigation'
import type { z } from 'zod'
import type { ActionState } from './state'

/**
 * Runs a server action's work and turns what it throws into form state through the same
 * describeError the API uses. redirect() and notFound() pass through untouched.
 */
export async function runAction(formData: FormData, work: () => Promise<string | undefined>): Promise<ActionState> {
  try {
    const message = await work()
    return { status: 'success', message: message ?? '' }
  } catch (error) {
    unstable_rethrow(error)
    const described = describeError(error)
    if (!described.expected) console.error('Unhandled error in server action', error)
    return {
      status: 'error',
      message: described.message,
      fieldErrors: fieldErrors(described.details),
      values: formValues(formData),
    }
  }
}

/** Parses a form with a contract schema. Failures name the field, like the API's do. */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): z.output<S> {
  const result = schema.safeParse(formValues(formData))
  if (!result.success) {
    throw new ValidationError('Check the highlighted fields.', {
      details: result.error.issues.map(({ path, message }) => ({
        path: path.map(String),
        message,
      })),
    })
  }
  return result.data
}

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of formData) {
    // Next adds $ACTION_* fields of its own.
    if (typeof value === 'string' && !key.startsWith('$')) values[key] = value
  }
  return values
}

/**
 * Reads field errors in both shapes: zod issues from parseForm (`[{ path, message }]`) and core's
 * validators (`{ fieldErrors: { field: [message] } }`). The first message per field wins.
 */
function fieldErrors(details: unknown): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  if (typeof details === 'object' && details !== null && 'fieldErrors' in details) {
    const byField = details.fieldErrors
    if (typeof byField !== 'object' || byField === null) return errors
    for (const [field, messages] of Object.entries(byField)) {
      const first: unknown = Array.isArray(messages) ? (messages as unknown[])[0] : undefined
      if (typeof first === 'string') errors[field] = first
    }
    return errors
  }
  if (!Array.isArray(details)) return errors
  for (const detail of details as unknown[]) {
    if (typeof detail !== 'object' || detail === null) continue
    const { path, message } = detail as { path?: unknown; message?: unknown }
    const field = Array.isArray(path) ? (path as unknown[]).at(-1) : undefined
    if (typeof field === 'string' && typeof message === 'string') errors[field] ??= message
  }
  return errors
}
