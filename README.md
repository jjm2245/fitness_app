# Fitness Agent

Private, single-user training log + progression engine. Built so far:
Milestones 1-2 (schema, seed data, deterministic core), Milestone 4 (logging
UX), and Session 4b (program editor + logging redesign — the routine is now
user-owned editable data, not a seeded default; logging shows previous-session
numbers, guideline-not-law targets, inline machine tagging, and a
deterministic swap affordance). No LLM, no nutrition/recovery/photos yet. See
`DECISIONS.md` for the choices made and why.

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
Vercel. `DATABASE_URL`/`APP_PASSCODE`/`SESSION_SECRET` are set as Vercel
project environment variables, never committed. Run `npm run db:migrate` and
`npm run db:seed` manually against the production `DATABASE_URL` after each
schema change — not wired into the build. See `DECISIONS.md` for the
serverless-DB and auth-hardening details (expiring sessions, brute-force
protection on login).

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

- `src/db/schema.ts` — Drizzle schema (spec §6). `program_days` is real,
  ordered, renameable data; `program_exercises.day_id` is a real FK (not a
  free-text tag).
- `src/db/seed.ts` + `src/db/seed-data/` — idempotent seed loader for the
  exercise graph; seeds an initial PPL program **only if no program exists
  yet** (`npm run db:seed` never overwrites an edited program).
- `src/core/` — deterministic engine: volume/set-counting, volume-load
  progression + stall detection + load suggestions, stall-buster ladder,
  substitution filter, per-machine tracking. Pure functions, DB-agnostic,
  unit-tested. No routine-specific literals — audited clean, kept that way.
- `src/lib/programs.ts` — the only read/write path for
  programs/program_days/program_exercises; used by both the editor API routes
  and the seed script. Integration-tested (`src/lib/__tests__`).
- `src/lib/coreAdapters.ts` — maps DB rows to the core's plain types.
- `src/lib/auth.ts` — expiring, signed session tokens (separate
  `SESSION_SECRET` from `APP_PASSCODE`); `src/lib/rateLimit.ts` — per-IP
  brute-force protection on login, backed by the `login_attempts` table.
- `src/app/api/` — thin routes wiring the core to Postgres: `exercises`,
  `program` (read the active program, days pre-sorted), `programs`/
  `programs/[id]`/`programs/[id]/days`, `program-days/[id]` (+`/move`,
  `/exercises`), `program-exercises/[id]` (+`/move`), `machines`,
  `exercises/[id]/last-session`, `set-logs`, `progression`, `substitutions`,
  `auth/login`.
- `src/app/program` — program editor: create/rename/delete/activate programs;
  add/rename/delete/reorder (up/down) days; add exercises with per-exercise
  editable targets, reorder/remove.
- `src/app/log` — day-based session logging: previous-session reference,
  target shown as a guideline chip, inline machine tagging (select + one-tap
  add), a deterministic "Swap" affordance, offline-capable via the IndexedDB
  outbox in `src/lib/offlineQueue.ts`. No UI polish.
- `src/proxy.ts` — device-passcode gate (Next 16's "proxy", formerly
  "middleware").
