# Decisions log

Running record of choices made while building Milestones 1-2 (spec §15) and
anywhere this session's implementation deviates from or fills a gap in
`fitness-agent-spec.md`. Newest at the bottom.

## Environment & runtime

- **No Node, Postgres, Docker, or Homebrew were present on this machine** — only
  Anaconda's Python/conda. Rather than install Homebrew (a whole new package
  manager) or require Docker, Node 20 and Postgres 16 were installed into a
  dedicated conda environment: `conda create -n fitness-app -c conda-forge
  nodejs=20 postgresql=16`. User confirmed this approach explicitly.
- Postgres runs as a plain local data directory at `.pgdata/` (gitignored), not
  a system service. It listens on **port 5433** (not the default 5432, to
  avoid clashing with any future system Postgres) via a Unix socket in `/tmp`.
  To start it: `conda activate fitness-app && pg_ctl -D .pgdata -l
  .pgdata/logfile -o "-p 5433 -k /tmp" start` (stop with `... stop`).
- `DATABASE_URL` in `.env` points at this instance:
  `postgresql://fitness_app@localhost:5433/fitness_app?host=/tmp`.

## Stack

- **Next.js (App Router, TypeScript) single app** for both the PWA client and
  the API routes, per spec §13's "pragmatic solo stack" note.
- **Drizzle ORM** over Prisma — schema-as-code, no separate query-engine
  binary, and the schema here is small enough that Drizzle's lighter
  abstraction is a better fit than Prisma's codegen.
- **Vitest** for unit tests (fast, minimal config).
- **`idb`** for the client-side IndexedDB offline outbox.
- Package manager: npm (ships with the conda-installed Node; no need for a
  second tool like pnpm).

## Next.js 16 specifics

- Next 16 renamed the "middleware" file convention to **"proxy"**
  (`src/proxy.ts`, exporting a `proxy` function instead of `middleware`). The
  scaffolded app's own `AGENTS.md` file explicitly warns that this Next
  version differs from training data and to check `node_modules/next/dist/docs/`
  first — that's where this was confirmed
  (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
- The proxy file runs on the **Edge runtime**, which does not support
  `node:crypto`. `src/lib/auth.ts` uses Web Crypto (`crypto.subtle` HMAC-SHA256)
  instead, so the same auth helpers work in both the Edge proxy and the
  Node-runtime API routes.

## Auth (device passcode)

- Built now rather than deferred, since the spec calls it a "day one"
  architectural rule (§ "Architectural rules to honor from day one"). Minimal
  by design: a single shared `APP_PASSCODE` env var; a successful login sets a
  long-lived `httpOnly` cookie whose value is `HMAC-SHA256(APP_PASSCODE,
  "fitness-app-session")`, verified with a constant-time comparison in
  `src/proxy.ts`. This is a bearer-token pattern, not a real session store —
  acceptable specifically because this is a single-user, personal-use app with
  no multi-tenant concerns (spec §14).

## Schema (spec §6)

- All Phase-3+ tables (`body_metrics`, `progress_photos`, `recovery_metrics`,
  `nutrition_entries`, `form_checks`) were created now, matching the spec's
  field list, but nothing in this session reads or writes them — nullable and
  unused per the kickoff scope.
- `machines` rows must exist before a `set_log` can reference them
  (`set_logs.machine_id` is a real FK, not just a string). There is no
  "register a machine" UI yet — for this session, machine rows are inserted
  directly via SQL when needed. A machine-registration flow (or auto-create on
  first use) is a gap for the next session, not a bug.
- `profile` is a singleton table (no user_id / tenant column anywhere), per
  spec's single-user, no-multi-tenant-logic rule.

## Seed loader (spec §6, seed file's own notes)

- The seed JSON's `emphasis_convention` uses **three tiers** (1.0 primary /
  0.5 meaningful secondary / 0.3 minor secondary) — finer-grained than spec
  §7's flatter statement ("primary 1.0, secondary 0.5"). The loader stores the
  seed's actual per-relation emphasis value in `exercise_muscles.emphasis` and
  the volume module (`src/core/volume.ts`) sums that value directly, rather
  than flattening every secondary to 0.5. This is strictly more information
  and clearly intentional in how the seed was hand-tagged.
- The loader is idempotent: exercises are upserted by id; each exercise's
  `exercise_muscles` and `exercise_substitutions` rows are deleted and
  re-inserted from the current JSON on every run, so stale tags don't linger
  after edits to the seed file.
- Substitution rows reference target exercises **by name only** — the seed's
  own notes say "a few reference exercises not yet fully specced as their own
  nodes." `exercise_substitutions.candidate_exercise_id` exists in the schema
  for when those get promoted to full nodes, but is left `null` this session;
  matching names to ids would require fuzzy matching and wasn't attempted.

## Deterministic core (spec §7-9)

- **Progression / stall detection** (`src/core/progression.ts`):
  - The spec doesn't pin an exact session count for "flat for N sessions."
    Defaulted to **N = 3**, overridable via `ProgressionContext.stallSessionThreshold`.
  - Load/rep-range comparisons use the session's **heaviest working set** as
    the representative set (spec's "top of rep range" language is inherently
    per-set); the overall regression check instead uses **total session
    volume-load** (Σ load×reps), since that's the metric spec §7 names
    explicitly for the progression signal as a whole.
  - Only classification is implemented (`increase_load` / `progressing` /
    `true_stall` / `regression` / `hold` / `insufficient_data`) — the
    stall-buster's ordered intervention ladder (micro-load bump → add rep →
    add set → adjust rest → deload) is agent/coaching behavior, not part of
    "stall detection," and out of scope for this session.
- **Substitution filter** (`src/core/substitution.ts`) implements exactly the
  four filters in spec §8 (movement pattern, muscle overlap, equipment
  subset, contraindication exclusion) and returns a **ranked list**, not a
  final pick — the LLM's "pick best 1-2 + explain tradeoff" step is
  explicitly out of scope this session (spec §5, kickoff prompt).
  - Ranking = cosine similarity over muscle→emphasis vectors, plus a
    skill-level tie-break. No exercise in the current seed has `skill_level`
    set, so that term is a no-op today; the field is wired up for when it's
    populated.
- **Per-machine tracking** (`src/core/machineTracking.ts`): a `machineId ===
  null` lane is treated as the "portable" lane (free-weight/bodyweight, per
  spec §9) and is never re-baselined. Any non-null machine lane with fewer
  than 2 sessions, where the same exercise has prior history on a *different*
  machine, returns a `new_machine_baseline` result instead of running
  stall/regression logic — this is the spec §9 "re-baseline on machine change
  instead of flagging a false stall" rule.

## Verified end-to-end (not just unit tests)

With the dev server running against the local Postgres instance: logged in via
`/api/auth/login`, fetched the seeded exercise list via `/api/exercises`,
posted three flat-effort deadlift sessions via `/api/set-logs` and confirmed
`/api/progression` returned `true_stall`; posted three flat sessions on one
leg-extension machine (confirmed `true_stall`) then one session on a second
machine and confirmed `/api/progression` returned `new_machine_baseline`
instead; confirmed `/api/substitutions` returns `bodyweight_pullup` as a ranked
candidate for `cable_lat_pulldown`. Test data was reset afterward
(`truncate workout_logs cascade`) so the DB is left in a clean seeded-only
state.
