/**
 * Seals every stored secret again under ENCRYPTION_KEY, the last step of rotating the key (see
 * "Rotate the encryption key" in docs/runbook.md). Values ENCRYPTION_KEY already opens are left
 * alone, so running it twice changes nothing the second time.
 *
 *   pnpm --filter web secrets:reseal           # reports what it would change, writes nothing
 *   pnpm --filter web secrets:reseal --write
 *
 * Reads DATABASE_URL, ENCRYPTION_KEY and ENCRYPTION_KEY_PREVIOUS from apps/web/.env.local or .env.
 * Prints table names, row ids and counts. Never a secret, sealed or open.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDb } from '@ghar/db'
import * as queries from '@ghar/db/queries'
import { z } from 'zod'
import { DecryptionError, parseEncryptionKey, resealSecret } from '@/lib/crypto'

const resealEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  ENCRYPTION_KEY_PREVIOUS: z.string().min(1).optional(),
})

async function main(): Promise<void> {
  // Existing variables win, and .env.local wins over .env.
  for (const name of ['.env.local', '.env']) {
    const path = fileURLToPath(new URL(`../${name}`, import.meta.url))
    if (existsSync(path)) process.loadEnvFile(path)
  }
  const parsed = resealEnvSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')))
  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map(issue => String(issue.path[0])))
    console.error(`Reseal needs these set: ${[...names].join(', ')}`)
    process.exitCode = 1
    return
  }
  const write = process.argv.includes('--write')
  const keys = {
    current: parseEncryptionKey(parsed.data.ENCRYPTION_KEY),
    previous: parsed.data.ENCRYPTION_KEY_PREVIOUS
      ? parseEncryptionKey(parsed.data.ENCRYPTION_KEY_PREVIOUS, 'ENCRYPTION_KEY_PREVIOUS')
      : null,
  }
  if (!keys.previous) {
    console.log('ENCRYPTION_KEY_PREVIOUS is not set, so this only checks that ENCRYPTION_KEY opens every stored secret.')
  }

  const db = createDb(parsed.data.DATABASE_URL)
  const run = await queries.startJobRun(db, { jobName: 'secrets.reseal', metadata: { write } })
  const counts = { current: 0, resealed: 0, changedMeanwhile: 0, unreadable: 0 }
  try {
    for (const row of await queries.listSealedSecrets(db)) {
      let resealed: string | null
      try {
        resealed = resealSecret(row.sealed, keys)
      } catch (error) {
        if (!(error instanceof DecryptionError)) throw error
        counts.unreadable += 1
        console.error(`Unreadable with either key: ${row.table} ${row.id}. Its owner has to connect it again.`)
        continue
      }
      if (resealed === null) {
        counts.current += 1
      } else if (!write) {
        counts.resealed += 1
      } else if (await queries.replaceSealedSecret(db, { ...row, resealed })) {
        counts.resealed += 1
      } else {
        // Reconnected while this ran, so it was sealed under the new key already.
        counts.changedMeanwhile += 1
      }
    }
    await queries.finishJobRun(db, run.id, { status: 'succeeded', metadata: { write, ...counts } })
  } catch (error) {
    await queries.finishJobRun(db, run.id, { status: 'failed', error, metadata: { write, ...counts } })
    throw error
  }

  console.log(
    `${write ? 'Resealed' : 'Would reseal'} ${String(counts.resealed)}. Already under ENCRYPTION_KEY: ${String(counts.current)}. ` +
      `Changed while running: ${String(counts.changedMeanwhile)}. Unreadable: ${String(counts.unreadable)}.`
  )
  if (counts.unreadable > 0) process.exitCode = 1
  process.exit()
}

await main()
