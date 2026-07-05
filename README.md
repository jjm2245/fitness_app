# Fitness Agent

Private, single-user training log + progression engine. Built so far:
Milestones 1-2 from `fitness-agent-spec.md` (schema, seed data, deterministic
core) and Milestone 4 (logging UX — a default program, day-based session
logging, live progression/stall-buster feedback, auto machine registration).
No LLM, no nutrition/recovery/photos yet. See `DECISIONS.md` for the choices
made and why.

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
npm run db:migrate   # apply the schema
npm run db:seed      # load pf-exercise-seed.json into exercises/muscles/substitutions
npm run dev           # http://localhost:3000, gated behind APP_PASSCODE (.env)
```

## Tests

```bash
npm test
```

Includes unit tests for the deterministic core (`src/core/*`, no DB needed)
and an integration test for the seed loader (`src/db/__tests__`, needs
Postgres running with the seed already loaded).

## Layout

- `src/db/schema.ts` — Drizzle schema (spec §6).
- `src/db/seed.ts` + `src/db/seed-data/` — idempotent seed loader; also seeds a
  default Program from the current routine (`ppl_pf_current_routine`).
- `src/core/` — deterministic engine: volume/set-counting, volume-load
  progression + stall detection + load suggestions, stall-buster ladder,
  substitution filter, per-machine tracking. Pure functions, DB-agnostic,
  unit-tested.
- `src/lib/coreAdapters.ts` — maps DB rows to the core's plain types.
- `src/app/api/` — thin routes wiring the core to Postgres (`exercises`,
  `program`, `set-logs`, `progression`, `substitutions`, `auth/login`).
- `src/app/log` — day-based session logging page: pick a day, see prescribed
  exercises + targets, log sets fast, get live progression/stall-buster
  feedback. Offline-capable via the IndexedDB outbox in
  `src/lib/offlineQueue.ts`. No UI polish.
- `src/proxy.ts` — device-passcode gate (Next 16's "proxy", formerly
  "middleware").
