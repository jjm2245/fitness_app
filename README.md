# Fitness Agent

Private, single-user, offline-first training log + deterministic progression
engine (mobile-first installable PWA). Built so far: the exercise/machine graph
+ schema, the deterministic core (volume, volume-load progression, stall
detection, per-machine tracking, substitution filter), and Logging UX — a
**sessions list** home base and **session-model v2**: a session is an ordered,
incremental list of exercises you actually performed (occurrence-based, repeats +
manual reorder), built from a quick-add palette; plus a program/block editor,
cardio logging, a merged tagged/untagged exercise graph (curated + free-exercise-db
library), and custom-exercise + per-exercise machine management. No LLM/vision,
no nutrition/recovery/photos yet (deliberately deferred).

**Docs live in [`docs/`](docs/)** — read them at session start:
[`fitness-agent-spec.md`](docs/fitness-agent-spec.md) (v0.5, source of truth),
[`CODEX-ONBOARDING.md`](docs/CODEX-ONBOARDING.md) (vision/philosophy/process),
[`DECISIONS.md`](docs/DECISIONS.md) (decision log),
[`CURRENT_STATE.md`](docs/CURRENT_STATE.md) (actual repo state — schema, modules,
offline/sync internals, traps).

## Prerequisites

Node 20 and Postgres 16 run inside a dedicated conda environment (this
machine had no Node/Postgres/Docker/Homebrew otherwise):

```bash
conda activate fitness-app
```

## Local Postgres

The DB lives in `.pgdata/` (gitignored), on port 5433 via a Unix socket in
`/tmp` — not a system service, so start/stop it manually:

```bash
pg_ctl -D .pgdata -l .pgdata/logfile -o "-p 5433 -k /tmp" start
pg_ctl -D .pgdata stop
```

`DATABASE_URL` in `.env` already points at it.

## Setup

```bash
npm install
cp .env.example .env    # then fill in DATABASE_URL / APP_PASSCODE / SESSION_SECRET
npm run db:migrate      # apply the schema
npm run db:seed         # curated exercise graph + starter program/blocks (only if none exist)
npm run db:seed:library # ingest the free-exercise-db library (Unlicense; idempotent)
npm run dev              # http://localhost:3000, gated behind APP_PASSCODE
```

## Production deploy

Managed Postgres (Neon recommended, use the *pooled* connection string) +
Vercel. `DATABASE_URL`/`APP_PASSCODE`/`SESSION_SECRET` are set as Vercel project
environment variables, never committed.

**Vercel auto-deploys `main`, but migrations are manual** — so after any schema
change you must bring prod to parity yourself, in this order, against the
production `DATABASE_URL`:

```bash
npm run db:migrate        # apply new migrations
npm run db:seed           # curated graph + net-new/custom exercises (idempotent)
npm run db:seed:library   # ingest library + apply the merge/pairing mapping (idempotent)
```

`db:seed:library` is **required** whenever the exercise-model data changes — it's
easy to forget and leaves the merged names/tags missing. To check what's applied
vs. missing on any database without guessing, run the read-only inspector:

```bash
psql "$DATABASE_URL" -f scripts/inspect-db.sql
```

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for serverless-DB and auth-hardening
details (expiring sessions, brute-force protection on login).

## Tests

```bash
npm test
```

Includes unit tests for the deterministic core (`src/core/*`, no DB needed)
and integration tests for the seed loader and the `programs.ts` CRUD lib
(`src/db/__tests__`, `src/lib/__tests__`; both need Postgres running with the
seed already loaded — the programs tests create/clean up their own test
programs and restore whichever program was active before the run).

## Layout

For the full, current map (schema tables, every core-module contract, the
offline/sync internals, and traps) see
[`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md). The short version:

### Mental model
A **session** is the primitive, not a program. A session is an **ordered list of
performed occurrences** (`session_exercises`, one row per occurrence so the same
exercise can repeat at different positions), each with its own logged sets.
Sessions are identified by a **client-generated id** (offline-created sessions map
1:1 on sync), not a calendar date. Programs/blocks are *optional* quick-add
scaffolding, not the app's identity. Exercises are **tagged vs untagged** (has a
movement pattern → substitutable; the "curated vs library" split is cosmetic).

### Data + core
- `src/db/schema.ts` — Drizzle schema. Load-bearing bits: `workout_logs`
  (`client_session_id`), `session_exercises` (ordered occurrences,
  `client_instance_id`), `set_logs`/`cardio_logs` (link to their occurrence via
  `session_exercise_id`), `exercise_machines` (per-exercise machine list). Cardio
  is a **separate table** so the core (which reads only `set_logs`) can't count it.
- `src/db/seed.ts` + `src/db/seed-data/` — idempotent curated-graph seed (+
  net-new/custom exercises); seeds an initial PPL program **only if none exists**.
  `src/db/seedLibrary.ts` — ingest free-exercise-db + apply the merge mapping.
- `src/core/` — deterministic engine: volume/set-counting, volume-load
  progression + stall detection + load suggestions, stall-buster ladder,
  substitution filter, per-machine tracking. Pure, DB-agnostic, unit-tested. **No
  routine-specific literals — audited clean, self-check every session.**
- `src/lib/coreAdapters.ts` — maps DB rows → the core's plain types.
- `src/lib/programs.ts` — the only read/write path for programs/days/exercises.
- `src/lib/sessionStore.ts` — **the offline layer**: IndexedDB store, the outbox
  + serialized `sync()`, failure classification (auth/network/server), server
  hydration, and the offline session-delete queue. The UI reads from here, never
  a network round-trip. (This replaced the old `offlineQueue.ts`.)
- `src/lib/auth.ts` (expiring signed session, Web Crypto so it works in the Edge
  proxy) + `src/lib/rateLimit.ts` (per-IP login brute-force protection).

### App
- `src/app/sessions` — **home base**: merged local+server session list, start an
  (empty) session, delete-with-confirm.
- `src/app/log/[id]` — the logging screen: a persistent one-tap **quick-add
  palette** (program days/blocks + ad-hoc search), an **ordered occurrence list**
  with up/down reorder + remove, per-occurrence sets, collapsible cards, and a
  finish summary. Offline-first. (`/log` with no id redirects to `/sessions`.)
- `src/app/exercises` — custom-exercise management: badges the three naming kinds,
  rename, adopt-library-name, **collapse-to-library** (re-points logged history),
  and per-exercise machine add/edit/remove.
- `src/app/program`, `src/app/blocks` — program + reusable-block editors.
- `src/app/api/` — thin routes: `sessions`(+`/[id]` GET/DELETE, `/finish`),
  `session-exercises`, `set-logs`(+`/[id]`), `cardio-logs`(+`/[id]`),
  `exercises`(+`/search`,`/custom`,`/manage`,`/[id]` PATCH,`/[id]/collapse`,
  `/[id]/machines`,`/[id]/last-session`), `machines`(+`/[id]`), `program`,
  `programs`/`[id]`/`[id]/days`, `program-days/[id]`(+`/move`,`/exercises`),
  `program-exercises/[id]`(+`/move`), `blocks`, `progression`, `substitutions`,
  `auth/login`.
- `src/proxy.ts` — device-passcode gate (Next 16's "proxy", formerly
  "middleware"). Returns **401 JSON** for `/api/*`, redirects pages to `/login`.
- `public/sw.js` — service worker: offline app-shell + outbox-friendly fetch
  handling (reconstructs redirected navigations so an expired session doesn't
  brick the installed PWA).
