import { eq, sql } from 'drizzle-orm'
import { jobRuns } from '../schema'
import type { Db } from './types'

// job_runs is the one table without a household: a cron job or script works across all of
// them. These take no context, and only cron routes and scripts may call them.

type JobMetadata = Record<string, unknown>

export type JobOutcome = { status: 'succeeded'; metadata?: JobMetadata } | { status: 'failed'; error: unknown; metadata?: JobMetadata }

export async function startJobRun(db: Db, input: { jobName: string; metadata?: JobMetadata }): Promise<{ id: string }> {
  const [row] = await db
    .insert(jobRuns)
    .values({ jobName: input.jobName, metadata: input.metadata ?? {} })
    .returning({ id: jobRuns.id })
  if (!row) throw new Error('Job run insert returned no row')
  return row
}

/** Records how a run ended. A failure stores the error's message only, never the error object. */
export async function finishJobRun(db: Db, id: string, outcome: JobOutcome): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      finishedAt: sql`now()`,
      status: outcome.status,
      error: outcome.status === 'failed' ? errorMessage(outcome.error) : null,
      ...(outcome.metadata ? { metadata: outcome.metadata } : {}),
    })
    .where(eq(jobRuns.id, id))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
