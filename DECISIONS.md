# Decisions log

Running record of choices made while building Milestones 1-2 and 4 (spec §15),
plus Session 4b (program editor + logging redesign, spec v0.5 §7a), and
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

## Milestone 4: Logging UX

- **A default Program is now seeded** (`seedDefaultProgram` in `src/db/seed.ts`,
  runs as part of `npm run db:seed`), built from the seed's own
  `in_current_routine` exercises grouped by their `day` tag, using **static
  novice defaults** from spec §1 (3 working sets, "8-12" rep range, RIR 2) —
  not the Phase-1 "programming agent" that adapts a program from goals/days via
  an LLM. This just gives the logging UX something concrete to log against;
  `splitType: "ppl_pf_current_routine"` makes that explicit. Re-running the
  seed replaces all `program_exercises` rows for this program, so it stays in
  sync with edits to the seed file.
- Conditioning-only days (`cardio`) get `targetSets: 1`, `repRange: null`,
  `rirTarget: null` — their prescription is duration/incline/speed from the
  exercise's own `params`, not a rep scheme.
- **Concrete load suggestions**: `classifyProgression`'s `increase_load` signal
  now includes a `suggestedLoad` (current top-set load + a default increment
  per `load_type`: 5 lb for free_weight/bodyweight/cable, 10 lb for
  smith/machine_selectorized/plate_loaded). These increments are **assumptions**,
  not measured per-machine values — the `machines` table has room for real
  pulley-ratio/plate-increment data later; this is a reasonable placeholder so
  "increase load" is actionable today instead of just a label.
- **Stall-buster** (`src/core/stallBuster.ts`) implements spec §7's ordered
  ladder (micro-load bump → add rep target → add set → adjust rest → deload)
  as a fixed constant, and picks the current rung by **counting trailing flat
  sessions directly from session history** (`countTrailingFlatSessions`) rather
  than persisting "which rung are we on" in a new table. A stall exactly at the
  detection threshold starts at rung 0; each session beyond that escalates one
  rung, capping at deload. This keeps the feature fully derived from existing
  data (no new schema, no state to get out of sync).
- **Machines auto-register on first use**: `POST /api/set-logs` now inserts a
  bare `machines` row (`onConflictDoNothing`) before the `set_log` insert,
  closing the gap noted after Milestone 1-2 where an unknown `machine_id`
  caused a 500 (FK violation). Brand/pulley-ratio/etc. can be filled in later;
  logging is no longer blocked on a separate "register a machine" step.
- **"Same as last time" machine recall** (spec §16's named UX risk): the log
  page remembers the last `machine_id` used per exercise in `localStorage` and
  pre-fills it. Implemented as a `useState` lazy initializer reading
  `localStorage` directly (guarded by `typeof window`) rather than an effect —
  React's `set-state-in-effect` lint rule (new in this Next/React version)
  flags synchronous `setState` calls inside effect bodies even for a plain
  synchronous read; a lazy initializer is the idiomatic fix and avoids an
  unnecessary extra render.
- Program days are shown in a **fixed display order**
  (`legs_shoulders, chest_triceps, back_biceps, abs, cardio`) hardcoded in
  `GET /api/program`, matching the seed's actual day tags. Anything else would
  sort alphabetically after — there's no generic "day scheduling" concept yet
  since that's Phase-1 programming-agent territory.
- Verified in an actual browser (not just curl): logged in via the real
  `/login` form, exercised the day picker, added a set to a fresh machine ID
  and confirmed the UI showed the live `new_machine_baseline` message, and
  switched to the `cardio` day to confirm conditioning-only exercises render
  without a set-entry form. This caught a real bug — the "offline queue
  pending" counter wasn't refreshing after the fire-and-forget `flushQueue()`
  call in `ExerciseCard.handleAddSet`, so it stuck at 1 even after a
  successful sync. Fixed by awaiting the flush and refreshing the count again
  afterward.

## Session 4b: program editor + logging redesign (spec v0.5 §7a)

Closes both known leaks from the v0.5 audit and builds the program editor +
logging redesign. Read `fitness-agent-spec_1.5.md` §7a, §15, §8/§8a/§9 first.

### Schema: program_days table (leak #2 fix)

- Added a `program_days` table (`id`, `program_id`, `name`, `order_index`) and
  changed `program_exercises.day` (a free-text tag) to `day_id`, a real FK.
  Day order now comes entirely from `program_days.order_index` — real,
  reorderable, renameable data — instead of the hardcoded `DAY_ORDER` literal
  that used to live in `GET /api/program`. That literal is gone; the route now
  just calls `getProgramWithDays()` and returns days pre-sorted by the DB.
- **Migration had to be split into two steps.** `drizzle-kit generate` has an
  interactive "did you rename this column?" resolver that requires a TTY,
  which this environment doesn't have (`Error: Interactive prompts require a
  TTY terminal`). A single migration that both dropped `program_exercises.day`
  /`.program_id` and added `program_days` + `.day_id` triggered that prompt
  (it looked like a possible column rename). Fix: split into two unambiguous
  migrations — (1) pure addition: new `program_days` table + nullable
  `day_id`, with the old `day`/`program_id` columns relaxed to nullable but
  kept; (2) pure removal: drop `day`/`program_id`, tighten `day_id` to
  `NOT NULL`. Each step alone has no rename ambiguity, so `generate` succeeds
  without a TTY. `--custom` was tried first but only produces an empty SQL
  file — it does **not** update the tracked schema snapshot, which would have
  left `drizzle-kit`'s own bookkeeping out of sync with reality.
- Data migration path: the DB's *only* existing `program_exercises` rows were
  from the old blanket `seedDefaultProgram()` — zero `program_days` rows, not
  referenced by any `set_logs`, fully reproducible by reseeding. Truncated
  `programs` (cascades to `program_exercises`) between the two migration
  steps rather than writing a real backfill script, with explicit user
  sign-off first (the auto-mode classifier correctly flagged the `TRUNCATE...
  CASCADE` as a mass-delete and blocked it pending confirmation — see the
  transcript). No real logged workout history existed at that point (cleared
  in an earlier session's cleanup), so this cost nothing.

### Retiring the blanket default program (leak #1 fix)

- `src/lib/programs.ts` is now the **only** read/write path for
  `programs`/`program_days`/`program_exercises`. Both the program-editor API
  routes and the seed script call into it — there is no separate "seeded
  default" code path anymore. `seedProgramFromRoutine()` in that file builds
  the initial PPL using the exact same `createProgram`/`addDay`/
  `addExerciseToDay` primitives the editor's API calls, not a bespoke insert.
- `DEFAULT_PROGRAM_EXERCISE_TARGETS` (3 sets, "8-12", RIR 2) still exists as a
  single exported constant, but it's now explicitly a **pre-fill default for
  `addExerciseToDay`**, freely overridden per call — not a fixed policy.
  `updateProgramExercise` edits any field independently per row; nothing
  downstream reads the constant as ground truth.
- **The seed is now non-destructive.** `seedInitialProgramIfNone()` checks
  `listPrograms()` first and is a no-op if any program already exists —
  including one the user has since edited in `/program`. This was a
  correctness fix, not just a style change: the old `seedDefaultProgram()`
  unconditionally deleted and recreated every `program_exercises` row on
  every `npm run db:seed` run, which would have silently destroyed any editor
  edits the next time the seed script ran for an unrelated reason (e.g.
  re-syncing exercise tags). Verified directly: renamed a day via SQL,
  re-ran `db:seed`, confirmed the rename survived and the log printed
  "Skipping program seed — 1 program(s) already exist."

### Program editor (`/program`, spec §7a)

- Full CRUD: create/rename/delete/activate programs; add/rename/delete/reorder
  days; add exercises from the graph with per-exercise editable targets;
  reorder/remove exercises within a day.
- **Reordering uses up/down buttons that swap `order_index` with the adjacent
  sibling**, not drag-and-drop and not "send the whole new order" — approved
  as the simpler, equally-functional choice. `moveDay`/`moveProgramExercise`
  find the nearest neighbor in the move direction and swap; a no-op at the
  top/bottom (no neighbor found) rather than erroring.
- `setActiveProgram()` deactivates whatever else was active in the same
  transaction — exactly one program is ever active, which is what
  `getActiveProgram()` in `GET /api/program` (the logging screen's data
  source) depends on.
- Verified live in the browser: edited a target (sets 3→4), saved, confirmed
  in Postgres; moved an exercise up, confirmed the `order_index` swap; both
  reverted to restore the clean seeded state afterward.

### Logging redesign (`/log`)

- **Previous-session reference**: `GET /api/exercises/[id]/last-session`
  reuses `toSessionSummaries` + `sessionsFromOldestToNewest` from the
  existing core modules — no new logic, just a thin read path. Scoped to the
  same machine lane as the current selection (machine-bound loads aren't
  comparable across machines, spec §9), so it refetches whenever the active
  exercise or machine changes. Shows actual per-set numbers ("Last time: 50 x
  10, 8, 8"), not just a set count, per your polish note.
- **Target as a guideline chip**: restyled as a muted, pill-shaped `<span>`
  labeled "target:", visually distinct from the interactive log-entry
  inputs — reads as a hint, not a control, per your polish note. It always
  shows the *original* program-exercise's target, even after a swap (see
  below), since the target represents the prescribed stimulus for that
  program slot, not a property of whichever exercise currently fills it.
- **Inline machine tagging**: a `<select>` of existing machines (from
  `GET /api/machines`) plus an adjacent "+ Add" that calls
  `POST /api/machines` immediately and optimistically sets the field —
  offline, that POST just fails silently and the typed value is used anyway,
  since `POST /api/set-logs` already auto-registers unknown machine ids on
  sync (Milestone-4 behavior, unchanged). This is the one place a network
  failure is deliberately swallowed, and it's swallowed *because* the
  fallback path (auto-register-on-sync) already guarantees correctness
  offline.
- **Swap affordance**: "Swap" calls the existing, unmodified
  `GET /api/substitutions?exerciseId=...` (deterministic candidates only — no
  LLM final-pick, per scope) and lists ranked candidates with a caption
  quoting spec §8's "preserves weekly stimulus, not the load number." Picking
  one updates the card's *active* exercise (id/name/loadType/portable) for
  the rest of this session only; a "reset" link restores the program's
  original exercise. **Verified explicitly**: logged a set after swapping
  `cable_lat_pulldown` → `bodyweight_pullup` and confirmed in Postgres that
  `set_logs.exercise_id = 'bodyweight_pullup'`, not the original — this was
  the one requirement flagged as needing to be "explicitly right," and it is.
  The substitutions endpoint was extended to return `name`/`loadType`/
  `portable` alongside `id`/`score` (previously id+score only) so the swap UI
  didn't need a second round-trip against `/api/exercises`; `src/core/
  substitution.ts` itself was not touched.
- The swap's equipment filter still falls back to "every equipment tag seen
  across all exercises" (unchanged from Milestone 1-2) since there's no
  captured `profile.equipment_profile` yet — out of scope for this session
  (no new profile UI was requested), noted here so it doesn't look like an
  oversight.
- Offline-first is unchanged: still the same IndexedDB outbox
  (`src/lib/offlineQueue.ts`), still queue-first-then-flush on every add.
