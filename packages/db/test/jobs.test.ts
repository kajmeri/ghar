import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { finishJobRun, startJobRun } from '../src/queries/jobs'
import type { Db } from '../src/queries/types'
import { jobRuns } from '../src/schema'
import { createTestDatabase } from './support/database'

let db: Db

beforeAll(async () => {
  ;({ db } = await createTestDatabase())
})

async function getRun(id: string) {
  const [run] = await db.select().from(jobRuns).where(eq(jobRuns.id, id))
  return run
}

describe('job runs', () => {
  it('starts a run as running with no finish time', async () => {
    const { id } = await startJobRun(db, { jobName: 'test.start', metadata: { batch: 1 } })
    expect(await getRun(id)).toMatchObject({
      jobName: 'test.start',
      status: 'running',
      finishedAt: null,
      error: null,
      metadata: { batch: 1 },
    })
  })

  it('records success and replaces metadata when given', async () => {
    const { id } = await startJobRun(db, { jobName: 'test.success' })
    await finishJobRun(db, id, { status: 'succeeded', metadata: { processed: 3 } })

    const run = await getRun(id)
    expect(run).toMatchObject({ status: 'succeeded', error: null, metadata: { processed: 3 } })
    expect(run?.finishedAt).toBeInstanceOf(Date)
  })

  it('stores only the message of a failure', async () => {
    const { id } = await startJobRun(db, { jobName: 'test.failure', metadata: { batch: 2 } })
    await finishJobRun(db, id, { status: 'failed', error: new Error('Upstream timed out') })

    expect(await getRun(id)).toMatchObject({
      status: 'failed',
      error: 'Upstream timed out',
      metadata: { batch: 2 },
    })
  })
})
