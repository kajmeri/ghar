# Ghar

A private household operations app for one family. Finances, calendar, travel,
documents, and home maintenance in one place. Not a SaaS product. No public signup,
no billing, no marketing pages.

## Stack

- pnpm workspaces + Turborepo monorepo
- Next.js (App Router) + TypeScript, strict mode
- Tailwind + shadcn/ui, heavily restyled (see Design)
- Supabase Postgres, accessed via Drizzle ORM
- Supabase Auth (email magic link, custom SMTP through Resend)
- Vercel hosting (root directory `apps/web`), Vercel Cron
- Resend for all outbound email
- Anthropic API (claude-haiku) for categorization and email parsing
- Zod for every external boundary: API input, LLM output, third-party responses
- Expo + React Native for `apps/mobile`, later

## Workspace layout and package boundaries

apps/web Next.js. UI, API routes, cron, all I/O and integrations. apps/mobile Expo. A client of apps/web's API. Nothing else. packages/contracts Zod schemas + inferred types + typed fetch client. Isomorphic. packages/core Pure domain logic. No I/O, no Node APIs, no React. Isomorphic. packages/db Drizzle schema, migrations, query functions. SERVER ONLY. packages/tokens Design tokens, one JSON source, emits CSS vars and a JS object. packages/config Shared tsconfig bases.

Rules about these boundaries, in priority order:

- `@ghar/core` and `@ghar/contracts` must import nothing from `node:*`, `next/*`,
  `react`, `@ghar/db`, or any SDK. If you reach for one of those, the code belongs in
  `apps/web` instead. This is enforced by oxlint's `no-restricted-imports` rule
  (root `.oxlintrc.json`). Do not disable the rule; move the code.
- `@ghar/db` is imported by `apps/web` only. Never by mobile, never by core.
- Decide placement by purity, not by topic. The price-drop threshold math and the
  `isActionable` fare-rule table are pure, so they go in `core`. The Travelpayouts
  fetch that feeds them is I/O, so it goes in `apps/web/lib/providers`.
- Packages ship TypeScript source, consumed through `transpilePackages` in Next and
  Metro's `watchFolders` in Expo. No build step for workspace packages.
- Adding a dependency to `core` or `contracts` requires a reason. Zod and date-fns are
  fine. An SDK is a sign the code is in the wrong package.

## Non-negotiable architecture rules

1. **Every query is household-scoped.** No data access function may be called without
   a `ctx: RequestContext` containing `{ userId, householdId, role }`. Never pass a
   raw `householdId` from a request body or query param; always derive it server-side
   from the session. Postgres RLS is enabled as a backstop, but the data access layer
   is the real boundary.

2. **Business logic never lives in components or route handlers.** Route handlers
   parse, authorize, call into `@ghar/core` or `packages/db`, and serialize. Pure
   rules go in `core`; orchestration and I/O go in `apps/web/lib`.

3. **The API is the mobile boundary.** Every feature must be fully reachable through
   `app/api/v1/`, with request and response schemas from `@ghar/contracts`. Server
   actions are allowed only for simple form mutations a phone client will never need.
   If a capability exists only as a server action, it doesn't exist as far as the
   mobile app is concerned.

4. **Money is integer cents, always.** Column type `bigint`. Never float, never
   `numeric` in app code. A `formatCents` helper in `@ghar/core/money` is the only place
   that turns cents into a display string.

5. **Dates:** store UTC timestamptz. Store calendar dates that have no time (a
   transaction date, a trip start) as `date`. Every household has a timezone; render
   in it.

6. **Secrets and tokens at rest** (Plaid access tokens, Google refresh tokens) are
   encrypted with AES-256-GCM using `ENCRYPTION_KEY` from env, via
   `apps/web/lib/crypto.ts`. Never store them in plaintext, never log them, never return
   them from an API route.

7. **Cron routes** verify `Authorization: Bearer ${CRON_SECRET}` before doing
   anything, are idempotent, and write a row to `job_runs` recording started/finished
   time, status, and an error string. A job that fails must not take the others down.

8. **Third-party calls** go through a thin adapter in `apps/web/lib/providers/<name>.ts` that
   returns a domain type, never the vendor's raw shape. Every adapter has a fake
   implementation for tests and for local dev without keys.

## Code conventions

- Server Components by default. `"use client"` only where interaction requires it.
- No `any`. No non-null assertions on external data.
- Colocate: `apps/web/app/(app)/finances/_components/`, not a global components dump.
- Errors: throw typed errors from `@ghar/core/errors`; route handlers map them to status
  codes in one place.
- Migrations: Drizzle Kit, checked into `packages/db/drizzle/`. Never edit an applied
  migration.
- Every new feature ships with its empty state and its loading state. Not optional.
- Turbo tasks: `build`, `dev`, `lint`, `typecheck`, `test`, `db:generate`,
  `db:migrate`. Correct `dependsOn` and `outputs` so caching actually works.

## Design

Mobile-first. The phone layout is the real product; desktop is the phone layout with
room to breathe. Never design desktop-first and shrink.

- Mobile: fixed bottom tab bar, max 5 destinations, safe-area insets respected,
  44px minimum tap target, no horizontal scrolling tables anywhere. Tabular data
  becomes stacked cards below `md`.
- Desktop: persistent left sidebar, content max-width 1100px, no full-bleed dashboards.

**Palette.** Defined once in `packages/tokens/tokens.json` and generated out to CSS
custom properties for web and a typed object for React Native. Never hardcode a hex
value in a component, in either app. Color is semantic only: interface chrome is
monochrome, and color appears only when it carries meaning about money or state.

- `--paper` #FBFBF9 (app background)
- `--surface` #FFFFFF (cards)
- `--ink` #14161A (primary text)
- `--ink-muted` #6B6F76 (secondary text)
- `--line` #E4E4DF (borders, hairlines)
- `--positive` #3F5D4B (under budget, saved, income)
- `--caution` #C9922E (approaching a limit, action needed)
- `--negative` #A8442A (over budget, price increase, overdue)

No gradients. No colored buttons for neutral actions; the primary button is `--ink`.

**Type.** One family: Public Sans, variable. Personality comes from the numerals, not
from a display serif. Large amounts use the expanded-ish treatment: 600 weight, -0.02em
tracking, `font-variant-numeric: tabular-nums`. All figures everywhere are tabular so
columns align. Sentence case throughout. No all-caps eyebrow labels above headings.

**Structure.** Border radius varies by hierarchy on purpose: 12px cards, 8px inputs and
buttons, 999px pills. One hairline border, no drop shadows except on overlays. Motion
only in response to a user action.

**Copy.** Plain and active. "Save changes", not "Submit". Empty states say what to do
next, not "No data found".
