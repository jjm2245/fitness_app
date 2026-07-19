# Decisions log

Running record of choices made while building Milestones 1-2 and 4 (spec §15),
Session 4b (program editor + logging redesign, spec v0.5 §7a), and the deploy
hardening session (spec §13/§14), plus anywhere this session's implementation
deviates from or fills a gap in `fitness-agent-spec.md`. Newest at the bottom.

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

## Deploy to phone: production hardening

First time the app faces the internet. No feature work — deterministic core,
program editor, and logging behavior are unchanged except where production
genuinely required a fix (one was found: see the timezone bug below).

### Managed Postgres (Neon recommended)

- `src/db/client.ts` now decides whether to require SSL by inspecting
  `DATABASE_URL` itself, not `NODE_ENV`: `sslmode=require`/`verify-full` in
  the string forces SSL; `host=/tmp` or `localhost` (this project's local dev
  pattern) disables it; any other real hostname defaults to requiring SSL.
  This means the exact same code path works locally and in production —
  switching environments is purely a `DATABASE_URL` value change, per your
  "keep local dev still working via an env-based DATABASE_URL" requirement.
- **Use Neon's *pooled* connection string in production** (the one with
  `-pooler` in the hostname, routed through PgBouncer) — not the direct one.
  Serverless functions can spin up many concurrent instances, each wanting
  its own DB connection; the pooled endpoint is what keeps that from
  exhausting Postgres's real connection limit. `pool.max` is set to 5 (a cap
  per function instance, not a global cap — the pooler handles the global
  side). This is a config/connection-string choice, not a code dependency —
  no new driver package was added (still `pg` + `drizzle-orm/node-postgres`,
  not `@neondatabase/serverless`), since the existing setup already works
  fine against a pooled Postgres endpoint.
- Migrations and seeding against the managed DB are a **manual step**
  (`npm run db:migrate` then `npm run db:seed` with `DATABASE_URL` pointed at
  Neon), not wired into the Vercel build. Deliberate: auto-migrating
  production on every deploy is a bigger footgun than one documented manual
  step for a single-user app with infrequent schema changes.

### Auth hardening (spec §14 — now required, it's public)

- **Sessions now expire.** The old token was `HMAC(APP_PASSCODE,
  "fitness-app-session")` — a fixed value that never changed and never
  expired. New format: `<expiryEpochSeconds>.<hmacHex>`, where the HMAC
  covers the expiry itself, so a tampered expiry invalidates the signature.
  Verified: fresh tokens validate, tampered signatures are rejected, past
  expiries are rejected even with a correctly-recomputed signature, malformed
  tokens are rejected. **30-day TTL** (your choice) — cookie `maxAge` matches
  the token TTL exactly so the browser doesn't hold onto an already-expired
  cookie.
- **New `SESSION_SECRET` env var, separate from `APP_PASSCODE`.** The old
  design signed sessions with the passcode itself, meaning the "credential"
  and the "signing key" were the same secret. Now a session can't be forged
  without a second, independently-generated high-entropy secret
  (`openssl rand -hex 32`), even if the passcode is weak or guessed via some
  other channel. `isValidPasscode` still checks `APP_PASSCODE` at login,
  unchanged in role.
- Cookie flags: `httpOnly` (already had it), `sameSite: "lax"` (already had
  it), `secure: process.env.NODE_ENV === "production"` (already had it —
  Next.js sets `NODE_ENV=production` automatically for `next build`/Vercel,
  `development` for `next dev`, so this needed no new config). Verified this
  actually engages under `next build && next start`: the `Secure` flag was
  present on the cookie, and curl (matching real browser behavior) correctly
  refused to persist/resend a `Secure` cookie over plain HTTP — confirmed the
  underlying session validation was still correct by passing the cookie
  header manually. This will work seamlessly for real users since production
  is HTTPS-only on Vercel.
- **Brute-force protection**: new `login_attempts` table (`ip`, `created_at`)
  and `src/lib/rateLimit.ts` — 5 failed attempts per IP per 15-minute window
  triggers a 429 with `Retry-After`, blocking even a *correct* passcode until
  the window clears (verified directly). Chosen DB-backed over in-memory
  because Vercel serverless functions don't reliably share memory across
  invocations — an in-memory counter would reset unpredictably and offer
  close to no real protection. Chosen per-IP over a single global lockout
  because a global lockout lets an attacker lock out the legitimate user by
  deliberately failing repeatedly. IP comes from `x-forwarded-for`, which
  Vercel's edge network sets reliably. Successful login clears that IP's
  attempts; failed attempts opportunistically prune anything older than 24h
  on every write, so there's no cron job needed for a single-user, low-volume
  table.
- **Found and fixed a real bug while building this**: `login_attempts.created_at`
  was originally a plain `timestamp` (no timezone) column. The Postgres
  server's local timezone (America/New_York, UTC-4) meant `now()`-derived
  values were stored as local wall-clock time, while the rate-limit window
  comparison used a JS `Date` (UTC-based) as a bind parameter — node-postgres
  serializes that as a UTC string, which a no-timezone column then treats as
  *local* time with no conversion. Net effect: the window comparison was off
  by ~4 hours and never matched, silently defeating the rate limit (discovered
  via live curl testing, not by inspection). Fixed by declaring the column
  `timestamp("created_at", { withTimezone: true })`. **Other `timestamp`
  (no-tz) columns in the schema are informational bookkeeping only and are
  never compared against a JS `Date` in application code**, so they're left
  as-is — but this is a real gotcha worth remembering if any future feature
  adds a JS-Date-driven comparison against one of them.

### Env / secrets

- Added `.env.example` (committed, no real values) documenting the three
  required vars: `DATABASE_URL`, `APP_PASSCODE`, `SESSION_SECRET`. Added a
  `.gitignore` exception (`!.env.example`) since the existing `.env*` pattern
  would otherwise have swallowed it too.
- Audited tracked files for hardcoded secrets — none found. `.env` confirmed
  untracked. All three vars are meant to be set directly in Vercel's project
  environment settings for production, never committed.
- `package.json` now declares `"engines": { "node": ">=20" }`, matching the
  version this app has been built and tested against.

### Production build verification

- `next build` succeeds; every `/api/*` route correctly shows as dynamic
  (`ƒ`), `/log`/`/program`/`/login`/`/` as static/prerendered, proxy
  middleware bundled. Ran `next build && next start` (not just `next dev`)
  and confirmed: unauthenticated requests redirect to `/login`; the manifest
  is served at `/manifest.webmanifest` with the correct content-type; `sw.js`
  is served as a static asset; the full login → session → authenticated
  request flow works. This is the closest local approximation of the actual
  Vercel runtime available without an account.
- Not independently verifiable without a physical device: home-screen
  install, full-screen "app" display, and the offline-outbox flow (log a set
  in airplane mode, reconnect, confirm sync) on a real phone. These are
  called out explicitly in the phone-test checklist handed to the user.

## Logging-model rework (session lifecycle, blocks, cardio, UX)

After real phone use, four gaps: no clear commit at set/exercise/session
level, no way to end a session, abs/cardio couldn't be reused or skipped
easily, and cardio couldn't be logged at all. Fixed in four parts. No LLM,
deterministic core untouched and re-audited clean, single-user, offline-first
preserved throughout.

### Part 1 — Session lifecycle + durable offline log (commit eb13799)

- **The real fix was the offline layer.** The old outbox drained and forgot
  synced rows, so there was nothing durable to render a "logged today" list,
  edit, or summarize from offline. Rebuilt it as a durable local session log
  (`src/lib/sessionStore.ts`, IndexedDB): every set is a permanent row with
  `serverId` + `syncState` (pending_create / synced / pending_update /
  pending_delete). Sync updates rows in place. The UI always reads from this
  store, never the network — so confirmation, edit, delete, completed-state,
  and the finish summary all work fully offline.
- **Same-session edit-after-sync, offline** (explicit user requirement):
  editing a synced set offline transitions it to `pending_update` and PATCHes
  on the next sync; deleting a synced set soft-marks `pending_delete` and
  DELETEs on sync; deleting a never-synced set is a pure local removal. Old
  historical edits stay online-only (out of scope). Proven with 6
  fake-indexeddb tests (added `fake-indexeddb` as a devDependency — the store
  is browser-only and can't be exercised through the preview, which has no
  network toggle).
- **Finish is re-stampable, not a one-way door** (explicit user requirement):
  `workout_logs.finished_at` (new nullable timestamptz, migration 0004);
  `POST /api/sessions/finish` upserts by date so a session that only ever
  existed offline can still be finished. The pre-commit summary ("N sets
  across M of Y program exercises", per-exercise breakdown, sync status) is
  computed entirely from the local store.
- New `PATCH`/`DELETE /api/set-logs/[id]`. Completed-exercise flags are
  local-only (a "what's left" convenience, not worth syncing).

### Part 2 — Reusable blocks (commit e405025)

- **Schema reuse over new tables**: a block is a `program_day` under a single
  hidden block-library program (`programs.is_block_library`, migration 0005).
  This reuses the whole program/day/exercise CRUD lib and API routes verbatim
  — the `/blocks` editor is the same extracted `DayEditor` component as
  `/program`, just pointed at the library. `listPrograms()`/
  `getActiveProgram()` exclude the library so it never appears in the switcher.
- **Attach-to-session is client-only** (no DB relation): a local IndexedDB
  `composition` store records which blocks/ad-hoc exercises are added to
  today, so a freshly attached block survives a reload before any set is
  logged. Sets logged against them are ordinary `set_logs` rows. Attaching or
  skipping never blocks finishing.
- Seeds starter "Abs" and "Cardio" blocks from the seed's abs/cardio day
  exercises, non-destructively (only if the library is empty), so the one-tap
  flow works out of the box. The existing program's abs/cardio *days* are left
  as-is — the user can delete them from the program in the editor if they'd
  rather rely on blocks (not done destructively for them).

### Part 3 — Cardio logging (commit e405025)

- **Separate `cardio_logs` table** (migration 0006): duration/incline/speed/
  distance/level, never sets×reps×load. Isolation from the volume/progression
  math is **structural, not a filter** — the deterministic core only ever
  reads `set_logs`, so cardio is physically invisible to it. Verified: a
  logged cardio entry lands in `cardio_logs`, 0 rows in `set_logs`, and
  `grep` finds no cardio/block/routine references in `src/core/*`.
- Cardio has its own local store (mirroring the set synced/pending pattern),
  its own `POST`/`DELETE /api/cardio-logs`, and `last-session` branches on
  `conditioning_only` to return a cardio-shaped "last time". `/log` routes
  conditioning exercises to a cardio card, everything else to the strength
  card, over one merged program+composition loggable list.

### Part 4 — Usability / visual cleanup

- Fixed dark theme + design tokens + comfortable tap targets (≥40px controls)
  in `globals.css` — improves every screen at once — plus a `log.module.css`
  (CSS Modules, per plan, no UI framework) for the logging screen: bordered
  cards, muted guideline-chip target, blue primary actions (one per card +
  the sticky "Finish session" bar), colored synced/pending indicators,
  de-emphasized completed cards. Styling only; the model from Parts 1–3 is
  unchanged. Verified clean at 375px mobile width (no overflow after capping
  control max-widths).

### Self-check (required before done)

- **No routine literals in `src/core/*`** — re-grepped for cardio/block/
  exercise/day/muscle/routine names: clean. Core imports no DB/schema.
- **Offline finish + summary verified**: 9 fake-indexeddb tests cover the sync
  state machine (offline log, edit-after-sync-offline, soft-delete, cardio
  offline, finish offline + re-stamp, composition attach/dedupe/remove); the
  finish summary is computed from the local store so it renders with no
  network.
- **Tests**: 85 pass. Clean typecheck, lint, and production build.
- **Migrations 0004–0006 applied to LOCAL only.** Production Neon migration is
  deliberately still pending — to be run once the user has tested this build.

### Tooling note

Running `next build` (verification) while a `next dev` preview server was
alive clobbered the shared `.next/` and 500'd the dev server. Not a code
issue — fixed by stopping the preview before building. Worth remembering:
don't `next build` against a live dev server sharing the same `.next`.

## Round-2 refinements from real use (6 parts)

Discipline held: no LLM/vision, the deterministic core stays general (it reads
only normalized data — the effort tag, library, provenance, and machine labels
are all data + UI), offline-first preserved, migrations local-first with prod
held for review. Each part is its own commit for rollback.

### Part 1 — responsive editors
`/program` and `/blocks` overflowed on mobile. Extracted the shared DayEditor's
inline styles into a CSS Module (flex-wrap, capped widths, exercise name on its
own row). Verified clean at 375px.

### Part 2 — exercise-model corrections
- Split "either/or" seed nodes so one node = one real exercise. Existing ids
  kept (renamed to one concrete variant) so no set_logs/program rows break; the
  second variant added as a new node: smith_squat +db_goblet_squat; deadlift
  (now "Dumbbell Romanian deadlift") +smith_rdl; russian_twist_heel_touch (now
  "Russian twist") +heel_touches; lateral_raise (now "Dumbbell lateral raise")
  +cable_lateral_raise. Split variants join via the same seed upsert path.
- Stripped baked-in weights from names; added weight is the optional per-set
  `load`, defaulting to 0 for bodyweight lifts.
- **Effort tag replaces the RIR number** (more in me / near failure / to
  failure). New `set_logs.effort` enum; exact `rir` kept optional.

  **Exactly how the effort tag feeds the core:** the core still consumes a
  numeric RIR and never sees the label. The single translation point is
  `normalizedRir()` in `src/lib/effort.ts`, called by `coreAdapters` when it
  loads set logs for the engine. Mapping: `to_failure → 0`, `near_failure → 1`,
  `more_in_me → 3` (an explicit exact `rir`, if present, wins over the tag).
  This preserves the engine's "at target effort" semantics: with a typical
  target RIR ~2, `near_failure`/`to_failure` (0–1) count as at-or-below target
  and `more_in_me` (3) does not — so a stall is never flagged when you left
  reps in the tank. `src/core/*` is unchanged; a unit test locks the mapping.

### Part 3 — exercise library, pairing, custom, provenance
- **Dataset: free-exercise-db** (github.com/yuhonas/free-exercise-db) —
  **Unlicense / public domain** (no attribution required; cleaner than wger's
  copyleft). Vendored to `src/db/seed-data/free-exercise-db.json`, 873 entries,
  ingested via `npm run db:seed:library` (idempotent) as source="library".
  Library muscles map to our finer slugs (so volume works); equipment maps to
  load_type. **Library rows carry NO movement_pattern** (the dataset lacks our
  taxonomy), so they never match in substitution — honest limitation. To keep
  the core general, `ExerciseTags.movementPattern` is now `string | null` and
  substitution treats null as unmatchable (a null-guard, not a library special
  case).
- **Applied seed→library pairings (the 16 high-confidence, per your review):**
  additive — each curated exercise keeps its name/pattern/muscle tags and gains
  `canonical_name` + `library_id`. Verified nothing was overwritten.

  | curated id | → canonical (library) |
  |---|---|
  | machine_leg_extension | Leg Extensions |
  | hip_adductor_machine | Thigh Adductor |
  | hip_abductor_machine | Thigh Abductor |
  | reverse_pec_dec | Reverse Machine Flyes |
  | cable_tricep_pushdown | Triceps Pushdown - V-Bar Attachment |
  | cable_overhead_tricep_ext | Cable Rope Overhead Triceps Extension |
  | machine_preacher_curl | Machine Preacher Curls |
  | cable_hammer_curl | Cable Hammer Curls - Rope Attachment |
  | bodyweight_pullup | Pullups |
  | back_extension | Hyperextensions (Back Extensions) |
  | hanging_leg_raise | Hanging Leg Raise |
  | machine_ab_crunch | Ab Crunch Machine |
  | shoulder_press | Dumbbell Shoulder Press |
  | smith_squat | Smith Machine Squat |
  | deadlift | Romanian Deadlift |
  | russian_twist_heel_touch | Russian Twist |

  The medium-confidence 7 and all others were left as your custom name (no
  canonical attached), per your "high-confidence only" choice.
- **Search-add** everywhere via a shared debounced `ExerciseSearch` (new
  `/api/exercises/search`, curated ranked first) — replaces the old
  all-exercises `<select>`, unusable at 900+ rows.
- **Custom free-typed exercise** (`/api/exercises/custom`): source="custom",
  `untagged=true`, null pattern, no muscles — loggable immediately, naturally
  excluded from volume/substitution, and labeled as such in the UI.
- **Ad-hoc adds attach to the SESSION only** (client-side composition store) —
  no throwaway program/block is ever created.
- **Provenance badges** (curated / library / custom / untagged) on cards and
  editor rows; ad-hoc cards render visually separate (dashed).
- Schema migration 0008: exercises.source / canonical_name / library_id /
  untagged; movement_pattern made nullable.

### Part 4 — machine tag UX
Machine field shows only for machine/cable/Smith/plate load types (explicit
`MACHINE_LOAD_TYPES` set — never dumbbell/bodyweight/free weight); last machine
stays pre-selected; copy reframed as a personal label you invent ("leg ext by
the mirror"), not a number on the machine.

### Part 5 — cardio contextual fields
Visible cardio inputs are driven by the exercise type inferred from its name
(pure `cardioFields` helper): treadmill → duration/speed/incline; stair →
duration/level; bike → duration/level/distance; unknown → duration/distance.
Hidden fields persist as null.

### Part 6 — session composition multi-select
Replaced the single-block dropdown with a multi-select builder: tick any number
of blocks and/or program days and attach them all at once. Block *creation*
stays on `/blocks`; standalone library/custom exercises still add via inline
search — so a session can be built entirely from ad-hoc picks with no program.
Each attached exercise records its origin (block/program·day) shown as a tag
alongside its provenance badge.

### Self-check
- `src/core/*` re-grepped: no library/UI/routine literals (only explanatory
  comments mention "library"; the code handles a nullable pattern generically).
- 89 tests pass (incl. new effort-mapping test); clean typecheck, lint, and
  production build throughout.
- Migrations 0007 (effort) + 0008 (library/provenance) applied to LOCAL only.
  **Production Neon migration + library ingest are held for your review** —
  when you approve, prod needs: `db:migrate`, then `db:seed:library` (the
  library ingest), then a git push for Vercel to redeploy.

## Sessions list + client-session-id (Part A)

Reframed the app's home base: the **sessions list** (`/sessions`) is where
sessions live; the log screen is where you *do* one. Mental model — "log = do a
session, list = where sessions live."

### A session is a client-generated id, not a calendar date
Previously a "session" was implicitly a calendar day (everything keyed by
`date`), so you couldn't have two sessions in a day and "today's log" was the
only session you could touch. Now a session is a **`crypto.randomUUID()`**
minted on the client the moment you start one. The client owns identity so a
session created offline maps to exactly one `workout_logs` row on sync.
- Schema: `workout_logs.client_session_id text unique` (migration 0009), plus a
  backfill (0010) giving every pre-existing row a `gen_random_uuid()` so the
  whole model keys uniformly on it — no special-casing legacy date-keyed rows.
- All three write endpoints (`set-logs`, `cardio-logs`, `sessions/finish`)
  **upsert the workout_log by `client_session_id`** (falling back to `date`
  only for a legacy caller that sends none). `finish` also persists
  `programDay` so the list can label a session with zero logged sets.

### The local store was re-keyed date → sessionId (destructive v3 bump)
`sessionStore` IndexedDB went to version 3: the old date-keyed stores are
dropped and recreated keyed by `sessionId`, with a new `sessions` object store
(`LocalSession`: id, date, origin, finishedAt, finishSynced). The one-time bump
clears *unsynced* local data only — finished sessions are safe on the server and
reappear via `GET /api/sessions`. Session-management fns: `createSession`,
`listLocalSessionSummaries` (list with logged-volume counts in one pass),
`getSession`, `finishSession(id)` (re-stampable), `deleteLocalSession`.

### The list is local ⊕ server, merged by id — renders fully offline
`/sessions` merges the durable local store with `GET /api/sessions` (finished
server sessions + derived `day · N exercises` description), keyed by session id;
local wins (freshest, may be in progress), server-only rows are appended.
In-progress sessions sort first (resume), then finished newest-first. No network
round-trip is required to see your sessions.

### A session is self-contained; opening an old one hydrates from the server
Each card on the log screen comes from the session's **composition** (targets
and cardio params now travel with the composition item), so the screen needs no
`/api/program` round-trip and works offline. Starting from a program day copies
that day's exercises into the session's composition at creation; ad-hoc starts
empty. Opening a session that exists only on the server (finished elsewhere, or
after a local-store reset) calls `GET /api/sessions/[id]` and
`hydrateFromServer` rebuilds the local rows as **synced** (with server ids), so
later edits/deletes route by server id exactly like locally-created rows — the
"old synced edits need connectivity, then work offline" requirement. Hydration
never clobbers a session that already has local (possibly unsynced) state.

### Finishing returns to the list
`Finish session` stamps `finishedAt`, syncs, and navigates back to `/sessions`,
where the just-finished session is visibly added. `/log` (no id) redirects to
the list; the home page links there.

### Verified
- 90 tests pass (new: server-hydration round-trip + no-clobber); clean
  typecheck, lint, production build.
- Browser: start-from-day → log a set (synced, upserted by client_session_id) →
  finish → back on list with the row; wiped the local IndexedDB and reopened the
  session — hydrated from the server with its synced set intact.
- Migrations 0009 + 0010 applied to **LOCAL only**; prod is held for your
  review (`db:migrate` when approved).

## Exercise-model unification: merge, tagged/untagged, collapsible (Parts B–D)

### Part D — the approved seed→library mapping is a true merge
The user validated an exact seed→library mapping (round-3). Each pairing is
applied as a **merge**, not the earlier additive/hide half-fix: the curated
exercise becomes the single entry, taking the canonical library name as its
display (a few keep a more precise override — "Captain's Chair Straight-Leg
Raise", "Toe Touches", "Full-Extension Double Crunch — Hands Behind Head") and
keeping all its curated tags (movement pattern, muscle emphasis, safety flags,
substitutions). The library twin is **never ingested** (its name is in the merge
set) and any prior twin is deleted — guarded so a twin referenced by a log or
program row is left in place rather than orphaning history. So search shows one
entry per exercise. Lives in `seedLibrary.ts` (`MERGES` + `CUSTOM_RENAMES`),
runs after `db:seed`; idempotent.
- Corrections vs the first pass: shoulder_press → Machine Shoulder (Military)
  Press (machine, not dumbbell), deadlift → Stiff-Legged Dumbbell Deadlift,
  machine_chest_press → Machine Bench Press, incline_bench_press → Leverage
  Incline Chest Press, cable_overhead_tricep_ext → Triceps Overhead Extension
  with Rope. back_extension unpaired + renamed "Seated Back Extension Machine"
  (the old "Hyperextensions" pairing was a different movement).
- Net-new, fully tagged (authored in `seed.ts`): Barbell Squat, Hack Squat,
  Face Pull (muscles/pattern mirror reverse_pec_dec so it substitutes for it),
  Stiff-Legged Barbell Deadlift — curated + paired; Bayesian Curl — custom (no
  library match), still fully tagged. Rotary torso stays custom.
- **Watch-list** (knowingly imperfect canonical names the user is accepting for
  now — future custom candidates, do not "fix"): cable lateral raise → Standing
  Low-Pulley Deltoid Raise (used at hip height); machine_chest_press → Machine
  Bench Press (done seated, not flat); cable_close_grip_row → Seated Cable Rows
  (double-D close grip not captured); lateral_raise → Side Lateral Raise and
  weighted_calf_raise → Standing Calf Raises (implement unspecified);
  full_extension_crunch → Cocoons (imperfect — precise name kept as display).

### Part B — one axis that matters: tagged vs untagged
The engine only ever cares whether an exercise has a **movement pattern**: with
one it can be a substitution candidate; without, it can't. Provenance
(curated/library/custom) is no longer surfaced — the badge now reads **tagged /
untagged**, and `untagged` is maintained as a reliable proxy for "no movement
pattern" (library rows, which carry no pattern, are now `untagged: true`; the
merge/graduation paths clear it). `untagged` was always display-only — the core
reads `movementPattern` + `exercise_muscles`, never this flag — so this is a
labelling change, not an engine change (self-check: `src/core/*` clean).

**Movement-pattern-on-add:** picking (or creating) an untagged, non-cardio
exercise in any add surface opens a movement-pattern chooser, auto-suggested
from the name (`suggestMovementPattern`, ordered specific-before-generic rules).
"Tag & add" PATCHes `/api/exercises/[id]` (sets the pattern, clears `untagged`)
so the exercise graduates to substitutable; "Skip" adds it still-untagged
(free-form custom stays a valid fallback). Centralised in `ExerciseSearch`, so
the program editor, block editor, and session picker all get it for free.

### Part C — collapsible log cards
Each card collapses to just its name (+ tagged/untagged badge and a "N sets"
chip); completing an exercise auto-collapses it, and completed cards render
collapsed. The manual toggle is remembered against the completion state it was
set under, so it wins until completion flips — no effect, so no cascading
renders.

### Verified
- 90 tests pass (seed count 37 → 41 curated + net-new/custom assertions); clean
  typecheck, lint, production build; `src/core/*` re-grepped clean.
- Browser: merged canonical names show in the log; reverse_pec_dec substitution
  now returns Face Pull; tagged/untagged badges correct; picking an untagged
  library exercise → pattern chooser (auto-suggested "squat") → Tag & add →
  graduated in DB (`movement_pattern` set, `untagged` cleared) and added as a
  tagged card; collapse/auto-collapse confirmed.
- Applied to **LOCAL only** via `db:seed` + `db:seed:library` (data, not a
  schema migration). Prod held: after review, prod needs `db:migrate` (0009,
  0010) then re-running `db:seed` + `db:seed:library`, then a push for Vercel.

## Session model v2 — Part 1 bugs

### 1a — silent sync failure on expired session (data-integrity)
Root cause: `proxy.ts` gated `/api/*` and **redirected** unauthenticated
requests to `/login`. An outbox `POST /api/set-logs` with an expired cookie
followed the 307 → `GET /login` → **200 HTML**; `res.ok` was true, then
`res.json()` threw on HTML → caught silently → "not synced" forever despite
wifi (data logged locally but never reaching the server). Fixes:
- Proxy now returns **401 JSON** for `/api/*` (pages still redirect).
- `sync()` classifies outcomes via a single `send()` choke point — `auth`
  (401) / `network` (fetch threw) / `server` (other non-ok). It **aborts the
  whole drain on the first 401** (every later request would 401 too) and
  returns `authError`/`networkError`/`serverError` so the UI can say what's
  wrong instead of a blank "not synced". Local writes are never dropped.
- Log + sessions screens surface the reason; on `auth` they show a re-login
  link (`/login?next=…`, honored by the login page) and **auto re-drain** on
  tab refocus (`visibilitychange`) and `online`.
- Tests: 401 keeps data pending + re-drains after re-login; a mid-drain 401
  aborts without losing the remaining queued rows.

### 1b — finish summary omitted cross-program / ad-hoc exercises
The summary listed only exercises with logged sets. It now enumerates every
exercise with **any** activity — sets, cardio, or just a "done" check —
regardless of source (program day / other program / ad-hoc), ordered by the
session's composition. A done-but-unlogged item shows "done, no sets logged".

### 1c — Cable bicep curl vs Bayesian curl are two exercises
Already split by Part D at the graph level (`cable_bicep_curl` → "Standing
Biceps Cable Curl", library-referenced; `bayesian_curl` → custom, elbow_flexion
/ biceps / stretch_emphasis). Verified in the UI: both appear as separately
selectable entries when composing (day card + ad-hoc search hit). The earlier
"appears as one" was the pre-Part-D combined seed node; IDs are stable so logged
history isn't orphaned.

## Session model v2 — Part 2: ordered, incremental composition

A session is now an **ordered list of exercises actually performed**, built
incrementally, rather than a pre-loaded program day.

### Occurrences (client-owned, ordered, repeatable)
New `session_exercises(id, workout_log_id, exercise_id, client_instance_id
unique, order_index, source)` table (migration 0011) — one row per performed
*occurrence*. The same exercise can appear multiple times at different
positions (tricep → chest → abs → tricep), so the model is occurrence-keyed, not
exercise-keyed. `set_logs`/`cardio_logs` gain a nullable `session_exercise_id`
FK (ON DELETE SET NULL) so a set links to its specific occurrence and repeats
keep separate set lists. The client owns each occurrence via
`client_instance_id`, so one added offline maps to exactly one server row.

The local store bumped to **IndexedDB v4**: `composition` → `occurrences`
(keyed by instanceId, indexed by session + instance), sets/cardio carry
`instanceId` (set index is per-occurrence), and `completed` is keyed by
occurrence. Destructive bump — unsynced local data clears; finished sessions
reappear from the server. `addOccurrence` appends, `moveOccurrence` reorders by
swapping order_index, `removeOccurrence` drops an accidental add (soft-deleting
its synced sets). Sync pushes the whole ordered list to
`POST /api/session-exercises` (upsert by client_instance_id + prune removed)
**before** sets, so set-logs resolve their occurrence link.

### Incremental, one-tap-fast (not pre-loaded)
Starting a session creates an **empty** one and goes straight to `/log`. The
program(s) + blocks become a **quick-add palette** (collapsible groups of
one-tap chips) plus ad-hoc search; a tap appends an occurrence instantly and the
panel stays open, so you add the next while the previous is mid-set. Cards are an
ordered list with up/down reorder + remove. Shortening a session = simply not
adding those exercises. The **session name aggregates** every contributing
source in first-seen order ("Chest + triceps" → add abs → "Chest + triceps +
Abs"), recomputed on the client and persisted so the list + finish label read it.

### Hydration + legacy
`GET /api/sessions/[id]` returns the ordered occurrences (or, for a legacy
session with none, one synthesized per distinct logged exercise) with each
set/cardio's `session_exercise_id`; `hydrateFromServer` rebuilds occurrences in
order and re-links sets by that id (falling back to the first occurrence of the
exercise). `GET /api/sessions` counts occurrences for the list description,
falling back to distinct-logged for legacy rows.

### Concurrency fix (data integrity)
Discovered via rapid logging: two overlapping `sync()` calls (two quick
onSessionChanged) both read the same pending rows and double-POSTed — set-logs is
a plain insert, so logged sets duplicated. `sync()` is now **serialized** (each
drain chains after the previous), so the second sees an emptied outbox. Tested.

### Verified
- 94 tests pass (occurrences ordered/repeat/reorder/aggregated-name, per-
  occurrence set attachment, hydration re-link, concurrent-sync no-dup); clean
  tsc/lint/build; `src/core/*` untouched.
- Browser: empty start → palette one-tap adds incl. a repeat → reorder → name
  aggregates → per-occurrence sets → server persists ordered session_exercises +
  linked set rows → ordered finish summary → back on list ("4 exercises") →
  wiped local store and reopened: occurrences + sets rebuilt in order.
- Migration 0011 + IndexedDB v4 are **LOCAL only**; prod held for review.

## Session model v2 — Part 3: delete + editor management

### 3a — delete a session (offline-safe)
`DELETE /api/sessions/[id]` removes the workout_log (set_logs / cardio_logs /
session_exercises cascade off it), idempotent (a 404 / already-gone is success).
Client `deleteSession` removes the local rows immediately and queues a
server-side delete in **localStorage** (a tiny id list — no IndexedDB version
bump), drained by `sync()`. So a delete works fully offline: local goes now, the
server delete flushes on reconnect. A confirm dialog guards it on `/sessions`.

### 3b — custom-exercise management (`/exercises`)
Lists everything that isn't a raw library row and badges the three naming kinds
the user wanted to tell apart: **library name** (name == canonicalName),
**your name → library** (a precise display name on a library reference), and
**custom** (no library link). You can **rename** (`PATCH /api/exercises/[id]`
now takes `name`), **adopt the library's own name** (one click), or **collapse
a redundant custom into a library entry**. Collapse is the stable-id-discipline
path: `POST /api/exercises/[id]/collapse` **re-points every reference**
(set_logs, cardio_logs, session_exercises, program_exercises, both
exercise_substitutions FKs, form_checks) from the custom id to the library id
in a transaction, *then* deletes the custom — so no logged history is orphaned
(verified: a logged set moved to the library exercise, zero orphans).

### 3c — per-exercise machine management
New `exercise_machines(exercise_id, machine_id)` join (migration 0012): machine
labels are context-bound to a physical machine used for one exercise, so they're
curated per exercise. The association builds **automatically** on first logged
use (set-logs inserts it) and can also be curated directly on `/exercises`:
`GET/POST /api/exercises/[id]/machines` (list with logged-set counts / add),
`DELETE …/machines/[machineId]` (remove the association only — the machine and
its history stay), `PATCH /api/machines/[id]` (edit the note). Removing from the
curated list never orphans history. The log screen's machine dropdown now reads
this per-exercise list; **"No machine"** stays the empty selection (the
portable/free lane the progression core treats as un-rebaselined).

### Verified
- 95 tests pass (adds an offline session-delete test); clean tsc/lint/build;
  `src/core/*` untouched.
- Browser + DB: offline delete drains on reconnect; collapse re-points a logged
  set to the library entry with no orphans; machine add/edit-note/remove and
  auto-associate-on-log all work.
- Migrations 0011 + 0012, IndexedDB v4 — **LOCAL only**; prod held for review.

## Prod brought to parity (session-model v2)

Production Neon DB was found **4 migrations behind** the deployed code (applied
0000–0008; missing 0009–0012) with the pre-merge seed (curated 37 / library 873,
twins unmerged) — the cause of the broken prod app beyond the service-worker
bug. Diagnosed via `scripts/inspect-db.sql` + `/api/health` (read `behind:true,
applied:9`).

With explicit user approval, ran `db:migrate` → `db:seed` → `db:seed:library`
against Neon's **direct** (non-pooled) endpoint (the pooled endpoint can choke
drizzle-kit migrations). Result: 13/13 migrations, `client_session_id`
backfilled (0 nulls), curated 41 / library 835 / custom 4, merges applied.
**User logged history preserved** (2 workout_logs, 6 set_logs intact).

- `db:seed:library` is slow over a remote connection (873 single-row ingests —
  ~minutes vs. seconds on the local socket); needs a long timeout or a
  background run against prod.
- **Known residue:** `lib_Hack_Squat` was left in place (the merge's guard
  refused to delete it because prod logs/program reference it), so "Hack Squat"
  appears twice in prod search. Cosmetic; resolvable by re-pointing its
  references to the curated `hack_squat` then deleting the twin.
- The exposed Neon credential was used with the user's temporary say-so;
  **rotation is still outstanding.**

## Batch: sync-issue + remaining fixes (session-model-v2 follow-ups)

### #1 — "not synced" that never clears (third sync-adjacent data-integrity bug)

**Verified first (prod, read-only):** the user's first real logged session
(`workout_log` id 3, `client_session_id 14afea9b…`, "Chest + triceps + Abs") is
**fully on the server** — 9 occurrences, 24 set_logs, `finished_at` stamped. The
last occurrence (`hanging_leg_raise`) legitimately has 0 sets (added, never
logged). Nothing local-only; nothing at risk from an IndexedDB bump. So this is
hypothesis (a): a display/counter bug, **not** data loss.

**Root cause (removal path).** `removeOccurrence` deleted the local occurrence
and marked its *own* synced sets `pending_delete`, but left the **surviving**
occurrences `synced: true`. The occurrence sync loop skips any session whose
occurrences are *all* `synced` (`occs.every(o => o.synced) → continue`), so the
shortened list was **never re-POSTed** — and the server prunes removed
occurrences only when it receives the new list. The dropped occurrence therefore
lingered server-side forever, inflating the server's exercise count so the
sessions list's `exerciseCount` mismatch arm showed a **permanent, false "not
synced"** while `sync()` honestly reported success. (Every other pending signal —
finish stamp, unsynced occurrence/set, delete queue — self-heals on the next
successful drain, which the sessions page already triggers on mount; the count
mismatch was the only non-self-healing one.)

**Fix.** `removeOccurrence` now dirties one surviving occurrence
(`synced: false`) so the next sync re-POSTs the pruned list and the server-side
prune runs. Regression test added (`sessionStore.test.ts` → "removing a synced
occurrence re-syncs the shortened list") — it fails on the old code (no re-POST)
and passes now. Degenerate edge left as a known gap: removing the *last*
occurrence leaves nothing to dirty, so an empty session's server occurrences
aren't pruned; users delete the whole session instead, so not fixed here.

**Note on the user's specific session:** id 3 has no server orphan, so they
didn't leave a dangling occurrence — the badge they saw was either this bug on a
session where a removal *was* left dangling, or a transient finish flag that
self-heals on the next drain. Data is safe either way; the one persistent,
non-self-healing cause is now fixed.

### #2 — exercise-mapping audit (verify-only): all correct, no fix needed

Verified against prod (read-only). **The three that must stay custom were NOT
force-mapped onto a library name** — all have `canonical_name` and `library_id`
NULL, and are fully tagged:
- `back_extension` "Seated Back Extension Machine" — source curated, pattern
  `spinal_extension`, `lumbar_spine`; spinal_erectors(1)/glutes/hamstrings. NOT
  collapsed into "Hyperextensions" (that stays a separate untagged library row
  `lib_Hyperextensions_Back_Extensions`).
- `rotary_torso_machine` — curated, pattern `trunk_rotation`, `lumbar_spine`,
  obliques(1).
- `bayesian_curl` — source custom, pattern `elbow_flexion`, biceps(1)/forearms.

(Nuance: back_extension/rotary_torso are `source=curated`, bayesian_curl is
`source=custom` — but the invariant that matters, "not mapped onto a library
entry," holds for all three.)

**Net-new are intact and fully tagged:**
- `face_pull` — `rear_delt_fly`; muscles **exactly mirror `reverse_pec_dec`**
  (posterior_deltoid 1 / rhomboids 0.5 / mid_traps 0.5), so it substitutes for
  reverse pec dec as intended.
- `barbell_squat` — `squat`, `lumbar_spine`, quads(1) + glutes/hams/adductors/
  spinal_erectors/calves.
- `stiff_legged_barbell_deadlift` — `hinge`, `lumbar_spine`, hamstrings(1)/glutes(1).
- `hack_squat` — `squat`, quads(1); **no `lumbar_spine`** (machine, not a barbell
  hinge/squat — correct per the rule).

**Orphan check:** zero logged rows (set_logs / cardio_logs / session_exercises /
program_exercises) point at a missing exercise. Watch-list pairings untouched.

### #3 — Hack Squat prod duplicate resolved (approved prod write)

`lib_Hack_Squat` was referenced only by one `program_exercises` row (day
`legs_shoulders`, order 10) — no logged sets/cardio/occurrences, and curated
`hack_squat` was not already in that day (no dup risk; `program_exercises` has no
unique on day+exercise anyway). In one transaction: re-pointed all FK tables
(only program_exercises had a ref) onto `hack_squat`, then deleted the twin
(its `exercise_muscles` cascade). Verified: twin gone, exactly one curated "Hack
Squat" remains, zero orphaned logged rows. The merge map already carries
`hack_squat → "Hack Squat"`, so a future `db:seed:library` stays idempotent (the
twin is excluded on ingest and `removeTwins` now succeeds since the program
reference is cleared). Hardened `removeTwins` to also guard on `session_exercises`
(a plain FK with no cascade) so a session-referenced twin degrades to a warning
instead of hard-failing the seed.

### #5 — machine field always shown (stop inferring), #4 — dropdown verified

**#5:** Removed the load-type gating (`usesMachineTag`/`MACHINE_LOAD_TYPES`) from
both the log page (`StrengthCard`) and the Exercises tab. The machine field now
shows on **every** exercise; the "(none)" option is relabelled **"No machine"**
(the portable/free lane → `machineId` null). No name/load-type inference. This is
data-entry only — the per-machine progression semantics are unchanged because
they key off the same `machineId` null (portable, never re-baselined) vs. label
(context-bound, re-baseline on change). Verified in the running app: the field
renders on all exercises including bodyweight (`Captain's Chair Straight-Leg
Raise`), each defaulting to "No machine".

**#4 (verify-only):** In-app, added "bench by the mirror" on Machine Bench Press
→ it appeared **selected** in the dropdown, **persisted** (rows in `machines` +
`exercise_machines` under `machine_chest_press`), and **survived a reload**. Both
the log page and the Exercises-tab `MachinePanel` read the same
`/api/exercises/[id]/machines` endpoint, so they're consistent by construction.
Offline path is safe by design: `addMachine`'s POST is wrapped in try/catch, and
the set-logs POST re-registers the machine (`insert(machines).onConflictDoNothing`)
+ curates it under the exercise **in the same transaction** as the set — so an
offline-created machine referenced by a set can't orphan it on sync.

### #8 — sessions-list delete (X) no longer overlaps the label

The X was `position:absolute; right:10px` over a full-width row, so it sat on top
of the row's date/badges at phone width. Reworked `.rowWrap` into a flex row: the
row button is `flex:1; min-width:0` (shrinks, content wraps in its box) and
`.rowDelete` is a static `flex:0 0 auto` sibling with an 8px gap. Verified at
375px: row ends at 309px, X starts at 317px — no overlap.

### #6 — optional exercise description; #7 — add/remove in the Exercises tab

**#6:** New nullable `exercises.description` column (migration `0013`,
EXPECTED_MIGRATIONS → 14). `PATCH /api/exercises/[id]` accepts `description`
(empty string clears to null; never required); `GET /api/exercises/manage`
returns it. The Exercises tab gets an "Add/Edit description" textarea per row and
renders the saved text. Works for custom and "your name → library" alike.

**#7 add:** Reuses the existing `ExerciseSearch` component (library/curated
search + create-custom-with-movement-pattern) behind a "+ Add an exercise"
toggle; on pick/create the list reloads.

**#7 remove — history-safe:** New `DELETE /api/exercises/[id]`. It counts every
referencing row (set_logs, cardio_logs, session_exercises, program_exercises,
exercise_substitutions on either FK, form_checks); if any exist it refuses with
**409** + a `blockedBy` breakdown and never deletes (the FKs have no cascade, so
history can't be orphaned) — the UI then shows "has N logged entries … blocked,
collapse first or keep" with only a **Keep** action. With zero references, a
confirm → delete removes the row (exercise_muscles/exercise_machines cascade).
Verified end-to-end in-app: add custom (201) → set description (persists, shows in
manage) → delete unused (200, gone) → delete "Leg Extensions" with history
(**409**, kept).

**Prod migration applied:** `0013_*.sql` (add `description`) was run against the
Neon prod DB with the user's explicit approval (additive nullable column, no data
touched). Verified: column present, prod at **14/14** migrations. Prod is safe to
deploy — no auto-deploy + manual-migration gap this time. (Neon credential still
UNROTATED — user's standing task.)

## Batch: machine "Unspecified", finish-flag honesty, occurrence-dirty edge

### Machine default — "Unspecified machine" vs "No machine"
The machine dropdown now offers **"Unspecified machine"** (the neutral default) and
**"No machine"**, plus any named machines — on every exercise. "No machine" wrongly
asserted no machine is used; "Unspecified" means "on a machine, didn't label which".
**Both resolve to `machineId = null`** (the portable/free progression lane), so this
is a labelling change only — it never splits an exercise's history and the core is
untouched (progression still keys on null vs. a named label). A future option to make
"Unspecified" its own tracked bucket would be an additive, separate change.

### Finish-flag "not synced" — honest diagnosis + deterministic reconcile
The earlier removeOccurrence fix addresses a bug whose signature is a **server-side
orphan** (→ count mismatch). The user's session 3 has **no orphan**, so that fix does
**not** explain their symptom — "self-heals" was withdrawn as an unfounded assumption.
For a clean-on-server finished session the badge can only fire from (1) a stale local
`finishSynced=false` while the server already has `finished_at`, or (2) a local/server
occurrence-count mismatch. Changes:
- **`reconcileFinishedFromServer(ids)`** (store): on the sessions page refresh, any
  session the server reports finished has its stale local `finishSynced` flipped true
  deterministically (the finish IS on the server) — no waiting for a re-drain. Test added.
- The sessions-list badge now shows the **reason**: "not synced · finish" or
  "not synced · list (local N / server M)" — so on the phone the cause is visible, not
  masked. This is the diagnostic: if session 3 still flags after deploy, the badge says
  which arm, and we keep digging (not closed until the phone confirms).

### Item 3 — occurrence-dirty edge (last/only occurrence) — PROPOSAL, not yet built
The current fix dirties a surviving occurrence to force a re-POST. Confirmed hole: with
**zero survivors** (remove the last occurrence) there's nothing to dirty and the
occurrence sync loop (which iterates existing occurrences) never re-POSTs, so the server
keeps the stale row — same bug in the corner. Multi-removal down to ≥1 survivor is fine
(regression test added). **Proposed** cleaner model: a session-level `occurrencesDirty`
flag set on add/remove/reorder and cleared when the list POSTs — dirtiness lives on the
list where it belongs, and the empty-list case falls out naturally. Held for user
sign-off (don't unilaterally rework the sync state machine). The last-occurrence
regression test is committed as `it.skip`, ready to un-skip when the flag lands.

### Item 3 — occurrencesDirty flag (approved, built)
Replaced the survivor-dirtying hack with a session-level `occurrencesDirty` flag —
dirtiness is a property of the ordered list, not any single occurrence. Set on
add/remove/reorder (`markOccurrencesDirty`), cleared when the list POSTs. The
occurrence sync loop now iterates **all** sessions (not just those with
occurrences) and syncs any that are dirty or have an unsynced occurrence — so
removing the **last** occurrence still re-POSTs a now-empty list and the server
prunes the stale rows (the corner-case hole is closed). `pendingCount` counts a
dirty list once (added only when no unsynced occurrence already accounts for it,
so no double-count). `hydrateFromServer` marks hydrated sessions clean. Regression
tests: multi-removal down to one survivor, and last-occurrence removal → empty
re-POST (both passing; 19/19 in the store suite).

## Batch: session-3 phantom heal + list-arm reconcile proposal

### Audit correction (item 1)
The earlier "zero orphans" audit checked the wrong definition: it looked for logged
rows pointing at a *missing exercise* (referential integrity) and read se#9's 0 sets
as a legit "added, never logged" occurrence. It did NOT check for a *stale server
occurrence the client no longer has* — which is the removeOccurrence signature. The
badge's `local 8 / server 9` is that: the client removed hanging_leg_raise, the
server kept it. "Verified, no orphans" only counted the wrong definition. Lesson: to
detect this class, compare the server occurrence list against the client's count, or
scan for finished-session occurrences the client dropped — not just dangling FKs.

### Contamination check (item 2) — clean
The phantom (`se#9`, hanging_leg_raise, log 3) had **0 sets / 0 cardio**, so it fed
nothing into volume/volume-load — the core reads set_logs and there were none on it.
All 24 sets were `3 × 8` real occurrences, every one linked. A prod-wide audit for
the signature (finished-session occurrences with 0 sets AND 0 cardio) found exactly
one row — se#9 — so no other session is contaminated. This was list-integrity, not a
core-input bug.

### Heal (item 3) — done, prod write
Deleted the confirmed 0-set phantom `se#9` (guarded: aborts unless it's exactly
hanging_leg_raise with 0 sets/0 cardio). Before: 9 occ / 24 sets. After: 8 occ / 24
sets, all 24 still linked, 0 orphaned. Server now matches the client's 8; the badge
clears on next refresh. No training data touched.

### Item 4 — list-arm auto-reconcile: PROPOSAL (recommend: do NOT blanket auto-heal)
The finish-arm reconcile is safe because it only *flips a local flag* to match a fact
the server already holds (finished) — it deletes nothing. The list arm is different:
reconciling a count mismatch means one side's occurrences get pruned. A blanket
"finished session with server≠local → auto re-POST local" is **dangerous**: if the
local store is the wrong side (IndexedDB version bump wiped it, or partial hydration),
re-POSTing a short list makes the server prune **real** occurrences — and the current
`/api/session-exercises` prune is unconditional, so it would take their logged sets
too. That violates "never mass-delete data" for the sake of a cosmetic badge.
**Recommended safer design (needs sign-off, not built):**
1. Harden the server prune to **refuse to delete an occurrence that still has logged
   sets/cardio** (report it instead). Legit removals already zero-out sets first, so
   this doesn't change normal behaviour — it just caps the blast radius of a stale
   re-POST so logged history can never be auto-deleted.
2. Heal stale sessions via an **explicit, user-initiated "reconcile" button** on the
   flagged session (re-POST the local list), not an automatic background heal.
Keeping it fully manual (as we did for session 3) is also acceptable given
occurrencesDirty prevents recurrence. Deferred to the user.

### Item 5 — regression test
Added a characterisation test for the pre-existing stale state (clean dirty flag +
shorter local list, reproduced by simulating the old un-dirtying removal directly in
the store): plain sync() does not re-reconcile it and pendingCount reports 0 — the
exact reason session 3 sat broken. Guards against an accidental (unreviewed) auto-heal.

### Item 4 — safe reconcile (APPROVED, built)
Two parts, per the chosen option:
1. **History-safe prune** in `POST /api/session-exercises`: an occurrence dropped
   from the client's list is pruned **only if it has no logged sets/cardio**; any
   with logged data is kept and reported in `keptWithHistory`. This caps the
   blast radius so a stale/wiped client can never make the server auto-delete real
   history. Verified in-app against the dev DB: omitting a set-bearing occurrence
   returns `keptWithHistory:[…]` and keeps it; omitting a setless one prunes it.
2. **Paired client retry (two-pass)**: because occurrences sync *before* sets, a
   legit removal of an occurrence that still has synced sets is kept on pass 1
   (`keptWithHistory` → session stays dirty), its sets delete in the set/cardio
   loops, then a **second occurrence pass** re-POSTs and it prunes cleanly — no
   phantom, no lost sets, all in one sync. `pushOccurrences` only clears
   `occurrencesDirty` when the server fully reconciled (`keptWithHistory` empty).
3. **Explicit heal**: `reconcileOccurrenceList(sessionId)` (dirty + sync) behind a
   **"Reconcile"** button that appears on a sessions-list row flagged
   `not synced · list (…)`. User-initiated, never automatic (wrong-side-wins). It
   treats the local list as source of truth but, thanks to (1), cannot delete
   logged history.

Tests: stateful-server test proving the guard + two-pass heal (remove an
occurrence with a synced set → server keeps it → set deletes → pruned, no phantom,
no lost set). 21/21 store tests; clean build.

## Batch: refusal-path heal (this-device-is-behind) + prod URL

Prod URL recorded in README: **https://fitness-app-self-pi.vercel.app** (health at
`/api/health`). Confirmed `6ba5867` deployed green — `{"ok":true,"migrations":
{"applied":14,"expected":14}}`.

### Refusal path has a user-facing story now
The guard keeps set-bearing occurrences and `occurrencesDirty` only clears on full
reconcile — so if THIS device is the stale side (the server holds sets it never
knew about), it has no deletes to fire, the two-pass can't resolve it, and
Reconcile would be a silent no-op forever. Fix:
- New session flag **`occurrenceConflict`**: set when `pushOccurrences` gets a
  non-empty `keptWithHistory` on the **second** pass (i.e. after our own deletes
  ran, the server still refuses — proof this device is behind, not mid-removal).
  Cleared on any clean reconcile.
- Badge reads **`not synced · this device is behind`**; the row shows a **"Pull
  from server"** button instead of Reconcile.
- New store fn **`rehydrateLocalFromServer(server)`**: local-only wipe of the
  session + rebuild from the server's authoritative copy (`GET /api/sessions/[id]`),
  pulling the missing occurrences + their sets/cardio back. Never a server delete;
  the server is the source of truth in this direction.
- Test: server keeps a set-bearing occurrence the device can't delete →
  `occurrenceConflict` true, pending > 0 → `rehydrateLocalFromServer` restores the
  missing occurrence + set and clears the conflict (22/22 store tests).

Both heal directions now exist and are explicit/user-initiated: **Reconcile**
(local is source of truth, safe via the prune guard) and **Pull from server**
(server is source of truth). No automatic resolution — no wrong-side-wins.

### Item A — IndexedDB migrations made additive (data-loss guard), as its own change
Shipped standalone (not folded into a schema bump) so the guard is verified before
anything relies on it, and so the migration function stops being a destructive
*template* for the next agent to copy. Extracted the inline `upgrade` into
**`migrateSessionDb(db, oldVersion)`**: additive by default, each future version an
`if (oldVersion < N)` create-only block; the drop-and-recreate is scoped to
`oldVersion < 4` and clearly labelled a historical one-off (pre-v2 stores can't map
to the occurrence model). `getDb()` now passes `oldVersion` through. Verified in
isolation: a v4→v5 bump through `migrateSessionDb` preserves all stores AND their
data (incl. an unsynced in-progress set) — and the test genuinely fails if the drop
runs unconditionally (checked by temporarily widening the guard). Updated the two
CURRENT_STATE traps from "bumps are destructive, be careful" to "migrations are
additive; never drop a store with live data." B–E from the prior audit remain notes.

## Batch: logging depth (rests, drop sets, true loads, unilateral)

### Part 0 — non-destructive upgrades: verified, and no v5 bump needed
Item (A) already shipped (`migrateSessionDb(db, oldVersion)`, additive-by-default,
v4 drop fenced as historical one-off, isolated guard test, negative-tested). For
this batch specifically:
- **No IndexedDB version bump is required.** All new logging fields (`loggedAt`,
  `restSeconds`/`restSource`, `dropGroupId`, `side`, `loadEntered`/`builtinOffset`)
  are per-record additions — IndexedDB is schemaless per record; bumps are only for
  new stores/indexes. None needed; grouping/filtering (e.g. drop groups) is done
  in memory over a session's few dozen sets, per user's instruction to prefer
  in-memory filtering over a structural by-drop-group index.
- Guard test extended: a pre-bump unsynced set carrying **all** the new fields
  round-trips a v4→v5 bump intact (asserted field-by-field).
- **Drain-before-upgrade: not built, by analysis.** The `upgrade` callback is
  synchronous and runs inside `openDB` — reading pending rows requires opening the
  DB, which is what triggers the upgrade (chicken-and-egg), and a sync drain can't
  be awaited there. It's also moot: additive migrations never touch existing rows,
  so there is nothing a missed drain can lose. Recorded instead of implemented.

### Parts 1–2 — rest tracking + drop sets (migrations 0014/0015, local only so far)

**Schema (all additive nullable).** 0014: `set_logs.logged_at` (client-stamped —
`created_at` is server insert time, which lies for offline sets), `rest_seconds` +
`rest_source` ('timed'|'derived'|'user'; both null = unknown, never fabricated),
`drop_set_group`. 0015: `set_logs.side`, `load_entered`, `builtin_offset` (columns
land now since the routes carry them; features arrive in Parts 3–4). `load` stays
the effective TOTAL — the core reads exactly what it read before (untouched).
EXPECTED_MIGRATIONS → 16. **Prod not migrated yet** — will propose the prod
migration before the batch deploys.

**Rest derivation (`deriveRest`, exported + unit-tested).** Gap = loggedAt −
previous set's loggedAt in the same session (cross-exercise — that's real rest).
Plausibility band: gap < 30s (batch logging) or > 8min (walked away) → unknown;
else rest = gap − reps × 3.5s, clamped ≥ 0, source `derived`. Timer value wins as
`timed`; chip tap-edit becomes `user` (highest trust) and re-syncs. Legacy rows
(no logged_at) honestly show "rest —". Drop rows don't show a rest chip; if the
drop is logged slowly enough to land in the band, the derived gap is recorded
(true statement about the log gap; real drops land < 30s → unknown).

**Rest timer.** Page-level tap-to-start count-up (shared ref); the next logged set
consumes it exactly once as its `timed` rest, then the timer idles. Optional
minutes target fires a Notification (permission-gated). Pure client state —
offline-safe.

**Drop sets.** "+ Drop" on any set row: assigns a client-generated `dropGroupId`
to the parent (pending_update if already synced), opens a pre-linked entry (weight
blank, reps prefilled), and the drop logs as its own row sharing the parent's
occurrence AND set number. Rendered indented with "↳ drop" under the parent
(groups pulled together in display order, in-memory — no new index). Volume math
untouched (each row's load × reps counts).

**Verified in the running app:** rest chip live, tap-corrected 1:45 → synced as
`rest_source='user'`; timer → "rest 0:20 · timed", consumed once; drop nested,
shares group + set_index server-side; all of it survives reload. 111 tests
(deriveRest band, derived/timed/user transitions, drop numbering + sync), clean
build.

### Parts 3–4 — true loads, Machines section (surrogate keys), unilateral sides

**Machines surrogate-key model (approved).** `machines.id` is now an opaque
stable key: historical rows keep their old label-as-id (zero history rows
rewritten — proven by migration 0016's before/after counts: 3→3 machines, 1→1
set refs, 2→2 exercise links, labels 100% backfilled, 0 orphans), and NEW
machines get client-generated uuids (offline-first identity, same pattern as
sessions/occurrences). `label` is display-only, so a rename touches ONE row and
labels no longer need global uniqueness or to carry data. 0016 also adds
`built_in_weight` (additive offset — deliberately NOT reusing `counterweight_lb`,
which subtracts) and `machine_type`; brand/gym/notes already existed.
EXPECTED_MIGRATIONS → 17. Prod not migrated yet (proposed with the batch deploy).

**Machines APIs.** `GET /api/machines` returns the managed list (fields +
referenced exercises + logged counts). `PATCH /api/machines/[id]` edits fields;
**rename into an existing label → 409 `duplicate_label` with the existing id — an
explicit warning offering merge, never a silent merge** (user condition).
`DELETE` refuses (409) while logged sets reference the machine.
`POST /api/machines/[id]/merge {targetId}` re-points set_logs + exercise_machines
(deduped) then deletes the source — the collapse pattern, kept for genuine
merges. Set-log auto-registration now carries `machineLabel` so an
offline-created machine lands server-side with its real label.

**/machines page** mirrors /exercises: label + structured fields (gym, brand,
model, built-in weight, type) + free-text description, per-machine "used by"
exercise list + logged count, edit / merge-into / history-safe delete, and the
duplicate-label warning UI with a one-tap "merge into the existing one".

**3a true loads.** Effective load = entered + known additive offset (selected
machine's built-in weight auto-applied; manual "+ bar/built-in" field when no
machine). `set_logs.load` stays the TOTAL — core/progression/volume unchanged;
`load_entered`/`builtin_offset` record the components and the UI shows the math
("30 + 20 = 50 lb") in the form preview and on logged rows. Additive numerical
weight only; pulley ratios etc. stay descriptive.

**Part 4 unilateral.** `unilateral` exposed through search/manage/program/
substitutions/session-hydration and carried on occurrences (schemaless field, no
IDB bump). Side selector (L / R / L+R) appears ONLY on unilateral exercises;
auto-alternates L→R after each logged set (approved default); drops inherit the
parent's side; each side-set is its own row so volume falls out naturally. The
tag is visible + toggleable per exercise in /exercises (PATCH; your copy
overrides the library default).

**Verified in-app:** uuid machine create (201) → one-row rename → duplicate-label
409 with merge hint → merge → guarded delete (409 with sets / 200 without);
"curl station +20 (+20 built-in)" in the dropdown, live "= 30 + 20 = 50 lb"
preview, logged row "30 + 20 = 50 lb × 8 · L", server row load=50/entered=30/
offset=20/side=left with the uuid machine ref; side selector on the unilateral
card only, auto-alternate L→R observed; /machines page renders all of it.
112 tests, clean build, src/core untouched.

### Batch shipped — prod migrated 14→17, then deployed
With approval, ran migrations 0014–0016 against prod Neon (direct endpoint),
migrate-then-deploy ordering. Proof: BEFORE {migrations 14, machines 7, set_logs
30 (7 with machine), exercise_machines 4} → AFTER {migrations **17**, machines 7,
set_logs 30 (7 with machine), exercise_machines 4, **labels backfilled 7/7, 0
null, 0 orphaned machine refs**} — zero rows touched beyond the label backfill.
Pushed `2c361de` to main (Vercel auto-deploy); /api/health confirmed on the live
URL after deploy. (Neon credential rotation remains the user's task.)

## Batch: rests, sides, dates, Equipment model

### 1a — stable session date (real-data bug)
Editing+re-finishing an old session had been jumping it to "today": the list
displayed/sorted by `finished_at`, which deliberately re-stamps. Fix: new
`workout_logs.first_finished_at` (migration 0017, EXPECTED→18), stamped exactly
once (server keeps `coalesce(existing, clientFirst)`; client `finishSession`
stamps `firstFinishedAt` once and sends it with every finish POST so a lost
first POST can't corrupt it). The sessions list now displays **`date` (creation
day, parsed as local calendar parts) + first-finish time-of-day** and sorts by
`date` then `firstFinishedAt` — `finished_at` keeps re-stamping for its own
purposes but nothing user-facing moves. Backfill: `first_finished_at =
finished_at` where null; the corrupted session's display self-heals because the
date anchor is `date`, which was never rewritten. **Item B (finishSynced
re-finish blind spot) is now moot for display**: the only consumer of the exact
`finished_at` instant was the list, which no longer reads it. Verified in-app:
re-finished the Jul-13 session (finished_at → Jul 16), list before/after
identical, still "Jul 13".

### 1b — sides retroactively editable; "L+R" → "Alternating"
The set editor now shows the L / R / Alternating selector on any set that
carries a side (PATCH ships the change), so a prior session's mis-tagged side is
fixable. "L+R" renamed to **Alternating** everywhere (selector + row tag); the
stored value stays `both` — display-only rename, no data migration. Verified
in-app: edited a historical `· L` set to `· R`.

### Part 2 — rest is an edge between sets (restBefore), set-level timer, mm:ss mask

**2a — model.** `rest_seconds` now means **restBefore, scoped to the occurrence**:
N sets = N−1 rests, null on set 1. Derivation only looks at prior sets of the
SAME occurrence (instanceId) — the gap across an exercise boundary is an
inter-exercise transition and is excluded entirely (never derived), which leaves
room for explicit inter-exercise rest slots later without blocking them. UI: set
1 of an occurrence shows no chip at all; drops still show none. Migration 0018
(hand-written) nulls the phantom `derived` rests that had landed on the first
set of each occurrence (min id per session_exercise_id); `user`/`timed` values
are never touched. Stale phantom values in a device's local store are simply
never displayed (set-1 chips are gone) and never re-synced. Boundary behavior is
unit-tested (A→B transition in-band → null; B's second set derives from B set 1).

**2b — set-level timer that does the work.** The session-level timer is gone.
Each exercise card gets its own tap-to-start timer under its logged sets:
stopping it (or hitting the optional minutes target, which also notifies) HOLDS
the elapsed value — shown as "rest m:ss → next set" with a discard × — and the
next set logged in that card records it automatically as restBefore, source
`timed`. No manual entry. Verified in-app: start → "⏱ 0:03 · stop" → held →
logged set reads "rest 0:03 · timed".

**2c — duration mask.** Rest editing is a digits-only mm:ss mask: non-digits
are stripped, the colon is auto-placed filling from the right ("145" → 1:45),
seconds clamp to :59, bounded to 59:59. Verified in-app: typing "a1x4!5"
displays "1:45" and saves 105s as source `user`.

### Part 3 — Equipment model (built on the approved proposal)

**Definition (authoritative): equipment = how resistance is applied to a
strength set. If it doesn't change how a load is recorded or compared, it isn't
equipment** (belts/straps/chalk = notes; cardio keeps its own model).

**Two fields.** `set_logs.equipment_type` (always a real answer, pre-selected
from the exercise's load_type — free_weight resolved by name keyword with a
zero-offset dumbbell fallback — and remembered per exercise) + `equipment_id`
(WHICH unit, only for context-bound types: cable/selectorized/smith/
plate_loaded). "No machine"/"Unspecified machine" are gone as top-level options;
unspecified is a unit-level state of a context-bound type.

**Offsets (3b registry in src/lib/equipment.ts, NOT core).** Standardized tools
get real defaults (Olympic 45); weak typicals are FLAGGED (EZ ~20, Smith ~20);
plate-loaded defaults to UNKNOWN (null) with a per-unit prompt — never guess.
**Safety condition honored:** a keyword/type default may pre-select a non-zero
offset but never silently applies — effOffset stays 0 behind an explicit
"apply +45?" confirm, remembered per (exercise,type); named units' stored
offsets are explicit and need no prompt. Per-set offset edits override the set
only. Verified in-app: Olympic pre-select showed NO math until the one-tap
confirm, then "= 45 + 45 = 90 lb".

**Pulley ratio (3c).** Structured `pulley_ratio_kind` (1:1|2:1|other|unknown)
replaced the never-used numeric (guarded drop; verified all-null local+prod
first). NEVER in load math — an additive offset doesn't cancel out of
percentage comparisons, a lane-scoped multiplicative ratio does; folding it in
would also fake precision. Codified as a test: the load pipeline files contain
no pulleyRatio reference.

**Lanes (3e).** Adapter-computed opaque string handed to the core: named unit →
its raw id (every pre-existing lane unchanged — zero re-baseline blips from the
migration); context-bound w/o unit → "type:unspecified" (its OWN lane, not
portable — Smith loads don't transfer); portable types → null. Recalibrate ≠
reset: switching lanes shows "Recalibrating for this unit — you were at N on
another unit (effort + volume carry over)" (verified in-app). Session-level
relabel: naming a unit mid-session re-points THIS session's unspecified sets of
that type (verified: the unspecified 130-lb set moved onto the new uuid unit);
prior sessions never backfilled. Cross-unit conversion ratios deferred.

**Core self-check, stated precisely.** The core never sees the new model: no
registry import, no type/offset/ratio vocabulary (guard test). Nuance
surfaced honestly: `src/core/progression.ts` has ALWAYS consumed the seed's
load_type taxonomy for its per-load-type increment table (spec §9, Milestone 2)
— pre-existing, untouched, and distinct from the Equipment model; the core's own
`laneKey(exerciseId, machineId)` grouping helper is generic. The guard test
encodes exactly this boundary so Codex inherits it.

**3d modal** captures label/gym/brand/offset/pulley/description mid-session
(offline-safe: client uuid + set-sync auto-registration carries label+type+
offset). Migration 0019 proven (metadata-only renames; 4→4/2→2/3→3). Prod
migrations 0017–0019 pending the batch-ship proposal. Lane param: progression +
last-session accept `lane` (with machineId back-compat).

### Batch shipped — prod migrated 17→20, then deployed
Migrate-then-deploy ordering held. Proof: BEFORE {migrations 17, machines 9,
set refs 6, links 5, set_logs 30, finished 1, pulley values 0 (guard
precondition), phantom first-set derived rests 0 (prod sessions predate rest
tracking — 0018 was a no-op there by design)} → AFTER {migrations **20**,
equipment 9 (renamed, same rows), set refs 6, links 5, set_logs 30,
first_finished_at backfilled 1/1, pulley_ratio_kind defaulted 9/9, **0 orphaned
equipment refs**}. Zero rows touched beyond the two backfills. Pushed `c211ad9`;
/api/health confirmed on the live URL after the new build served. (Neon
credential rotation remains the user's task.)

## Batch: post-deploy fixes (times, sides, offsets, equipment polish)

### 1 — session time: hypothesis (a) CONFIRMED, plus the UTC date-boundary bug
Diagnosis from prod: session 3's `first_finished_at` = **Jul 15 10:47 PM local**
— exactly the moment the user edited/re-finished — because the 0017 backfill
copied `finished_at`, which the edit had already re-stamped. Display rendering
was already local (hypothesis b rejected for the list). The user's related risk
was REAL though: `todayIso()` derived the session date from `toISOString()`
(UTC), so an evening session after ~8 PM Eastern filed to the NEXT day — fixed
to local calendar parts (display and date-boundary logic are always local; only
storage is UTC). Audit found no other raw-UTC rendering (all display paths use
toLocaleDate/TimeString; date strings parse as local parts).
Recovery: the session's only timestamped sets are Jul-16 edits (originals
predate logged_at), so max(logged_at) would be WORSE — per the honest-unknown
rule the correction NULLs first_finished_at when no set timestamp lands on the
session's own date and the current value's local date contradicts `date`
(display shows the date alone, no fabricated time). Sessions with same-day set
timestamps get first_finished_at := max(logged_at) (true end ≈ last set).

### 2 — side selector condition fixed: "exercise is unilateral", not "set has a side"
The verified-wrong condition meant pre-feature sets could never gain a side. Now
the editor shows the selector when the EXERCISE is unilateral (new lightweight
GET /api/exercises/[id] refreshes the flag so occurrence snapshots taken before
the tag was set don't hide it) — verified by ADDING a side to a historical
no-side set. Lesson recorded: verify the case the user hit, not a neighboring one.

### 3 — "+ built-in" hidden for zero-offset types
Shown only where the equipment's own constant exists: non-zero defaults
(Olympic/EZ/Smith) or unknown (plate-loaded), or a unit with an explicit stored
offset. Hidden for bodyweight/dumbbell/kettlebell/fixed-barbell/cable/
selectorized (effOffset forced 0). This is definition, not inference — the type
selector stays always-visible. Added weight (belt/vest) stays in the existing
load input, untouched. Verified per-type in-app.

### 4/5/6 — equipment nav returns to Sessions (+ full links row incl. Blocks);
"machines" copy fully renamed in /equipment + the exercises panel (type labels
like "Smith machine" are correct and kept); the add-unit modal fits at 375px
(flex inputs got min-width:0 / wrap; verified 0 overflowing elements).

### Prod time correction executed (approved) + follow-up flagged
Prod: exactly 1 row — session 3 first_finished_at "Jul 15 10:47 PM" → NULL
(rule B; its original sets predate logged_at so rule A had nothing). The list
now shows "Jul 14" with no time — an honest blank, never an invented value.
Local dev run also surfaced the UTC date-shift bug live in old dev data (an
8 PM session filed to the next day) — the todayIso fix stops new occurrences.
**Flagged for next batch (user-accepted):** editable session date/time,
recorded as user-provided (source-tagged like rest 'user'), so mornings-after
logging and this session's ~5 PM Jul-14 truth can be set BY the user —
traceable input, not a system guess. Medium change (column + session-meta sync
path + PATCH + UI) — deliberately not rushed into this batch.

## Editable session date/time (user-provided, source-tagged) — shipped

The honest fix for morning-after logs and the corrupted-stamp session: the user
sets the date/time, recorded as THEIR input.
- **Schema (0020, EXPECTED→21):** `workout_logs.first_finished_source` — 'user'
  when user-set (same pattern as rest_source 'user'), null = system. While
  generating this, found + healed **snapshot drift**: 0018/0019 were hand-written
  without snapshots, so drizzle-kit hit an interactive rename prompt on every
  generate. Rebuilt the 0020 snapshot from schema.ts (chain ids preserved);
  `generate` now reports "no schema changes" — future migrations diff cleanly.
- **Store:** `editSessionMeta(id, {date, firstFinishedAt})` → sets source
  'user' + `metaDirty` (the occurrencesDirty pattern); a new sync loop PATCHes
  `/api/sessions/[id]` after the creation paths (a 404 = session not on the
  server yet → edit stays pending, retried, never an error). `pendingCount`
  counts it; the badge reads `not synced · date/time edit`. `finishSession` (and
  the server finish route) never overwrite a user-set — or user-CLEARED — value:
  blank time is an honest blank and re-finishing can't re-stamp over it.
- **UI:** tap the date in the session header → date + optional time inputs (local
  wall-clock → UTC storage); the header and tooltip show "set by you".
- **Verified in-app:** edited the dev session to Jul 14 5:00 PM → header
  "2026-07-14 · 5:00 PM · set by you", server row {date 2026-07-14,
  first_finished_at 21:00Z, first_finished_source 'user'}, sessions list
  re-sorted to "Jul 14 · 5:00 PM", badge drained. 125 tests (4 new: edit→PATCH
  drain, 404-retry, finish-never-overwrites, user-cleared stays null).
- **Prod:** migrated 20→21 (additive nullable column; logs 2→2, sets 33→33).

## Post-session data fixes: phantom drops, offset gap, duplicate set index

Three issues found in the user's real prod session (read-only diagnosis first).

### Phantom drop-set tags (bug)
`startDrop` ("+ Drop") tagged the PARENT set with a group id immediately on tap,
before any segment was committed. Tapping "+ Drop" then not adding a segment left
the parent alone in a group — a singleton, which the UI never renders as a drop
(needs ≥2), so it looked normal but the stray tag persisted (3 in prod: Machine
Bench set 3, Ab Crunch set 2, Rotary set 1). Fixes:
- **Code:** the parent is now tagged in `addDrop`, atomically with the committed
  segment — a singleton can no longer be created.
- **Durability:** the set PATCH re-sends `dropSetGroup` from the local row, so a
  stale phone could re-push the tag after a prod cleanup. Added
  `healSingletonDropGroups(sessionId)` (runs on log-page load): nulls any
  persisted singleton group (only legacy data can be a singleton now), syncing
  the clear idempotently. Self-heals every device, not just prod.
- **Prod:** nulled the 3 singletons (before/after shown).

### Duplicate set index (bug)
`setIndex = live.length + 1` collided after a middle set was deleted (delete set
3 of 4 → count 3 → next 4 duplicates the old 4) — the Rotary torso occurrence
read `1,2,4,4,5,6`. Now `max(existing setIndex)+1` (a harmless gap beats a
duplicate). Incidental correctness win: a drop segment no longer inflates later
set numbers (it shares the parent's, and max+1 continues from the real max) — the
existing drop test updated from 3→2. Prod re-sequenced `1,2,4,4,5,6 → 1,2,3,4,5,6`
(cosmetic; volume reads load×reps, never the index).

### Built-in offset — gap, not corruption (to propose)
"Leverage Incline Chest Press" is seeded `free_weight` → suggestEquipmentType →
"dumbbell" (zero offset) → the "+ built-in" field is hidden. The offset field
lives ONLY on the add-set form (affects the next set), and there is NO offset
editor on an already-logged set — so a built-in can't be corrected after the
fact, and changing the add-form value doesn't touch logged rows (correct, but
confusing). Prod shows builtin_offset null / load 100 on all three sets — no
corruption, just no way to add the carriage weight retroactively. NOT auto-fixed:
whether an existing `load` already includes the carriage or not is the user's
call (75+25 vs 100+25). Proposed: a built-in offset editor on the logged-set row
that edits entered + offset with the transparent total shown, user-controlled —
awaiting the user's confirmation of the entered-vs-total semantics before build.

## Built-in offset: persistence + one-machine-one-offset (user's model)

Two related offset issues from real use, now fixed per the user's decision (an
exercise is one machine with one offset; the offset adds on top and applies to
every set — you don't change units mid-exercise).

- **Persistence (unspecified units went blank):** the offset field only ever
  re-derived from the unit/type default, so for an UNSPECIFIED unit (no unit row
  to store it) it reset to blank on re-entry. Now it reads the offset back from
  the occurrence's own logged sets (`builtin_offset`), preferring: named unit's
  stored weight → the occurrence's stored offset → the type default. An
  `offsetTouched` guard stops the async re-derive from clobbering a value you're
  mid-edit.
- **Apply across the board:** a new "apply +N to all M sets" button pushes the
  current offset onto every set of the exercise — total = entered + offset, with
  the ENTERED value preserved (back-derived from an existing total for legacy
  sets, so `100` becomes `entered 100 + offset 25 = 125`). Explicit tap (it
  rewrites logged totals, never silent); for a named unit it also stores the
  offset as that unit's default. The arithmetic is a shared pure helper
  (`offsetPatch`, `equipment.ts`) used by the UI AND its tests so it can't drift.
- **Not browser-click-verified this round:** the in-app browser tool can't take
  the dev auth cookie (httpOnly) and the passcode isn't entered into a login
  field (credential rule), so the offset flow is covered by unit tests
  (`offsetPatch` add/re-apply/clear) + typecheck/build rather than a driven
  click-through. Flagged for the user to eyeball on the phone.

## Finished sessions must survive a PWA reinstall (state persistence)

The user hard-resets (delete PWA → IndexedDB wiped → re-add from the Vercel link)
and saw a finished session revert: exercises un-checked, and Leverage Incline's
equipment type back to "dumbbell". Root cause: two pieces of state lived only
locally and never reached the server, so rehydration couldn't restore them.

### Completed checkmarks (were local-only)
`setOccurrenceCompleted` wrote only the local `completed` store — no server
column. Fix: **completion now lives on the occurrence and syncs.**
`session_exercises.completed` boolean (migration 0021, EXPECTED→22); the
occurrence upsert carries it, GET returns it, `hydrateFromServer` restores it,
`getCompletedInstances` reads from occurrences, and toggling a check marks the
list dirty so it pushes. The legacy `completed` store is still written as a
harmless mirror. Test: check → sync (payload carries completed:true) → wipe local
→ rehydrate → still checked.

### Equipment type/unit reverting (data was fine, UI didn't re-read it)
`set_logs.equipment_type/equipment_id` DID persist and hydrate (prod confirmed:
Leverage sets are `plate_loaded`, offset 25, load 125). The bug was purely the
StrengthCard initialising `equipType` from `localStorage ?? suggestEquipmentType`
— so after a localStorage wipe it fell back to the name-suggested default
(plate-loaded → "dumbbell"). Fix: the card now reads type + unit back from the
occurrence's logged sets first (server truth), with an `equipTouched` guard so an
in-progress pick is never clobbered, and an effect to apply it once sets load
async. No schema change.

Prod migrated 21→22 (additive; occ 8→8, sets 33→33). Not browser-click-verified
(dev cookie httpOnly; passcode not entered into a field per the credential rule)
— covered by the hydrate round-trip test + build. 131 tests, core untouched.

## Batch: known-issues cleanup + doc maintenance

### Part 1 — docs refreshed + made self-maintaining
- **`CURRENT_STATE.md`** regenerated from the live repo (was stale at migration
  0012; now current through 0021/EXPECTED 22 — equipment model, rest-edge model,
  occurrence/session-v2, date-time editor, occurrencesDirty, directional heals,
  completed-sync, additive-migration guard). Mechanical facts moved into an
  AUTOGEN block.
- **`CODEX-ONBOARDING.md`** — updated only the factual sections (phase-table
  Logging-UX row, build-history arc, Immediate-context §8); phase table now points
  to CURRENT_STATE §9 for live status instead of restating it (kills the
  duplication that made it rot). Vision/philosophy/process left as-is (not ours).
- **`SPEC-DRIFT.md`** (new) — section-by-section report of where the built system
  diverged from spec v0.5 (Machine→Equipment + type/instance/offset/lane model,
  RIR→effort tag, occurrence/session-v2, rest-edge, drop/side, load-total
  semantics, inert curated subs, `defaultLoadIncrement` keying on load_type,
  stale §15 status). **Intent is human-owned — the spec is never auto-synced; the
  drift report is the ritual.** For the owner to fold into v0.6.
- **Self-maintenance mechanism:** `scripts/docs-refresh.ts` regenerates the
  mechanical facts (migration count, tables, routes, ~test count) into the AUTOGEN
  block; `scripts/docs-check.ts` fails loudly if that block is stale (same spirit
  as `db:check`); `npm run docs:refresh` / `docs:check`. `AGENTS.md` gains a
  standing rule: refresh docs + append DECISIONS at session end.

### 1d — per-unit load increment (deferred refinement, recorded)
`defaultLoadIncrement(loadType)` in `src/core/progression.ts` keys off the
`load_type` taxonomy — the **last taxonomy remaining in core**. The Equipment
model now makes the increment a property of the **unit** (a given leg-press pins
in 15 lb jumps; a Smith in 10; dumbbells in 5). Clean end state: the adapter
passes an increment from the equipment instance into the core, so core stops
keying on `load_type` entirely and becomes fully equipment-agnostic. Deferred
(not lost) — do when the equipment model carries a per-unit increment field.

### Part 4 — cleanup
- **4a (dead code):** removed the legacy `completed` IndexedDB store's live refs —
  the mirror write in `setOccurrenceCompleted` and the delete-cleanups in
  `deleteLocalSession` + `removeOccurrence`. Completion reads come from the
  occurrence (`getCompletedInstances`). The store *definition* is retained (empty,
  never touched, marked deprecated) per the additive-migration rule — existing v4
  devices keep a consistent schema; nothing reads or writes it.
- **4c (conflict chatter):** the occurrence sync loop (both passes) now skips a
  session already flagged `occurrenceConflict` — re-POSTing local is a dead end
  until the user Pulls, so it no longer spams the POST every sync. First-time
  detection still runs (flag starts false); Pull (rehydrate) clears the flag and
  normal sync resumes. Test asserts zero occurrence POSTs on a post-conflict sync.
- **4d (set-number gaps):** **no change needed** — the UI never renders per-set
  numbers (rows show `load × reps` + effort/side/rest only), so `set_index` gaps
  are invisible; `max(existing)+1` already prevents new duplicates. Adding visible
  contiguous numbers would be a feature, not a fix — not built.
- **4e (historical rest migration audit):** **verified, nothing wrong.** The
  pre-fix model already stored rest *on the set being logged* (restBefore-shaped),
  so there is no off-by-one; migration 0018 only nulled phantom first-set-of-
  occurrence `derived` rests. On prod there were **zero** `derived` rests (rest
  sources: 19 `user`, 14 null) — 0018 was a no-op there and no surviving rest is
  misattributed. Confirmed `first-set derived = 0` post-0018.

## Maintenance batch — approvals (2026-07-16)

Owner approved the default batch with two adjustments (2a storage location, 2b
data-vs-tie-break split). Order below matches the parts.

### 2a — substitution judgment → durable docs (not the table)
The hand-curated `exercise_substitutions` table is inert (71 rows, 0 resolved;
the engine computes candidates from pattern+muscle+equipment). Owner's call:
**don't wire it into the engine** (a second, stale substitution source is the
drift trap) and **don't leave the judgment in the table** — the table references
exercises *by name*, and names change (split/merge/rename), so it would silently
rot. Extracted the only irreproducible asset — the **back-friendly substitution
judgment** (leg press if the back flares, Pallof as the lumbar-safe rotation,
bird-dog/glute bridge for back extension, chest-supported row, split-the-hinge
hamstring work) — into [`SUBSTITUTION-JUDGMENT.md`](SUBSTITUTION-JUDGMENT.md) as
prose. Recorded there and in CURRENT_STATE §9 that this is **soft preference**;
hard exclusion is already enforced by the engine's `affectedStructures` +
`injury_flags` filter. Table retained as documentation-only.

### 4b — equipment_type backfill (prod write, owner-approved)
`set_logs.equipment_type` was null on some named-equipment sets (the type is
recoverable from the linked `equipment` row). Ran an additive backfill on prod:
`UPDATE set_logs SET equipment_type = equipment.equipment_type FROM equipment
WHERE equipment.id = set_logs.equipment_id AND set_logs.equipment_type IS NULL
AND equipment.equipment_type IS NOT NULL`. **Before:** 7 sets backfillable, 0
unresolvable. **After:** 7 updated, 0 remaining. No load/reps/history touched;
only the display type tag. The remaining 29 null `equipment_type` rows are
correctly null (bodyweight / no-equipment sets). Post-backfill distribution:
selectorized 33, plate_loaded 6, cable 6, dumbbell 3, bodyweight 3, null 29.

### 2b — skill_level: populate the data, keep the tie-break
Owner override of the earlier "remove the tie-break" recommendation: the inert
*tie-break* was never the problem — the empty *field* was. Separated the two.
**Kept** the substitution tie-break (`skillMatchScore` in `core/substitution.ts`,
unchanged — still neutral on null, so no penalty for unrated pairs). **Populated**
`exercises.skill_level`:
- **Library-paired (automated, reproducible):** `seedLibrary.ts` now sets
  `skillLevel` from free-exercise-db's `level` on every library row + inherits it
  onto merged curated rows. Prod backfill by `library_id`: **873 rows**.
- **Curated hand-tags (reproducible):** `seed.ts` gains an optional `skill_level`
  on `SeedExercise` (COALESCE-guarded on conflict so `db:seed` never wipes a
  library-inherited value); tagged the obvious simple movements `beginner`
  (rotary torso, cable bicep/Bayesian curl, cable lateral raise, back extension)
  in the seed JSON / net-new arrays.
- **Final prod distribution:** beginner 526, intermediate 293, expert 57, null 4
  (the 4 are 3 junk test rows + 1 duplicate — correctly neutral).

**Weak-provenance caveat (recorded per owner):** free-exercise-db's `level` is
**unverified** third-party grading. The tie-break is now *functional* but
possibly *noisy*. It's low-stakes (only a tie-break, neutral on null). **Watch
item:** if substitution ranking gets visibly worse, revisit the source rather
than trust the grade. The real value is future: skill is coaching signal the
agent layer will want ("don't suggest a Bulgarian split squat to a novice"),
so populating now beats deleting-and-re-adding.

### Watch item — derived rests have produced nothing on prod
Surfaced by the 4e audit: prod rest sources are **19 user, 14 null, 0 derived**.
The rest *derivation* (the plausibility-filtered gap-timer inference) is an entire
feature that has produced zero real rows — most likely because actual logging
behavior never generates a derivable gap (batch-logging → <15s → unknown; logging
after the fact → >8min → unknown), so the plausibility filter correctly fires
never and the **set-level timer is the real feature**. **No action now** — the
set-level timer is new; give it real use. **Trigger:** if derived rests are still
zero after ~2 weeks of logging *with the timer* (~2026-07-30), drop the derivation
rather than maintain a filter that never fires.

### Part 3 — multi-device divergence: detect-and-warn (built)
Extends the existing directional-heal machinery rather than adding a new one.
`hydrateFromServer` still no-ops when a local copy exists (never clobbers local
edits) — that's the *source* of divergence, kept intact. New pure detector
`isDeviceBehind()` (`sessionStore.ts`, unit-tested, 5 cases) answers "is THIS
device purely behind?": true only when the session is on the server, the server
has **more occurrences** than local, AND local is provably clean (finishSynced &&
!occurrencesDirty && !metaDirty && !occurrenceConflict). The sessions list
consumes it: a `behind` row warns plainly (`changed on another device · server N
/ local M`) and offers **both** directions — **Pull from server** (adopt the
newer copy) and **Keep this device** (Reconcile — history-safe re-push). **Never
auto-heals**; the user chooses. Refuses to claim "behind" on any two-sided edit
(any local dirtiness routes to the existing push path instead of a silent
overwrite), honoring the owner's standing prior that after a wipe local is not
the source of truth. Detection is occurrence-count level (cheap, from the list
payload already fetched); set-level divergence inside equal occurrence counts is
not surfaced here (would need a per-session fetch) — acceptable, the common case
is a whole occurrence added on another device.

### Part 5 — production migration runbook (built)
Added [`RUNBOOK.md`](RUNBOOK.md): the deliberate migrate-before-deploy sequence,
the Neon direct-vs-pooled endpoint split (drizzle-kit needs the direct host),
the before/after-counts habit, and the `/api/health` (503-when-behind) +
`db:check` gates. **Chose a runbook over an automated migrate-on-deploy step:**
a build-step migration that fails mid-deploy is hard to roll back and leaves prod
half-migrated with no operator in the loop; with one operator, a supervised
manual sequence is safer than unsupervisable automation. Referenced from
CURRENT_STATE §2 and the AGENTS.md doc table.

### Spec v0.6 landed (owner-authored) + drift reconciled
The owner wrote **v0.6** of `fitness-agent-spec.md` from the drift report and
handed it over to install (explicitly approved — the "don't touch the spec
yourself" rule is about never *auto-syncing* intent to code, not about installing
owner-authored spec text). Committed v0.6 verbatim, then reconciled downstream:
- **`SPEC-DRIFT.md` reset to a clean slate** — every item it tracked is now folded
  into v0.6's "What changed in v0.6" section, so there is **no open drift**. The
  file now documents the clean state + how to append new drift as the build next
  outruns the spec. (Deferred-but-recorded items — agent layer, recovery/nutrition,
  form analysis, per-unit increment — are intent, not drift.)
- **Version pointers bumped v0.5 → v0.6** in `AGENTS.md`, `CODEX-ONBOARDING.md`,
  `README.md`. DECISIONS' own historical "spec v0.5 §7a" / "diverged from spec
  v0.5" references were left as accurate history (they describe work done against
  v0.5 at the time).
The spec stays human-owned; the drift ritual continues (build outruns spec →
record in SPEC-DRIFT → owner folds into the next revision → reset).

## UI redesign — phase 1: the shell (2026-07-17)

UI-structure session, zero functional/data changes (no schema/API/sync/LLM;
`src/core/*` untouched — self-check passed; the `defaultLoadIncrement`
load-type table remains the one documented impurity). Committed per screen.

- **Design language as tokens** (`docs/DESIGN.md` is the contract): the new
  palette/radii/hues live as CSS custom properties in `globals.css`, and the
  OLD token names (`--background`, `--surface`, …) are kept as **aliases of the
  new values** — so the pre-redesign screens (log, program, blocks, exercises,
  equipment) sit on the new surfaces without structural restyle. Phases 2–3
  migrate each screen to the v1 names; the aliases die when unconsumed.
- **Login = title screen** — cosmetic only; the auth POST + `?next=` return
  flow are byte-identical. Passcode renders as native password dots (a fixed
  dot-count row would assume the passcode's length).
- **Home replaces the dev index** — the spec-§12 aggregator built shell-first:
  live Training card (week progress = merged local+server finished sessions
  since local Monday; "Up next" inferred by cyclic containment-match of the
  last session's label against the active program's day order — honest
  fallback to the first day) + 2×2 honestly-locked tiles (LockedTile) that
  later phases light up in place. No new APIs.
- **Train hub** — start card + ListRow navigation with live counts from
  existing endpoints. **History** (was /sessions): month group headers
  (stable session date, local calendar parts), rows name · date · time ·
  duration · sets — duration only when the local createdAt→firstFinished span
  is plausible (1 min–6 h; hydrated/server rows omit rather than guess);
  set count falls back to exercise count for server-only rows. **Per-row sync
  dot** (green synced / amber pending-will-drain / red needs-action:
  conflict/behind/sync-error) expanding detail + the directional heals on tap —
  replaces the status-bar text. Merge/drain/heal/delete logic untouched.
  Starting a session moved to Home/Train (still one tap from anywhere).
- **Nav model** — global bottom nav (Home/Train/Stats/More) in the root
  layout, hidden on /login and /log/[id]; the log page renders a
  **SessionBar** instead (back · live rest timer · Finish(n)) — deliberate
  navigating-vs-training mode switch. The bar mirrors the in-card timer via
  `restTimerBus`, a **display-only** pub/sub: the card still owns start/stop
  and the rest write; the bus publishes null on card unmount so the bar can't
  show a phantom timer. Stats/More are placeholders in the locked-tile
  language ("Lock app" row was cut — navigating to /login doesn't clear the
  cookie, and a logout API is a functional change).
- **Killed every ad-hoc link row** on touched screens (log's ← Sessions +
  bottom links; program's "Back to logging"; blocks' link row;
  exercises/equipment header + footer piles) — the nav owns navigation.
- **Verified at 375px in-browser:** login title screen; Home with real data;
  Train counts; History month groups + dot detail expand + delete confirm;
  nav on every non-session screen incl. legacy pages; session bar swap with
  live mono timer mirrored from the card; **offline end-to-end**: killed the
  dev server, logged a set, hard-reloaded the dead page — both sets survived
  in IndexedDB and auto-drained green on server restart. 136 tests, clean
  build, docs:check green.

## Shell polish — phase 1.5 (2026-07-17)

Six phone-testing items; five built (one commit each), item 6 proposed only.
UI-only: no schema/API/sync changes; `src/core/*` untouched.

- **1 — nav overlap (the real bug):** both bars (GlobalNav, SessionBar) went
  fully opaque (base token + hairline; the 88%-translucent + blur look let
  content blend through while scrolling) and the in-flow spacers grew
  64px→80px (+safe-area) — the old spacer was 1px SHORT of the 65px bar. The
  spacer is the layout-level clearance: in normal flow after {children}, so
  legacy phase-2/3 screens get it with no per-page padding. Verified on the
  program editor: last row clear at true bottom, clean clip mid-scroll.
- **2 — Home card:** dropped "Up next" and the "of N" week target (and the
  /api/program fetch with them); now "N this week" + "Last · <name>" with no
  counts. The "Training ›" header row is a real button to /train — Home's
  card and the Train tab are one thing. Train hub's own card unchanged.
- **3 — More de-dup (owner call):** Exercises/Equipment rows removed (they
  live under Train); More keeps the settings placeholder + app version.
- **4 — session back:** router.back() so the chevron returns to the entry
  point (Home/Train/History), falling back to History when history.length<=1
  (fresh load / deep link / standalone PWA). All three round-trips verified.
  Note: in dev, the Next.js dev-overlay badge sits over the chevron and eats
  taps — dev-only, absent in prod.
- **5 — passcode eye toggle:** hidden default, tap-reveal/tap-rehide, 44px,
  aria-pressed; auth flow untouched.
- **6 — empty-session husks: proposed, not built** (behavior change, awaiting
  owner approval — see the session report / next batch).

## Shell polish — round 2 (2026-07-17)

Five UI items built (one commit each); item 6 (empty-session discard) NOT
built — gated on the husk-sync question, answered below. No schema/API/sync
changes; `src/core/*` untouched.

- **2-1 History counts:** every row now shows the exercise count; the
  set-count-with-fallback (local rows had sets, server-only rows didn't) made
  the list ragged. Dead setCount plumbing removed from the row model.
- **2-2/2-3 Train:** "Up next" removed (same predictive-framing call as Home;
  the /api/program fetch went with it — start card reads a stable "Ready when
  you are"); counts fill with NO layout shift: fixed-footprint skeleton per
  count slot (ListRow `pending` prop; reduced-motion honored), the five
  sources fetch in parallel (was a sequential await chain), and the local
  IndexedDB sessions count renders ahead of the network, server ids unioned
  in on arrival.
- **2-4 revealed passcode:** revealed state drops to 0.95rem/normal tracking
  and reclaims the left pad (the right pad holds the eye) — 29 chars fit,
  verified via scrollWidth. Caught a CSS-specificity trap: the compound
  `.passcodeRow .passcode` beat the single-class override; the revealed rule
  is compound too now. Masked look unchanged.
- **2-5 Training› affordance:** full-size 500-weight hue-colored label,
  chevron attached, press state on the whole 44px row.

### Empty-session discard — the husk-sync answer (item 6, not built)
**Answer: yes, an empty session CAN reach the server — but only via
add-then-remove.** Facts from code: `createSession` is local-only and starts
`occurrencesDirty: false`, so a pure husk (Start → back out) has nothing to
POST — no occurrences, no sets, no cardio, finish not drained while
unfinished, and the meta PATCH both requires `metaDirty` and 404s until a log
row exists. It genuinely cannot sync. BUT `removeOccurrence` marks the list
dirty, the drain POSTs the (now possibly empty) list, and
`/api/session-exercises` **creates the workout_log row if absent** — so
"add an exercise, remove it, back out" can leave a server-side workout_log
with zero occurrences/sets. Two mitigating facts: (1) while THIS device still
holds the session, the approved local discard's queued `deleteSession` DELETE
also removes the server row — covered; (2) a server-only husk (local copy
wiped) is **invisible**: `GET /api/sessions` returns finished sessions only,
so it can never render in History, be resumed, or resurface — it's a dormant
row in Postgres, not a UX bug. Recommendation recorded for the owner: ship
the approved local discard as proposed (it covers every visible husk), and
accept dormant server rows as harmless at single-user scale — a one-shot
maintenance query (delete unfinished logs with zero occurrences+sets+cardio,
older than a day) can purge them whenever we next touch prod, rather than
adding a server sweep now (an API behavior change this session's rules
exclude).

## Empty-session discard shipped (item 6, 2026-07-17)

Built exactly as approved: `discardSessionIfEmpty` (zero occurrences + zero
sets + zero cardio + not finished + no metaDirty + no occurrenceConflict →
route through the existing offline-safe `deleteSession`; anything with
content is never touched) + `sweepEmptySessions` backstop on History load
(unfinished, passes the rule, older than 5 min). **One deliberate deviation
from the proposal:** the primary trigger is the session bar's *back action*,
not component unmount — React StrictMode's dev double-invoke fires
unmount+remount on entry, and an unmount discard would eat the session the
user just started. The back action is the only in-app exit while the nav is
hidden (finish sets finishedAt → excluded), and gesture/kill exits fall to
the sweep. 6 regression tests, including the required **"one set = never
discarded"** (holds even with the sweep's age guard disabled). Verified live
in-browser: back-out husks vanish; an aged orphan husk swept on History
load; a fresh session survives the sweep; the finished 0-exercise session
("Legs + shoulders") survives every sweep.

### Follow-up recorded for the NEXT batch (owner-directed, not yet built)
Fix husk creation at the source rather than purging on a schedule:
1. **No-op on empty (API change):** `/api/session-exercises` must NOT create
   the workout_log row when the posted occurrence list is empty and no row
   exists — an empty list means nothing can ever reference the row, so
   creating it is pointless by definition. Same structural-guarantee pattern
   as cardio-in-its-own-table and the set-bearing prune guard. Kills the
   add-then-remove server husk at birth.
2. **One-shot prod purge, once:** with the source fixed, delete existing
   dormant rows (unfinished + zero occurrences/sets/cardio + older than a
   day) — a prod write, to be PROPOSED with before/after counts per the
   standing rule.
Also carried forward: CSS-specificity conventions added to DESIGN.md (the
silently-losing single-class override); Train flicker/skeleton accepted
as-is — no further optimization unless it bothers the owner (then: cache
last-known counts + revalidate).

## UI redesign — phase 2: the session screen (2026-07-17)

Rebuilt /log/[id] on the DESIGN tokens. UI/interaction only — no schema, no
sync-logic, no core changes; `src/core/*` untouched (self-check passed).
Three part-commits (card → sheets → chrome) + this docs pass.

- **Structure:** the page stays the ORCHESTRATOR (state/data/sync handlers
  unchanged); the cards moved to `src/components/session/*` with their state
  machines VERBATIM — offset machinery, lane derivation, timer→rest write,
  drop groups, swap, session-relabel, every localStorage key. Only the JSX
  was rebuilt. `session.module.css` follows the single-class-specificity
  convention; `log.module.css` had zero consumers left and was deleted.
- **The card:** rows show information, controls appear on demand. Collapsed
  = one quiet line; expanded = metadata chips (the equipment chip ALWAYS
  shows current state — "ez curl bar +20" — and toggles the on-demand editor,
  auto-expanded on zero-set cards), read-only set rows (tap → Edit/Delete/
  +Drop; only one action row open at a time), REST AS CONNECTORS between
  rows (N−1 edges, the model made visible; tap-to-edit with the digits mask
  and est/timed tags), drop nesting unchanged, the timer as the accent mono
  BANNER (liveliest element; still mirrored to the session bar via the
  display-only bus), and the lb/reps/effort trio (effort = compact select) +
  one gradient Log set. ⋯ menu: Swap / Move / Remove / Check progression /
  Undo swap.
- **DB-verified, not eyeballed (owner requirement):** offset set stored
  load_entered=45 + builtin_offset=20 = load=65; drop parent↔segment share
  drop_set_group; timer→rest landed rest_seconds=44 rest_source=timed on the
  NEXT set; unilateral set stored side=left. (Noted: the drop segment picked
  up a rest_source=derived 28s — the derivation CAN fire; relevant to the
  derived-rest watch item.)
- **Sheets:** a portaled Sheet primitive — found live that a done card's
  `opacity: 0.62` creates a stacking context that traps and dims a fixed
  overlay rendered inside it (and that a sheet must render OUTSIDE the
  collapse guard, since ⋯ offers Swap on collapsed cards). SwapSheet speaks
  lifter language with the suggested offset surfaced BEFORE the pick and
  "best match" on the top-ranked candidate; same deterministic endpoint, no
  LLM. FinishSheet: three mono stat cells + a one-line summary — verified
  usable at 13 staged exercises.
- **Chrome:** one-line header (name · date ✎, same stable-date/user-time
  flow) + the History sync-dot pattern with Sync now / Pull / Reconcile in
  the expanded detail; palette became a sticky "+ Add" pill opening an
  AddSheet (multi-add preserved; ExerciseSearch's row-tuned flex-basis
  needed a plain block wrapper inside the sheet column).
- **Husk discard, BOTH triggers (owner call):** back-button onClick (race-
  free common path) + unmount cleanup guarded by a pathname check (real
  navigation — button or gesture — has changed the URL by cleanup time;
  StrictMode's double-invoke hasn't, so the eat-on-entry footgun stays
  avoided). Verified live: button path AND simulated gesture (history.back())
  both leave History clean on FIRST render; content sessions never touched.
- **Offline unchanged:** set logged with the dev server dead → dot amber →
  restart + drain → green. 142 tests, clean build throughout.

### On record (owner-directed): the Start double-create race is MASKED, not fixed
Seen twice while test-driving (phase 1.5 and again this session): a fast
double-tap/re-render race on Start can create two sessions despite the
`starting` guard — the guard isn't airtight across rapid re-renders. The
empty-session discard currently makes the duplicate invisible (it's empty →
discarded on exit/sweep), which is masking, not fixing. If Start ever grows
side effects beyond createSession, revisit the guard (e.g. an idempotency
key per tap or disabling via ref before the first await).

## Session-screen polish — phase 2.5 (2026-07-18)

Fourteen phone-testing items, five commits (A–E). UI/interaction only;
`src/core/*` untouched; 142 tests + clean build throughout.

- **A — done-card review state:** an expanded done card shows chips + logged
  rows + rests, fully readable (the 0.62 dim now applies only while
  collapsed), with NO input trio / Log set / equipment editor — the unit chip
  stays legible but is a plain chip, not a control. Set rows remain tappable
  for corrections; unchecking done restores logging. Cardio matches.
- **B — set-row clarity:** rows lead with the effective load ("65 × 8") and
  the breakdown became a muted suffix ("· 45 + 20 built-in") shown only when
  an offset exists (same flip on the input preview); rows got a faint chevron
  + press state (they didn't look tappable); edit-mode effort is the same
  dropdown as the trio; the drop entry renders directly under its parent set;
  a 0 rest displays as "no rest" (deliberate none — the owner's unilateral
  L→R case) distinct from null "rest —", with a one-tap **none** in the rest
  editor (saves 0/user); rest tags completed per convention — timed tagged,
  **derived tagged** (`· derived` replacing the vaguer "est"), user bare.
- **C — timer target:** the unlabeled minutes field ("300" = 300 minutes)
  became a labeled `target` input on the same digits-only m:ss mask as rest
  editing; the stop-at-target check and notification prompt read the masked
  seconds.
- **D — sheets:** the grab handle is honest — dragging the header zone down
  >90px dismisses (pointer capture, live translate, snap-back animation
  skipped under reduced motion); the finish summary became a name/×sets row
  grid capped at 340px with internal scroll (verified at 13 exercises); the
  new-unit modal became a bottom sheet on the Sheet primitive with token
  fields (the last centered modal + raw-bordered textarea gone); "1
  change(s)" pluralized.
- **E — selection + Add:** selected segment pills are FILLED accent
  (arm's-length legible); **+ Add moved into the session bar** (back · + ·
  timer · Finish) — the sticky pill could park on a card's Log set; the bar
  structurally can't. Verified at 375px with the timer running: fits, no
  fallback needed.
- Live verification highlights: a ~2:20 derived rest fired between a
  unilateral L→R pair and rendered `· derived` (the derivation firing again
  — second data point for the watch item); drag-dismiss verified with
  synthetic pointer events; the 13-exercise finish grid scrolls internally.

## Session-screen refinements — phase 2.6 (2026-07-18)

Five phone-testing items, five commits. UI/interaction only; `src/core/*`
untouched; 142 tests + clean build.

- **1 — equipment editor attaches to the chip:** the zero-set editor was a
  full-width box duplicating the chip while the chip did nothing. Now one
  control: a compact indented row connected beneath the chip (left rule,
  selects sized to content), and the chip toggles it EVERYWHERE —
  `equipOpen` became `boolean | null` (null = automatic open-on-zero-sets,
  so equipment still gets confirmed before the first set; a tap always flips
  the visible state).
- **2 — chevron + hint:** the chevron moved to a hairline-separated far-right
  slot (it read as an effort dropdown sitting flush against the effort text,
  and floated alone when effort was unset); press state already covered the
  whole row. A one-time "tap a set to edit or add a drop" hint renders under
  the session's FIRST card with logged sets, dismissed forever on the first
  row tap (`fitness-app:hint-set-tap`). Known fuzziness: a tap on a
  *different* card's row sets the flag but the hint card only re-reads it on
  remount — acceptable for a one-time hint.
- **3 — timer target removed entirely** (owner call: its purpose is served by
  tapping the rest connector). Deleted, not hidden: the input, the
  stop-at-target check, and the whole Notification request/fire path. The
  timer is count-up + tap-to-stop + auto-write.
- **4 — side-pill first-tap fix:** verified via computed styles — the global
  `button:hover:not(:disabled)` (0,2,1) out-ranked `.segActive` (0,1,0) and
  touch leaves :hover STUCK on the tapped element, so tap one painted the
  grey hover background over the accent fill. State classes now carry their
  own interaction rules at ≥ the global's specificity. Confirmed: one tap →
  computed background rgb(99,102,241) with hover applied. (Third instance of
  the DESIGN.md specificity trap; the convention held.)
- **5 — loads carry units:** rows read "95 lb × 8" (standard notation) —
  drops, review state, the `last ·` chip, and the recalibration note
  included; the finish grid shows no loads.

## Session-screen refinements — phase 2.7 (2026-07-18)

Three fixes from phone screenshots, all `src/components/session/*` only
(core untouched, no schema/API/sync changes). Tests 142 pass, clean build.

- **1 — ⋯ menu positioning + scrim:** the menu was portaled but still
  positioned naively. Now placed from the trigger's rect: right-aligned and
  viewport-clamped, flipping ABOVE the trigger when the estimated height
  (items × 44 + 8) would cross the bottom edge — it can never spill
  off-screen or land over the next card. One consistent light scrim
  (`rgba(0,0,0,0.35)`, z 65) dims the page, traps every tap (menu item or
  scrim — never the card behind), and closes on tap. Verified in-browser:
  bottom-most card's menu flips up fully in-viewport, the menu stays fully
  opaque (computed opacity 1) over a dimmed done card (0.62), tap-outside
  closes without reaching the card underneath.
- **2 — equipment editor above the pills:** 2.6 attached the editor to the
  chip but left it BELOW the metadata pills, breaking the "hangs off the
  chip" read. Order is now chip → attached editor row → pills
  (previous / recal / target / source); the first chips row holds only the
  unit chip. Verified geometrically (chip y < editor y < pills y).
- **3 — add-panel clip was flex compression, not a height cap:** sheet-body
  children default to `flex-shrink: 1`, so when an expanded group made the
  content taller than the body the GROUP was squeezed to fit and its own
  `overflow: hidden` (corner rounding) clipped the trailing pills — the body
  never overflowed, so it never scrolled and the last exercises were
  unreachable. Fix: `.body > * { flex-shrink: 0 }` — children keep natural
  height and the body is the single scroll container; `.addChips` got 14px
  bottom padding so the final pill terminates cleanly (safe-area padding was
  already on the panel). Verified: all 10 pills of a 10-exercise group
  reachable at 375px. (New trap class for DESIGN.md thinking: a flex column
  with `overflow` styling on a child can clip instead of scroll.)
- **Specificity guardrail:** proposed to the owner (not built — approval
  required): wrap `globals.css` interactive pseudo-class rules in
  `:where()` so they carry zero specificity (structural fix), with an
  optional stylelint check as a complement.

## Session-screen refinements — phase 2.8 (2026-07-18)

Two items, `src/app/globals.css` + `src/components/session/*` only (core
untouched, no schema/API/sync changes). tsc clean, 142 tests pass, clean build.

- **1 — specificity guardrail (`:where()`, approved):** the shared global
  interactive rules now wrap their pseudo-class chain in `:where()` —
  `button:where(:hover:not(:disabled))`, `button:where(:active…)`, and the
  `input/select/button` `:focus` outline rules. `:where()` contributes zero
  specificity, so the selector stays **0,0,1** (one live `button` type
  selector): it still beats the base `button` rule by source order (plain
  buttons keep their hover) but ANY single class (0,1,0) now wins by
  construction. This makes the three-times-recurring bug unwritable — a bare
  global `button:hover` (0,2,1) out-ranking a state class, and touch leaving
  `:hover` stuck so the grey hover paints over an accent fill. The 2.6-4
  band-aid (`.segActive:hover` override) was **removed** — the structural fix
  carries it, and removing it is what actually exercises the guardrail.
  - *Verified via computed style, not class presence:* active side-pill `L`
    with `:hover` genuinely stuck (real pointer, confirmed `:hover` matched) →
    `rgb(99,102,241)` accent + white text; a plain `.smallBtn` (no bg
    override) on hover → `rgb(36,36,44)` (#24242c), i.e. still inherits the
    global hover — nothing that should inherit it changed.
  - *Subtlety recorded:* the literal `:where(button):hover:not(:disabled)`
    form leaves **0,2,0** and would NOT fix it (still beats `.segActive`
    0,1,0). Keeping `button` live and wrapping the pseudo chain is what lands
    the needed **0,0,1**. Stylelint tripwire intentionally skipped (owner):
    `:where()` makes the bug unwritable, so the tripwire is redundant unless
    we later want to guard globals.css against regressions.
- **2 — compact card metadata:** the expanded card top showed the same info
  twice over two rows.
  - *(a) Editor is compact inline:* the chip is the full summary, so the
    editor no longer restates it as full-width stacked dropdowns —
    `[type ▾] [unit ▾] [+ New]` fit one row at 375px (selects `max-width:108px`
    + truncate, `min-height:34px`; "+ New unit…" → "+ New"). Verified all
    three controls share a row (rightmost edge 337 < 350).
  - *(b) One muted line, not pills:* the `last · target · source` chips
    collapse into a single quiet `.metaLine` (text-3, nowrap, ellipsis) —
    `last · 45 lb × 8 · target 3 × 8-12 @ RIR 2 · Legs + shoulders` — same
    information, far less chrome. Kept the `lb ×` notation (2.6 standard).
    The recalibration note stays its OWN dismissible chip (actionable, not
    static) — verified rendering separately above the line via a real recal
    (free-weight set logged, then equipment switched to a contextBound type).
