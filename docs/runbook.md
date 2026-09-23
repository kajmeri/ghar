# Runbook

What to do when something in production needs a hand. Each procedure says how you'd know you need
it, what to run, and how to confirm it worked.

Production is the Vercel project rooted at `apps/web`, backed by Supabase Postgres. SQL below runs in
the Supabase SQL editor, which connects as a role that bypasses RLS, so every statement names the rows
it touches. Nothing here needs a secret pasted into a chat, a ticket or shell history.

- [Monitoring and alerts](#monitoring-and-alerts)
- [Rotate the encryption key](#rotate-the-encryption-key)
- [Reconnect a broken Plaid item](#reconnect-a-broken-plaid-item)
- [Recover a failed sync](#recover-a-failed-sync)
- [Revoke API tokens](#revoke-api-tokens)

## Monitoring and alerts

Errors go through one adapter, `apps/web/lib/providers/monitoring`. With no DSN set it's a fake that
writes one redacted `[monitoring] …` line to the Vercel logs. Every report and alert passes through
`scrub.ts` first: no request bodies, query strings, cookies, tokens or email addresses, and token
segments in paths (like `/a/<token>`) are replaced.

| Variable                 | What it turns on                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `SENTRY_DSN`             | Server errors to Sentry: API routes, server actions, rendering, and cron failures with their job |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser errors that the server never saw. Read at build time, so changing it needs a redeploy    |
| `SENTRY_ENVIRONMENT`     | Optional. Defaults to `VERCEL_ENV`                                                               |
| `ALERT_EMAIL`            | Where cron failure emails go. Needs `RESEND_API_KEY` too, or nothing is sent                     |

No source maps are uploaded and no Sentry build plugin runs. Stack traces in Sentry point at built
code.

A bad value in one of these doesn't stop monitoring from starting (it's ignored with a warning naming
the variable), but `env()` still rejects it, so the app itself fails loudly.

### Sentry cron monitor

Create a cron monitor in Sentry so a run that never happens is noticed too:

- Slug `daily-cron`, crontab `0 11 * * *`, UTC (the schedule in `apps/web/vercel.json`).
- Check-in margin about 5 minutes, max runtime about 6 minutes (the route's `maxDuration` is 300 s).
- Alert on missed and failed check-ins.

This monitor is the only thing that catches a run that never started (a broken deploy, cron disabled)
or one Vercel killed at `maxDuration`. The alert email can't: the code that sends it never ran. Without
Sentry, those show up only as a `job_runs` row stuck in `running`, or no row at all.

### What a failed cron run looks like

- `/api/cron/daily` answers 500.
- The job's `job_runs` row has `status = 'failed'` and an `error`.
- A Sentry issue tagged `job` and `job_run_id`, and the `daily-cron` monitor marks the check-in as an
  error.
- An email to `ALERT_EMAIL` titled `Cron failed: <job>`, with the time, the `job_runs` id and a
  one-line redacted error. No stack.
- A `[monitoring] … (job=…)` line in the Vercel logs.

A failure outside any job, such as a database that won't connect, is reported and emailed as
`cron.daily`, and the email says no `job_runs` row was written.

A request with a wrong or missing `CRON_SECRET` gets a 401 and nothing else: no report, no alert, no
check-in. So a burst of 401s in the logs isn't an outage, and a stranger can't set off alerts.

Next: [Recover a failed sync](#recover-a-failed-sync).

## Rotate the encryption key

`ENCRYPTION_KEY` (32 bytes, base64) protects these with AES-256-GCM through `apps/web/lib/crypto.ts`:

| What                                  | Where                                              | After a rotation                                                        |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Plaid access tokens                   | `plaid_items.access_token_encrypted`               | Sealed again by the reseal script                                       |
| Google Calendar refresh tokens        | `calendar_links.refresh_token_encrypted`           | Sealed again by the reseal script                                       |
| Gmail refresh tokens                  | `mail_links.refresh_token_encrypted`               | Sealed again by the reseal script                                       |
| OAuth state while linking Google on the web | A browser cookie that lasts 10 minutes       | Still opens while `ENCRYPTION_KEY_PREVIOUS` is set                      |
| OAuth state while linking from the phone | Signed with a key derived from it (`lib/oauth-state.ts`), 10 minutes | Fails. Anyone mid-link starts again                   |
| One-tap links in digest emails        | Signed with a key derived from it (`lib/one-tap.ts`) | Stop working and open to "This link isn’t valid". The next digest has new ones |

API tokens are stored as SHA-256 hashes and don't involve the key. Browser sessions belong to
Supabase Auth.

Rotate when the key may have been exposed: a leaked env file, a lost laptop, someone with Vercel access
leaving.

### Steps

1. Generate the new key somewhere private:

   ```bash
   openssl rand -base64 32
   ```

2. In Vercel → Settings → Environment Variables, for every environment that uses the production
   database, set `ENCRYPTION_KEY_PREVIOUS` to the current `ENCRYPTION_KEY` value, then set
   `ENCRYPTION_KEY` to the new key. Redeploy.

   From this deploy on, new secrets are sealed under the new key, and opening a stored secret tries the
   new key and then the previous one. Nothing breaks while stored values are still sealed under the old
   key.

3. On a trusted machine, put production's `DATABASE_URL`, `ENCRYPTION_KEY` and
   `ENCRYPTION_KEY_PREVIOUS` in `apps/web/.env.local`. Variables already set in the shell win over the
   file. Do a dry run:

   ```bash
   pnpm --filter web secrets:reseal
   ```

   It prints counts, table names and row ids, never a secret:
   `Would reseal N. Already under ENCRYPTION_KEY: N. Changed while running: N. Unreadable: N.`

   If most rows are unreadable, the keys in `.env.local` are wrong. Stop and fix them before going on.

4. Write:

   ```bash
   pnpm --filter web secrets:reseal --write
   ```

   A row is replaced only while it still holds the value the script read, so someone reconnecting at
   the same moment is never overwritten. Those rows count as "Changed while running". Running the
   script again is harmless: anything already under the new key is left alone.

5. Run the dry run again. Expect `Would reseal 0` and `Unreadable: 0`.

6. Remove `ENCRYPTION_KEY_PREVIOUS` from Vercel and redeploy. Delete the production values from
   `.env.local`.

Each run records a `job_runs` row with its counts:

```sql
select started_at, status, error, metadata
from job_runs
where job_name = 'secrets.reseal'
order by started_at desc
limit 5;
```

### If some rows are unreadable

A handful of unreadable rows, with the right keys in place, were sealed under some third key, usually
because the key was once changed without this procedure. Those secrets are gone. The script exits
with status 1 and prints `table id` for each one.

- **Calendar and Gmail links recover through the person.** The next sync that can't open a token marks
  the link `needs_reconnect`, and the person is asked to link it again (on the Calendar page, or at
  Travel → Bookings → Review for Gmail).
- **A Plaid item can't use update mode without its access token.** It has to be connected as a new
  item. See [Reconnect a broken Plaid item](#reconnect-a-broken-plaid-item).

`--write` only touches rows it could open, so finish the rotation anyway.

### If the old key leaked along with the database

Resealing changes the ciphertext, not the tokens inside it. If whoever had the old key could also read
the database, treat the tokens themselves as exposed:

- Ask each person to remove Ghar at <https://myaccount.google.com/permissions>, then link Calendar
  and Gmail again.
- Rotate each Plaid access token with Plaid's `/item/access_token/invalidate`, store the new one
  sealed, then run the reseal check again. This needs the Plaid adapter, which isn't built yet.

## Reconnect a broken Plaid item

**Where things stand.** The bank data layer in `@ghar/db` is built and tested: `plaid_items`,
`accounts`, `transactions`, `applyTransactionSync` and `setBankItemState`. `apps/web` doesn't yet have
a Plaid provider adapter, a Link flow, a webhook route or a bank sync job. So nothing in production
marks an item `login_required` today, and there is no reconnect button.

This section is the procedure the data layer is built for. Whoever wires up Plaid should follow it,
and it also covers repairing an item that was created by hand.

### Find broken items

```sql
select id, household_id, environment, institution_name, status, error_code,
       consent_expires_at, last_synced_at
from plaid_items
where status <> 'good'
   or consent_expires_at < now() + interval '7 days'
order by last_synced_at nulls first;
```

- **`login_required`** means the institution needs the person again: Plaid's `ITEM_LOGIN_REQUIRED` or
  `PENDING_EXPIRATION`, or consent expiring. Only the person can fix it, in Link update mode.
- **`error`** means the last sync failed for another reason; `error_code` holds Plaid's code. Retry the
  sync before involving anyone.

An item's status history:

```sql
select created_at, actor_user_id, action, metadata
from audit_log
where entity = 'plaid_item' and entity_id = '<plaid_items.id>'
order by created_at desc;
```

### Reconnect

Don't delete the row, and don't create a second item for the same login:

- Rows are kept for history.
- A new item starts without a cursor and duplicates the accounts.
- Production items count against Plaid's lifetime allowance (`countBankItemsByEnvironment`), and
  deleting one doesn't give it back.

1. On the server, load the item with `getBankItemCredentials` (needs `finances.manage`) and open the
   token with `openSecret`.
2. Create a Link token in update mode by passing that `access_token` to `/link/token/create`. Only the
   Link token goes to the browser; the access token never does.
3. The person completes Link. Update mode keeps the same item id and access token, so there is nothing
   new to store.
4. Record the change:

   ```ts
   setBankItemState(ctx, db, {
     itemId,
     change: 'reconnected',
     state: { status: 'good', errorCode: null, consentExpiresAt },
   })
   ```

   This writes a `bank.status_changed` row to `audit_log`.

5. Run a transactions sync from the stored `cursor`. `applyTransactionSync` moves the cursor only when
   every change has landed. It refuses with a conflict if another sync moved the cursor first, so
   running it twice is safe.

If Plaid answers `ITEM_NOT_FOUND` or `INVALID_ACCESS_TOKEN`, update mode can't help. Connect the
institution as a new item and keep the old row as history. Set the old row's state to `error` with
that code so it's clear why it stopped.

## Recover a failed sync

### How you find out

- `/api/cron/daily` answers 500 when any job failed. That job's `job_runs` row has `status = 'failed'`
  and an `error` message, and you get the Sentry issue and alert email described in
  [What a failed cron run looks like](#what-a-failed-cron-run-looks-like).
- One calendar or inbox failing doesn't fail the job, so it doesn't alert. The job succeeds, and its `metadata` counts
  `errors` and `needsReconnect`. The link's own row has `status` and `last_error`.

### Look at the last runs

```sql
select distinct on (job_name)
       job_name, status, started_at, finished_at - started_at as took, error, metadata
from job_runs
order by job_name, started_at desc;
```

A run that never finished (the function hit its 300-second `maxDuration`, or crashed) stays `running`
forever. Find and close those runs so the history reads correctly:

```sql
update job_runs
set status = 'failed', finished_at = now(), error = 'Did not finish. Closed by hand.'
where status = 'running' and started_at < now() - interval '15 minutes'
returning id, job_name, started_at;
```

### Run the daily jobs again

Every job in `/api/cron/daily` is safe to repeat:

- The price watch never emails twice about the same drop.
- The calendar sync asks Google only for what changed.
- The Gmail check never reads a message twice.
- Expiry reminders are claimed before they're sent.

To re-run, press Run next to the job in Vercel → Settings → Cron Jobs, or call the route with
`CRON_SECRET` exported in your shell rather than typed into the command:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<production-domain>/api/cron/daily
```

The response lists each job with its status and counts.

When a job fails on every run with the same error, the cause is usually configuration. The calendar
and Gmail jobs set up their provider once per run, so a missing `GOOGLE_CLIENT_ID` or
`ANTHROPIC_API_KEY` fails the whole job instead of each link. Fix the variable in Vercel, redeploy,
and run the jobs again.

### Calendar (`calendar.sync`)

```sql
select id, household_id, user_id, status, last_error, last_synced_at,
       sync_token is not null as incremental
from calendar_links
where status <> 'active' or last_synced_at is null or last_synced_at < now() - interval '2 days'
order by last_synced_at nulls first;
```

| `status`          | Meaning                                                                                                                                                                             | What to do                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`           | The last sync failed for a passing reason. `last_error` says why, in Ghar's words.                                                                                                  | Nothing. The next run retries. To retry now, sync from the Calendar page, or call `POST /api/v1/calendar/sync` as a member.                                                                                 |
| `needs_reconnect` | Google refused the refresh token. Access was removed, the password changed, the 7-day limit on a consent screen in Testing ran out, or the token didn't open after a key change. | Syncing has stopped for this link. The person links the same calendar again from the Calendar page. That replaces the token and sets `active`, and keeps the sync token and events, so the next sync carries on. |

A Google `410 Gone` (sync token expired) needs nothing from you. The sync drops the token and lists
everything again from 90 days back, which also removes events deleted in the meantime.

If a calendar's events look wrong (some missing, or deleted ones still showing), force that same full
relist for one link, then sync:

```sql
update calendar_links set sync_token = null, updated_at = now() where id = '<calendar_links.id>';
```

### Gmail (`mail.booking_ingest`)

```sql
select id, household_id, user_id, status, last_error, last_checked_at
from mail_links
order by last_checked_at nulls first;
```

- **A failed check** leaves `status = 'active'` with `last_error` set, and the next run retries. The
  search start, `last_checked_at`, moves on only after a check that settled everything it found, so a
  failure never skips mail.
- **`metadata.incomplete`** counts inboxes whose check stopped early, either at the cron run's
  150-second budget or at the per-run read cap. The next run continues from there.
- **`metadata.failedMessages`** counts messages the model couldn't turn into a booking. Later runs try
  each one again, up to `MAIL_MAX_ATTEMPTS` (3) reads in total, then leave it alone.
- **`needs_reconnect`** means Google refused the token, and checks stop. The person links Gmail again
  at Travel → Bookings → Review. Relinking keeps `last_checked_at` and the record of messages already
  read, so nothing is read twice.
- **To check now**, press Check mail on that page, or call `POST /api/v1/mail/check` as that person.
  It checks only the caller's own inbox.

What the ledger made of a person's mail:

```sql
select outcome, count(*), max(attempts)
from mail_messages
where user_id = '<user id>'
group by outcome;
```

While debugging, use counts, ids and `last_error`. `mail_messages` stores message ids and outcomes,
not contents. Don't open anyone's mail to investigate.

### Bank transactions

No bank sync runs yet. See [Reconnect a broken Plaid item](#reconnect-a-broken-plaid-item).

### The phone app's copy (`GET /api/v1/sync`)

The phone's delta sync keeps no state on the server: its position lives in the `since` cursor the
phone holds. So recovery is almost always on the phone, and there's nothing to reset server side. How
it works is in [architecture.md](architecture.md#delta-sync).

| What happened                                        | What the phone does                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A page failed (network, 5xx)                         | Retry with the same `since`. Retries are always safe.                                 |
| The response says `resync: true`                     | The person's role, household or account changed. Wipe the local copy and follow the returned `nextSince` from the start. |
| `since` was rejected as invalid                      | The cursor is corrupt. Wipe the local copy and call without `since`.                  |
| Local data looks wrong but syncing succeeds          | Drop the stored cursor and do a full sync.                                            |

When one kind of record never arrives on phones after it changes, suspect a missing trigger, not the
phone. Every syncable table needs its `updated_at` trigger and its delete trigger. Check that the
latest migration is applied, then:

```sql
select event_object_table as table_name, string_agg(distinct trigger_name, ', ') as triggers
from information_schema.triggers
where trigger_schema = 'public'
group by event_object_table
order by table_name;
```

A row changed while its trigger was missing won't sync until it changes again. After restoring the
trigger, touch the affected rows so they're sent (`update <table> set updated_at = now() where
household_id = '<id>'`; for tables under a trip, filter by `trip_id`), or have the household's phones
do a full sync.

Cursors hold household and user ids. Don't paste them into logs or tickets.

## Revoke API tokens

The phone app signs in with API tokens, not cookies:

- **Access token** (`ghar_at_…`): lasts one hour.
- **Refresh token** (`ghar_rt_…`): lasts 60 days from each refresh.

Only SHA-256 hashes are stored, in `api_tokens`. Each sign-in starts a family, and each refresh adds a
row to that family. Presenting a refresh token that was already used revokes the whole family.

A person's signed-in devices:

```sql
select family_id, household_id, min(created_at) as signed_in, max(last_used_at) as last_used
from api_tokens
where user_id = '<auth user id>' and revoked_at is null
group by family_id, household_id;
```

Sign out one device:

```sql
update api_tokens set revoked_at = now() where family_id = '<family_id>' and revoked_at is null;
```

Sign out all of a person's devices:

```sql
update api_tokens set revoked_at = now()
where revoked_at is null
  and user_id = (select id from auth.users where email = '<email>');
```

Either one takes effect on the device's next request. Revoking API tokens doesn't end browser
sessions, which Supabase Auth manages.
