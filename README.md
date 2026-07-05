# Fitness Agent

Private, single-user training log + progression engine. This session builds
Milestones 1-2 from `fitness-agent-spec.md`: schema, seed data, and the
deterministic core (no LLM, no nutrition/recovery/photos yet). See
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
- `src/db/seed.ts` + `src/db/seed-data/` — idempotent seed loader.
- `src/core/` — deterministic engine: volume/set-counting, volume-load
  progression + stall detection, substitution filter, per-machine tracking.
  Pure functions, DB-agnostic, unit-tested.
- `src/lib/coreAdapters.ts` — maps DB rows to the core's plain types.
- `src/app/api/` — thin routes wiring the core to Postgres (`exercises`,
  `set-logs`, `progression`, `substitutions`, `auth/login`).
- `src/app/log` — minimal offline-capable logging page (IndexedDB outbox via
  `src/lib/offlineQueue.ts`), no UI polish.
- `src/proxy.ts` — device-passcode gate (Next 16's "proxy", formerly
  "middleware").
