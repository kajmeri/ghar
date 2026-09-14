import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as queries from '@ghar/db/queries';
import type { Db } from '@ghar/db/queries';

/**
 * Whether a request carries `Authorization: Bearer ${CRON_SECRET}`. Always false while the
 * secret is unset, so a missing variable locks cron routes instead of opening them.
 */
export function isCronRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  // Hashing both sides gives timingSafeEqual the equal lengths it needs without leaking length.
  const given = createHash('sha256')
    .update(request.headers.get('authorization') ?? '')
    .digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}

export interface JobReport {
  job: string;
  status: 'succeeded' | 'failed';
  metadata?: Record<string, unknown>;
}

/**
 * Runs one job and records it in job_runs. Never throws: a failed job is recorded and reported,
 * and the caller moves on to the next.
 */
export async function runJob(
  db: Db,
  job: string,
  work: () => Promise<Record<string, unknown>>,
): Promise<JobReport> {
  let runId: string | undefined;
  try {
    runId = (await queries.startJobRun(db, { jobName: job })).id;
    const metadata = await work();
    await queries.finishJobRun(db, runId, { status: 'succeeded', metadata });
    return { job, status: 'succeeded', metadata };
  } catch (error) {
    console.error(`Cron job ${job} failed`, error);
    if (runId !== undefined) {
      await queries
        .finishJobRun(db, runId, { status: 'failed', error })
        .catch((finishError: unknown) => {
          console.error(`Could not record the failure of cron job ${job}`, finishError);
        });
    }
    return { job, status: 'failed' };
  }
}
