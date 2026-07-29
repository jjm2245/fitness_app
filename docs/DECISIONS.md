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

## Session-screen refinements — phase 2.9 (2026-07-19)

Final exercise-card header refinement. Verified in-app at 375px; tsc clean,
142 tests pass, clean build.

- **Header order** is now: `☐/☑ Name TAGGED ⋯` → `last …` → `target …` →
  recalibration chip (when present) → equipment summary chip (Option A) →
  full-width fields (when tapped) → input trio / sets. Confirmed via DOM order
  `metaBlock → recalChip → equipChip → editor → sets`.
- **1 — metadata under the name, two muted lines, source dropped.** Metadata
  describes the exercise, so it sits directly under the name (above the
  equipment control), not below the editor. `last 140 lb × 12, 11, 10` and
  `target 3 × 8-12 @ RIR 2`, value in secondary text, the label ("last"/
  "target") dimmer; each line stays single-row and ellipses rather than
  pushing layout. The `[source]` pill is **removed** (redundant — the page is
  titled by day).
  - "last" is now **exercise-level**: its own fetch (`scope=exercise`, deps
    `[activeExercise.id]` only), decoupled from the lane. It no longer vanishes
    when the unit changes (the old behavior showed it for a named unit and
    dropped it for unspecified). Shows `last — no prior data` when empty.
    Verified "last 120 lb × 12" on both a named (VSL16) and an unspecified
    unit of Leg Extensions, and "no prior data" on a fresh Smith Machine Squat.
  - State split: `previous` → `lastText` (exercise-level) + `recalNote`
    (lane-level). Two effects. The recalibration DETECTION is unchanged; it now
    drives only its own dismissible chip, never the "last" line.
  - **Scope note / deviation:** exercise-level "last" needs cross-lane data the
    lane-scoped `last-session` route couldn't give, so the route gained an
    additive, read-only `?scope=exercise` mode (commit 2.9-0). This is the one
    non-`src/components` change; it touches no schema/sync/core and leaves the
    default lane-scoped path (progression/recal) untouched. Flagged for the
    owner as the minimal way to satisfy "last is independent of the unit."
- **2 — equipment editor → Option A.** At rest, one summary chip:
  `⚙ {unit} · {type}` (named), `⚙ {Type} · pick unit` (context-bound, no unit),
  or just the type (portable) — the only equipment element visible. Tapping
  flips the caret and reveals, indented under the accent rule, **full-width
  labeled** Type and Unit selects — fixing the compact row's truncation
  ("Selectorized m…" / "Unspecified u…"); verified the selects render at full
  width (301px / 199px) with complete text. "+ New unit…" still opens the
  existing bottom sheet (verified by creating VSL16 → chip became
  `⚙ VSL16 · selectorized machine`). The chip remains the toggle everywhere,
  including the zero-set auto-expand (kept). Built-in offset display + confirm
  chip unchanged (verified `+ built-in 20` and `apply +20…`).
  - `.selectQuiet` restored to its pre-2.8 non-truncating size — its compact
    108px cap was purpose-built for the now-replaced inline row; its only
    remaining users are SetRow's effort-in-edit select and AddUnitModal's ratio
    select, which shouldn't truncate. The editor now uses a new `.selectFull`.

## Session-screen refinements — phase 2.10 (2026-07-19)

Cardio card brought into the strength-card header family, and the duplicate
"cardio" tag diagnosed and removed. `src/components` only (the approved
`?scope=exercise` route from 2.9 stays); core untouched, 142 tests, clean build.

- **1 — CardioCard harmonized.** Metadata now sits under the name as a muted,
  exercise-level `last …` line in the exercise's own units — `last 30 min ·
  3 speed · 12 incline` (treadmill), `last — no prior data` (Stairmaster) —
  built from the same `fields` that drive the input cells. Always shown; no
  target/equipment/offset/lane (cardio has none). The input grid, the
  MIN/SPEED/INCLINE/LEVEL labels, and the Log cardio button already used the
  shared strength tokens (`.entryGrid/.cell/.cellLabel/.cellInput/.logBtn`), so
  no restyling was needed — the harmonization is the metadata line + dropping
  the pills. Collapsed header keeps `[source]`, matching the strength card.
- **2/3 — duplicate "cardio / Cardio" tag: diagnosed, not guess-patched.** The
  two pills were **not** duplicated tag data. The lowercase "cardio" was a
  **hardcoded literal chip** in CardioCard's body; the capitalized "Cardio" was
  `ex.source` — the occurrence's origin — because the seed exposes a **program
  day literally named "Cardio"** (AddSheet's comment notes it dedupes that
  label). The exercise's own data is clean (`movement_pattern` "conditioning",
  no muscles), so **no seed cleanup is needed**. Dropping the source pill and
  the hardcoded category chip (the whole `chipsRow`) removes the duplicate —
  mirroring the strength card, which carries neither, so it is not a cardio
  special-case.
  - **On the requested general case-insensitive dedupe:** there is **no
    display-layer site that renders a set of exercise tags/labels** that could
    collide — I checked the cards, the exercises-management page, ExerciseSearch
    results, FinishSheet and SwapSheet; the only `.muscles.map` is in
    `src/core/substitution.ts` (logic, not display). The duplicate was a
    hardcoded string vs. the source field, which a tag-array dedupe wouldn't
    even catch ("conditioning"/day-name "Cardio" don't match). So a general
    dedupe utility would have no call site (dead code); removal is the correct,
    general fix. If a tag-list display is added later (e.g. muscles on a detail
    view), that is where a `dedupeCI` helper should live — flagged for the owner.

**2.10-1 follow-up:** cardio input cells no longer prefill from the program's
prescribed `ex.params` (the treadmill showed 30/3/12 while every other
exercise started blank). They initialize to "" — the muted `last …` line is
the reference, not a prefill. Dropped the now-unused `num`/`params` read.

## UI redesign — phase 3: the editors (2026-07-19)

The last button-walls fall. All four editor screens rebuilt on the session
screen's vocabulary (Sheet primitive, portaled ⋯ menu, chips, rows + progressive
disclosure). New `src/components/editors/`. UI/interaction only; `src/core/*`
untouched (self-checked across the phase). 142 tests, clean build.

- **Part 1 — Program + Blocks (one row system, two screens).** A block is
  structurally a program_day, so `/program` and `/blocks` are one engine
  (`DayEditorView`) with `noun` relabeled. Program name is the title + a ⋯
  (rename / set active / switch via sheet / new / delete-with-confirm); days
  are horizontal pill tabs with a pinned day ⋯ (rename / move left / move right
  / delete). Quiet exercise rows: name + one target chip (`3 × 8–12 @ RIR 2`),
  tap → `TargetSheet` (labeled Sets / Rep range / Effort RIR + Move up/down +
  Remove-confirm). **Target semantics untouched** — `"8-12"` only *displays* as
  `8–12`; stored values (incl. RIR) never rewritten. Cardio rows show only what
  applies (`1 set · 30 min` chip; sheet = Sets only + read-only prescribed
  duration — no dead rep-range/RIR inputs). `+ Add exercise` → `AddExerciseSheet`
  (the session AddSheet pattern; tag-on-add lives in ExerciseSearch).
- **Reorder = ↑/↓, not drag.** The move API is single-step direction-based, so
  exercises reorder via ↑/↓ in the edit sheet (boundary-disabled) and days via
  Move left/right in the ⋯ — a boring reliable reorder over a janky mobile drag.
- **Part 2 — Exercises.** List rows: name + kind badge (library name / your
  name → library / custom / untagged) + muted subline (primary muscle ·
  equipment type · logged count; snake_case humanized for display only). Search
  + My/Library/Custom filter chips. Tap → `ExerciseDetailSheet` carrying all six
  old buttons: rename (+ use-library-name), description, unilateral toggle,
  equipment associations, collapse-into-library (copy kept), history-safe remove
  (409/Keep). Header paragraph → one line.
- **Part 3 — Equipment.** List rows: label + type/built-in/pulley chips +
  used-by/logged subline. Tap → `EquipmentSheet` (all fields, used-by, merge
  with history-moves copy, guarded delete with a clear blocked message). `+ Add`
  reuses the same sheet in add mode.
- **Additive read-only API touches (same class as the approved `scope=exercise`,
  flagged):** (1) `GET /api/exercises/manage` now returns `primaryMuscle`
  (highest-emphasis primary tag) for the subline — not client-derivable; joins
  `exercise_muscles` read-only. (2) Equipment standalone add uses existing
  `POST /api/equipment` + `PATCH` (the session new-unit sheet is exercise-
  scoped). No schema/sync/core change.
- **DB-level verification (throwaway entities, created + cleaned up through the
  app / my own test rows; real program/exercises/equipment read-only and
  restored exactly):**
  - *Reorder:* swapped two exercises in a throwaway day → `order_index` 0/1
    persisted (survived reload); throwaway program deleted, zero residue.
  - *Collapse:* logged 2 sets on a throwaway custom, collapsed into a
    zero-history library entry → source set_logs 0, survivor +2 (history moved),
    total set_logs unchanged, source exercise deleted, **0 orphans**. Test rows
    removed; survivor restored to 0.
  - *Merge:* 2 set_logs referencing a throwaway unit merged into another →
    source 0, target 2 (re-pointed, count identical), source unit deleted,
    **0 orphan equipment refs**. All test rows removed.
- **Dead-code sweep:** `DayEditor.tsx/.module.css` and `exercises.module.css`
  retired (no importers left). `log.module.css` was already gone in phase 2.

## Phase-3 route additions — accepted (2026-07-19)

The two additive, read-only API touches from phase 3 are **owner-approved** —
same class as the earlier `scope=exercise` acceptance: read-only, no
schema/sync/core change, flagged not hidden. They are the honest footnote to
the "UI-only" boundary of the phase:

- `GET /api/exercises/manage` returns `primaryMuscle` (highest-emphasis
  primary-role tag) for the exercises-list subline — not client-derivable.
- Standalone equipment add reuses existing `POST /api/equipment` + `PATCH` (the
  session's new-unit sheet is exercise-scoped and can't serve a context-free
  add). No new routes.

## Edit a finished exercise — revert-to-editable (2026-07-19)

A finished session was already reachable + editable from History (no session
lock); the only thing read-locking a done exercise was its per-occurrence
`completed` review state. UI/interaction only — no schema/sync-logic/core.

- **Revert scope = the occurrence, not the session** (owner-confirmed). A done
  card's ⋯ gains **"Edit exercise"** → `setOccurrenceCompleted(false)` for THAT
  occurrence only. The session's `finishedAt`/`firstFinishedAt` are **never
  touched**, so the session stays finished + filed and its History date cannot
  move — the finish-restamp regression is made *impossible* (nothing re-finishes
  the session), not merely guarded. Re-finish = re-check the done box → review.
  CardioCard gets the same "Edit exercise".
- **Re-point logged sets' unit** — the actual need (fix a set logged on the
  wrong unit). The equipment dropdown only governs NEW sets; the sole re-point
  path (`applyOffsetToOccurrence`) was gated on an *offset* change, so a plain
  unit swap had no trigger. Added an **explicit, never-automatic** affordance:
  when the selected unit ≠ what the logged sets carry, a chip reads
  `Move N logged sets → <unit | unspecified>` (names count + target; one tap
  after you see it). It changes ONLY `equipmentId/label/type` via the existing
  `editSet` loop — each set's `load/loadEntered/builtinOffset` are preserved, so
  **no load ever shifts** (a note states this). `→ unspecified` is first-class.
- **Sync/offline:** revert (occurrence `completed`) + re-points use existing
  dirty-flag + sync paths. Because `finishedAt` is untouched, there is **no
  finish-sync ordering concern**. DB-verified: re-point moved 2 sets
  VSL16 → "the good one" → unspecified with load unchanged; date/finish
  timestamps byte-identical before/after; offline edit queued (`pending_update`)
  and drained on the next sync (History load).
- Out of scope (as agreed): the prod duplicate-VSL16 consolidation (owner does
  it on their phone), no schema, no session un-finish, no prod/dev data writes
  beyond throwaway test rows I created and removed. Note: dev and the owner's
  prod (Neon) have drifted — dev is a test sandbox; statements about real data
  are prod reads only.

## Duplicate equipment units — root cause + fix (2026-07-19)

**Root cause (diagnosed, prod-read confirmed).** The equipment SCHEMA is
correctly many-to-many (`exercise_equipment` composite PK; `set_logs.equipment_id
→ equipment.id`) — a unit is a standalone physical machine many exercises can
reference. The bug was entirely in the UI/creation path:
1. The unit picker in `StrengthCard` loaded from `GET /api/exercises/[id]/equipment`
   — **exercise-scoped** — so a machine already used on exercise A never appeared
   when logging exercise B.
2. `AddUnitModal` ("+ New unit…") minted a fresh `crypto.randomUUID()` every time
   with **no label lookup**, so re-typing an existing machine's name created a
   second row.
With the existing unit hidden from the picker, the user was FORCED into "+ New",
which then duplicated. Prod evidence: VSL16 = 2 rows 27 min apart (Seated Leg
Curl / Leg Extensions); **VSL13 = 2 rows a full day apart** — proof it recurs
across sessions, not a one-off. No schema change needed (owner's first case).

**Fix (UI/logic only; `src/core/*` untouched).**
- **Selector shows ALL units** (`GET /api/equipment`), grouped: *On this exercise*
  → *Your \<type\> units* (matching the selected type) → *Other types* (never
  hidden — a valid unit is always reachable, closing the exact trap that forced
  "+ New"). Groups re-compute live when the Type changes. Picking a unit REUSES
  its row and adopts the unit's own type so the (type, unit) lane stays
  consistent.
- **Create-dedupe in "+ New unit…"** (offer, never force): before minting, match
  an existing unit on **label + type + gym**, case-insensitive on label (gym is
  part of identity — same label at two gyms = two machines). On a match, show
  *"You already have \<label\> — reuse it?"* with **Use \<label\>** (associates +
  selects the existing row, no new row) / **Create anyway**. Never silent.
- **Preserved:** the merge path + history-safety are untouched; no auto-merge of
  existing prod duplicates (owner's by-hand phone job). This prevents NEW
  duplicates and makes existing units reusable going forward; it does not
  retroactively fix VSL16/VSL13 already in prod.

**Verified (DB-level, throwaway dev entities, cleaned up; prod read-only):**
logging Seated Leg Curl on an existing selectorized unit ("press by the window",
tied to Machine Bench Press) minted **no new equipment row** (total 6 → 6), the
set referenced the existing id, and the unit auto-associated with both exercises.
"+ New unit…" typing "vsl16" matched "VSL16" case-insensitively and offered
reuse; **Use VSL16** reused (still 6 rows). Changing Type re-filtered the groups
live with every unit still reachable.

## Program editor — target sheet + reorder (2026-07-20)

Phase-3 program-editor iteration on the shared `DayEditorView` engine
(/program, /blocks, block library). Two gated decisions were reported first and
approved; the session/logging screen was not touched.

### A — target sheet
- **Migration 0022 (additive, owner-approved; local-first, prod held):**
  `program_exercises.target_sets` DROP NOT NULL. A program exercise can now have
  NO target (NULL sets/reps/rir) → a freshly added exercise reads "Set a target"
  instead of a fabricated `3 × 8–12 @ RIR 2`. `addExerciseToDay` inserts all-null
  by default; the seed keeps its explicit PPL prescription; cardio carries no
  set/rep target (kills the vestigial "1 set"). Read paths were already
  NULL-safe (log page maps `targetSets==null → target:null`; progression uses a
  defaulted context, never `target_sets`; stats reads logged sets, not targets).
  Real-format audit (prod): strength rep ranges are only `8-12` (×39) and `8`
  (×1); zero rows used `target_sets=0`.
- **Reps Single/Range toggle** (defaulted from the stored value: `a-b` → Range,
  else Single), numeric-only inputs (inputmode numeric; letters/symbols
  filtered), blank RIR → null. Invariant held: `8-12` stores `8-12` (shown 8–12),
  a single `10` stores `10`, and a no-edit save is byte-identical.
- **Cardio targets live on `exercises.params`** (exercise-level jsonb, not
  per-program) — confirmed by prod read. The sheet edits them via an additive
  `params` field on the exercise PATCH (no schema change), with a muted
  "applies everywhere" note. Duration uses the same Single/Range toggle so a
  `[min,max]` (Stairmaster `[5,15]`) round-trips; incline/speed optional singles;
  a merge preserves unknown keys and unsets blanked ones. Chip shows
  `30 min · 12 incline · 3 speed` (or ranges) / "Set a target", never "1 set".
- The exercise target sheet's ORDER / Move up-down block is gone (see B).

### B — reorder supersedes the single-step moves
**This supersedes the phase-2/DayEditor decision to reorder via ↑/↓ one at a
time.** Reasoning: single-step moves are O(n) taps and API calls to move an item
far; a whole-order commit is one action and removes the "sorted view vs. manual
move" ambiguity. Now:
- **Bulk reorder endpoints** (a day's exercises; a program's days) write
  contiguous `order_index 0..n-1`, scoped to the parent, and reject an id set
  that doesn't match the parent's children exactly (no gap/dupe/cross-parent).
  Additive — `order_index` already existed.
- **Drag** via **dnd-kit** (added dependency, owner-approved; touch-first, not
  hand-rolled): PointerSensor + 6px activation + a grip handle (touch-action
  none) so the row still taps to open its sheet. **Sort** actions (A–Z / Z–A /
  Recent — Recent uses the serial `id` as the creation-order proxy, since there
  is no `created_at`) commit a canonical order, still drag-tweakable. Days
  reorder via a **"Organize order…"** drag modal.
- Retired: exercise Move up/down (sheet) and day Move left/right (⋯).
- DB-verified on throwaway rows (real rows read-only, restored): drag/sort/day-
  modal all persist contiguous `order_index`, survive reload, are parent-scoped;
  +3 reorder-integrity unit tests. Blocks parity confirmed.

**Deploy note:** migration 0022 is applied to LOCAL only; prod is held for the
owner's review (before/after counts) and must land before the code deploys
(inserting NULL target_sets would violate the old NOT NULL). VSL16 / all real
prod rows untouched.

## Cardio consistency — detection + per-exercise fields (2026-07-21)

**Root cause (differed from the flag/tag guess).** `is-cardio` was already read
identically in the editor (`DayEditorView`/`TargetSheet` via
`programs.ts`→`conditioningOnly`) and the session (`log/[id]/page.tsx:291`
→`CardioCard`), both keyed on `exercises.conditioning_only` (read live, not
snapshotted). So Power Stairs showed strength inputs in *both*, not just the
session. The real gap: the only cardio-ish tag the UI could apply was the
`conditioning` **movement pattern** (graduation PATCH), a *different* column that
never set the routing flag — and the custom-create route hardcodes
`conditioning_only=false`. No user action could set the signal the app routes
on. Prod confirmed: Power Stairs `movement_pattern=conditioning, untagged=false,
conditioning_only=false`; the seeds (Stairmaster/Treadmill) `=true`. Signals
diverged table-wide: `conditioning_only`=14 rows, `movement_pattern='conditioning'`=4,
`day='cardio'`=2. The TAGGED/UNTAGGED badge (`untagged`) is orthogonal — it means
"no movement pattern," not "not cardio."

**Decision — `conditioning_only` is THE authoritative routing signal** (kept; no
new plumbing since both surfaces already read it). Made it settable + reconciled
structurally so tag↔flag can't drift again:
- Exercises PATCH accepts an explicit `conditioningOnly` boolean; and assigning
  `movement_pattern='conditioning'` now *also* sets `conditioning_only=true`
  (explicit value wins). Tagging conditioning therefore routes to cardio
  everywhere — the drift can't recur from the graduation flow.
- A **Type: Strength / Cardio** toggle in the exercise editor
  (`ExerciseDetailSheet`, mirrors the Unilateral control) — discoverable, shows
  current state, re-routes both editor and session (live read). Small addition.
  *Known gap surfaced for the broader-tag-editor decision:* the "My exercises"
  manage list excludes raw `source='library'` rows, so a graduated library row
  (like Power Stairs) isn't reachable in that editor yet — flip it via data, or
  broaden the manage query later.

**Field-set single source of truth** — extracted `cardioFields(name)` +
`CARDIO_FIELD_KEY`/`CARDIO_FIELD_LABEL` into `src/lib/cardioFields.ts` (name-based
heuristic, moved verbatim — Stairmaster→duration+level, Treadmill→
duration+speed+incline). The session card, the editor target sheet (was
hardcoded duration/incline/speed), and the editor target chip all import it, so
they agree. `TargetSheet` cardio save writes only the fields in the set and
**preserves out-of-set keys** (a stair machine's stored `incline` survives) —
honours "stored values never silently rewritten." Known heuristic quirk (kept):
"Prowler" contains "row" so it reads as a rower — see the deferred-fix note at
the bottom of this log ("cardioFields() name-substring brittleness").

**Data reconciliation (owner-scoped).** Owner chose **Power Stairs only** — flip
`lib_Power_Stairs.conditioning_only` false→true (0 logged history; 1 program
slot). Farmer's Walk (also `mp=conditioning`, unflagged) deliberately **left as
strength** for now (loaded carry) — togglable later via the new control. Applied
to LOCAL; PROD flip is the single authorized prod write this session (before:
`conditioning_only`=14 true; after: 15, only Power Stairs changed). No migration
(column already exists). `src/core/*` untouched.

**Deferred fix — `cardioFields()` name-substring brittleness.** `cardioFields()`
resolves a cardio exercise's fields by name-substring match (first match wins),
defaulting to duration+distance; it keys off the *name* only — not equipment,
not `movement_pattern`, not a per-exercise map. This is known-brittle: incidental
substrings misroute (e.g. "Prowler" → row set; "Step-ups" → stair set). Deferred
fix: an explicit user-chosen field set per exercise, to land with the
exercise-tab / tag work. (Cross-ref: the cardio audit entry's field-set-source
paragraph above.)

## Target sheet v4 — opt-in + anchor + effort scale + compact (2026-07-21)

Shipped (ungated, no schema): **opt-in flow** — no target by default; the sheet
shows "No target set" + "＋ Add a target"; opting in reveals fields; "Remove
target" returns to no target (persists the clear if one was stored, else just
collapses). **One required anchor** — Sets (strength) / Duration (cardio),
marked `*`; while opted in with an empty anchor, Save is disabled + an inline
error + red field border (never saves silently to "Set a target"). Consequence:
a cardio target with incline/speed but **no duration is invalid** → reads "Set a
target" (verified: prod `lib_Jogging_Treadmill {speed,incline}` → "Set a
target"). **Compact layout** — small inline Single/Range segmented toggle,
Sets+Reps on one row, effort as three pills. **Cardio field-sets unchanged** —
still from `cardioFields()` (Stairmaster → duration+level, Treadmill →
duration+speed+incline); only the opt-in/anchor/compact chrome was applied.

**Effort model.** The target adopts the session's 3-level `effort` enum
(`more_in_me`/`near_failure`/`to_failure`) so target and actual are comparable;
the easiest level is relabeled **"Relaxed"** in the target voice (session says
"More in me"). The editor chip + the session's target-reference line now show the
effort **label** (`3 × 8–12 · near failure`) instead of the stale `@ RIR 2`.

**Effort storage — interim on `rir_target` (see `src/lib/targetEffort.ts`).**
Until the additive `effort_target` column lands, the target's effort rides on the
legacy numeric `rir_target` via a bucket that matches the migration backfill
(0–1 → to failure, 2–3 → near failure, 4+ → relaxed, null → none). A no-edit save
preserves the original rir string byte-identically; a changed pill writes a
representative (`to→"0"`, `near→"2"`, `relaxed→"4"`) that re-buckets to the same
tag, so interim writes migrate losslessly. Round-trip proven on a throwaway copy:
`3 / "8-12" / "2"` and Stairmaster `[5,15]` unchanged on no-edit save.

**Migration 0023 — `effort_target` (approved; applied LOCAL, prod held for go).**
Additive `ALTER TABLE program_exercises ADD COLUMN effort_target "effort"` +
backfill from `rir_target` (0–1→to_failure, 2–3→near_failure, 4+→more_in_me,
null→none). `effort_target` is now the **authoritative tag** — the pills edit it,
the editor chip reads it natively, and it's directly comparable to
`set_logs.effort`. Prod `rir_target` today null×16/"1"×1/"2"×40/"5"×2 → backfill:
to_failure×1, near_failure×40, more_in_me×2, none×16.

**Progression (owner's call).** Chose option (b): `rir_target` is **kept as the
number progression reads**, now a projection of the tag written in sync on save
(never hand-edited) — so there is one authoritative input (the tag) and progression
keeps full-resolution numbers with **zero change on deploy**. Rejected the "derive
via a target-specific mapping" option because it needed a second tag→RIR mapping
contradicting `effort.ts` and pinned `more_in_me→5` to today's data. Byte-identical
guaranteed by `rirForEffortTarget()` (tag unchanged → keep original number; changed
→ representative `to→"0"/near→"2"/relaxed→"4"` that re-buckets losslessly). The
session target-reference line still derives its label from the (consistent)
`rir_target` bucket, so no new plumbing through the offline session stack.
**Proof (throwaway copy of the real prod rows):** all 40 `rir=2` rows →
`near_failure`, progression `targetRir` 2→2; every row unchanged; 0 rows shifted.
`src/core/*` untouched.

## Exercise list — sorts become non-destructive lenses (2026-07-21)

**Supersedes the earlier "sort writes `order_index`" decision** (from the reorder
pass). A hand-dragged arrangement was lost the instant you tapped A–Z/Z–A/Recent,
with no way back — so a hand-tuned order must survive a detour through a sort.

New model (additive, `order_index` unchanged, no schema): `order_index` is the
persisted **Custom** order — drag edits it and it's always preserved. A–Z / Z–A /
Recent are **non-destructive view lenses**: they reorder the display only and
never write `order_index`. A **Custom** chip (the default, drag-enabled, shows the
stored order) is the only mode where drag is on; drag is off in the lenses (grip
replaced by a spacer). **"Save as custom order"** in a lens commits the visible
order into `order_index` via the existing bulk reorder endpoint and returns to
Custom — the one-tap "alphabetize, then hand-tweak" path.

Scope: exercise lists only, in the shared `DayEditorView` (so **blocks get the
same model**). **Day/block reordering is untouched** — it stays the drag +
Organize-order flow. Verified on a throwaway copy of a real day: lens leaves
`order_index` non-alphabetical/unchanged; Custom returns the hand order; Save-as-
custom writes contiguous `0..n-1` (no gap/dupe); a drag-commit persists + survives
reload. `src/core/*` untouched.

## Section subtitles + sort-chip polish (2026-07-22, layout only)

Section subtitles (`.hintLine`, shared by blocks/equipment/exercises) now wrap
instead of truncating with an ellipsis. Exercise-list VIEW chips reordered to
**A–Z, Z–A, Recent, Custom** and the **default view is now A–Z** (was Custom) —
display-only: it never writes `order_index`, so sessions still follow the stored
Custom order (verified: the Abs block's stored `order_index` stayed non-alphabetical
despite the A–Z default view; `getProgram` orders by `order_index`, and `viewMode`
is DayEditorView-local state). "Save as custom order" condensed from a full row to
a compact right-aligned icon on the VIEW row (lens-only; same `saveAsCustom`
handler). Drag still enabled only in Custom. Blocks parity holds. No schema/logic/
copy change; `src/core/*` untouched.

## Removed "Save as custom order" + set program/blocks subtitles (2026-07-22)

**Removed the "Save as custom order" control entirely** (program + blocks) and its
exclusive `saveAsCustom` handler — reverses the two previous entries that added it.
Since the lenses are non-destructive (A–Z/Z–A/Recent are throwaway views over the
persisted Custom `order_index`), the only thing it did was overwrite the
hand-arranged order with a lens's order — a way to lose the arrangement the
non-destructive model exists to protect. New model: **Custom is the one persisted
order (drag to change it); the other three are views.** `commitExOrder`, the bulk
reorder endpoint, `order_index`, and drag-in-Custom are untouched (drag still calls
`commitExOrder`); the dead `.saveCustomBtn` CSS was removed too (grep-clean).

**Section subtitles set** (role-distinguishing copy; they already wrap): program =
"Your training plan — ordered days your sessions follow in sequence." (added — the
program page had no subtitle before); blocks = "Reusable exercise bundles you
attach to any session — finishers, warm-ups, extras. Not tied to a day or a
program." Verified: `order_index` unchanged by viewing lenses; drag-in-Custom
works; both subtitles wrap in full. `src/core/*` untouched.

## Session Add-exercise picker → drill-in navigator (2026-07-22)

Rebuilt `AddSheet.tsx` from a flat/accordion list into a **drill-in navigator**
(one flat, full-width level at a time): Screen 1 sources (search + a row per
program, active first with an `active` badge, + a Blocks row) → Screen 2 a
program's days / the block library's blocks (back header, `N ex`, chevron, quick
`+`) → Screen 3 a day/block's exercises (`Add all · N` hero, each a `+`→`✓`
add/remove row with its target reference line + tint). A sticky footer shows the
running "N added this session · Done". A nav stack drives back.

**No dedupe** (removed the label-dedupe): a day-Abs and a block-Abs are distinct
objects, each reachable under its own source — verified both show on prod-mirror
data. **Every program is navigable** (not filtered to active) — the old flat list
mixed all programs' days with blocks unlabeled; now each program is its own drill
row and the inactive "hi"/Hiii is a labeled row, not loose. Sourcing is unchanged
server-side (`listPrograms` already excludes the block library); only presentation
changed. **Re-tap `✓` toggles-off safely**: `removeOccurrence` is destructive to
logged sets, so the parent (`removeFromPalette`) only un-adds occurrences with NO
logged sets/cardio — the picker never deletes logged work; a logged exercise is
kept (remove it from its card). Adding a day (`onAddMany`) carries its
prescriptions into the occurrence (targets ride along, whatever program) but
**never prefills** the log inputs — the StrengthCard still opens on its static
defaults (`load = bodyweight ? 0 : 45`, `reps = 8`), and the target shows only as
the reference line; adding from a non-active program does not change the active
program (session-local `addOccurrence`, no program/day writes). Log page feeds
`activeProgramId` (from the `/api/programs` summaries), `addedIds` + count (from
loggables), `onAddMany`, and the safe `onRemove`.

**Flagged — "Add today · up-next day" hero omitted.** There is no reusable
up-next-day logic in the codebase (only a static "Ready when you are" label and a
"Last · <composite label>" on Home; `workout_logs.program_day` is a concatenation
of whatever was logged, not a single day, so it can't yield a reliable next day).
Per the deliverable's instruction I omitted the hero rather than fabricate one;
every day is still reachable via Programs → active program → days. `src/core/*`
untouched. (The bottom-left "N" over the sheet footer in dev is the Next.js dev
indicator — absent in prod.)

## Add-exercise picker → append-only refinements (2026-07-22)

**GATE cleared (duplicates representable).** Read-only prod: the only unique
indexes on `session_exercises` are `client_instance_id` and the `id` PK — there is
**no `(workout_log_id, exercise_id)` unique constraint**, and `set_logs`/
`cardio_logs` key to `session_exercise_id` (160/166 set_logs non-null), so two
occurrences of the same exercise keep their sets separate. No schema change.

Refinements to `AddSheet.tsx` (presentation + add-behavior; sourcing unchanged):
- **Append-only** — `+` always appends another occurrence and never toggles off.
  Duplicates allowed (add-order = session order); an exercise added ≥1× shows a
  subtle `×N`. The picker NEVER removes an occurrence (the previous "re-tap
  un-adds unlogged" behavior was deleting exercises). Parent now passes
  `addedCounts` (a Map) instead of `addedIds`.
- **Flatten blocks** — each block is its own row under BLOCKS on Screen 1,
  drilling straight to its exercises (removed the intermediate Blocks container).
  Programs still drill program → days → exercises; the asymmetry is correct.
- **Removed the "reusable" badge** from blocks (the BLOCKS header says it); kept
  the `active` badge on the active program.
- **Day-list is nav-only** — removed the quick-`+` on the day-list screen.
- **Demoted "Add all"** from the gradient hero to a small secondary text button
  in the exercise-screen header; it appends the whole day/block once, in order.
  **Transient Undo**: after an Add-all the footer offers "Undo" that reverses just
  that batch (`onAddMany` returns the new instanceIds; `undoAddAll` removes only
  the freshly-added occurrences with NO logged sets/cardio — a logged occurrence
  is never deleted). Cleared on the next add or a navigation.
- **Remember location** — the nav stack lifted to the log page (`addNav`,
  descriptor-based `{screen, programId?/dayId?}`), so reopening the sheet during
  the session restores the last container browsed; missing containers fall back to
  sources. Per-session (log-page lifetime), no persistence.

**Guardrail held:** the picker never deletes an occurrence — logged or unlogged —
except the Undo of a just-made Add-all of unlogged rows. No prefill (targets stay
the reference line; StrengthCard opens on static defaults); adding from a
non-active program doesn't switch active or write to any program/day/block.
Verified in-app: `×2` after two taps + two separate session cards; Add-all → Undo
reverses only the batch (kept the manual adds); reopen lands on `‹ Abs` not root;
day rows have no `+`. `src/core/*` untouched.

## PROPOSAL — per-exercise logging fields + add-exercise fix (2026-07-22, report-only)

Investigation round; nothing built. Read-only prod; the one local repro write
(tagging Air Bike) was reverted.

**A. "＋ Add an exercise" on My-exercises goes nowhere — diagnosed.** The page's
`onPick` only closes the sheet + reloads the manage list (exercises/page.tsx);
the only writes live inside ExerciseSearch (POST custom; PATCH movementPattern on
Tag & add). Repro: picked library "Air Bike" → Tag & add → PATCH 200 (row became
`mp=conditioning, untagged=false, conditioning_only=true` — the structural link
working) → sheet closed → row absent, because `/api/exercises/manage` excludes
`source='library'` (manage/route.ts:28). Silent success, invisible result — the
known manage-query limitation, exactly. Picking an already-tagged library row is
worse: no write at all happens. Only create-custom works end-to-end (source=
'custom' is included). **Fix shape (not built):** make the manage list include
library rows the user has claimed — zero-schema first (include `source='library'
AND (untagged=false OR referenced by program/session/logs)`), graduating to an
explicit additive claimed-marker column only if that over-includes.

**B/C. Per-exercise logging fields — the model (proposal, paused).**
Prod facts (read-only): 878 exercises (834 library / 41 curated / 3 custom, 15
cardio); `params` on 4 rows, key-sets {duration_min,speed}×2,
{duration_min,incline,level}×1, {duration_min,incline,speed}×1. `set_logs.load`
and `set_logs.reps` are NOT NULL; `cardio_logs` has NO weight/load column — so a
mixed weight+duration entry is **not representable today in either log table**;
the mixed case is a storage question before a rendering one.

- **Storage:** additive `exercises.log_fields jsonb` (NULL = inherit defaults).
  NOT inside `params` — params holds prescription VALUES keyed by field name; a
  config key would collide. DDL: `ALTER TABLE exercises ADD COLUMN log_fields
  jsonb;` (878 rows all NULL after; no backfill). PAUSED.
- **Precedence:** override (`log_fields`) → name-default (`cardioFields(name)`)
  → type-default (strength weight/reps/effort; cardio duration+distance).
  `cardioFields()` becomes the default-provider only, read through one resolver
  (e.g. `lib/logFields.ts`) that every current reader (CardioCard, TargetSheet,
  editor chips, AddSheet targetRef) goes through.
- **Session cards:** router is `conditioning_only` (log page → StrengthCard |
  CardioCard). CardioCard is already field-driven (smallest change); StrengthCard
  is a weight+reps state machine (offsets/lanes/drops) — keep it whole. New
  router: config has reps → StrengthCard; else the metric card (CardioCard
  extended with an optional weight cell). `conditioning_only` stays as the
  default-provider input, retiring as the router when this builds.
- **Targets:** render target inputs from the same resolver. Anchor rule
  generalizes: **sets anchors when 'reps' is in the config; else duration; else
  the first metric** (Farmer's Walk → duration anchors).
- **Progression readers (all, cited):** core/progression.ts + core/stallBuster.ts
  + core/machineTracking.ts via lib/coreAdapters.ts (reads set_logs ONLY) via
  /api/progression + /api/exercises/[id]/last-session; StrengthCard
  checkProgression. core/volume.ts is DORMANT (no production importers; Stats is
  a locked placeholder) — the volume-math landmine is smaller than framed. Guard
  = the existing invariant (core reads set_logs only, schema.ts §cardio comment):
  mixed exercises log to cardio_logs (+ additive `load numeric` column, PAUSED),
  so they produce no progression signal by construction — graceful, no crash; the
  progression menu only exists on StrengthCard.
- **"Both" type NOT needed** — the field list subsumes it (owner's assumption
  holds). Farmer's Walk = strength-typed exercise whose config swaps reps for
  duration/distance: editor "Fields" row → metric card + weight cell →
  cardio_logs row with load. Which log table an entry lands in derives from the
  config (reps present → set_logs; else cardio_logs).
- **Phasing:** 0) the A-fix + an "Edit exercise →" link from the target sheet
  (trivial nav: TargetSheet has `exerciseId`; push `/exercises?edit=<id>` + a
  query-param open on the exercises page — WRINKLE: the link silently no-opens
  for library-sourced exercises until the A-fix lands, and there's no by-id
  manage-shaped endpoint if we ever want to open the sheet in place). 1)
  `log_fields` column + resolver + editor Fields row + target sheet/chips read it.
  2) `cardio_logs.load` column + the metric-card weight cell + router change.
  Both DDLs additive and PAUSED for sign-off.

## Exercise section — Track A rework (2026-07-22, no schema)

**Manage list broadened (the add-bug fix).** `/api/exercises/manage` dropped its
`source != 'library'` filter and now returns EVERY exercise — supersedes the
narrower "tagged-or-referenced" Phase-0 proxy: with the full catalog visible,
reachability is total by construction. Tag & add and already-tagged picks no
longer succeed invisibly; Power Stairs (graduated library row) is reachable and
editable. Payload is the full catalog (~880 rows) — fine for a single user;
consequence flagged: the Train page's "N tagged" count (it counts manage rows
with `untagged=false`) now counts tagged exercises across the WHOLE catalog
(previously non-library only) — more truthful, slightly larger number.

**List (exercise-section v2).** Four tabs over the full catalog — All (default),
Library (under library names; renamed rows get a small accent dot + a
`renamed "<my name>"` subline hint), Renamed (my names), Custom. Tab membership:
Library = rows with a `canonical_name`; Renamed = those where `name` differs;
Custom = rows with no canonical reference (true customs + the two curated
originals with no library twin — same classification the old kind logic used, so
nothing recategorized). Prod reconciliation (read-only): All 878 = Library 873 +
Custom 5; Renamed 2 ⊂ Library. Rows went quiet: the LIBRARY NAME / CUSTOM /
YOUR NAME → LIBRARY pills are gone; the subline carries
`kind-word · primary muscle · equipment · N logged` (kind-word only where the
tab doesn't imply it); the dot is the only inline marker. New subheader set.
**Scale approach:** one manage fetch, client-side search over name+canonical,
A–Z within tab, rendering capped at 150 rows with a "Showing 150 of N — keep
typing to narrow" note (search-first).

**Edit sheet — one sheet, three variants by kind.** Library: name read-only +
"Rename…" reveals the input (renaming is the deliberate act that creates the
Renamed entry); no Collapse/Remove. Renamed: name editable, library name always
visible + one-tap "Use library name"; no Collapse/Remove. Custom: name editable;
Collapse-into-library and Remove live ONLY here. All variants: Description,
Type toggle (unchanged behavior — still the session router until Phase 2; the
structural tag↔flag link intact), Unilateral, a **Tag row** (current pattern or
"untagged" + Change… → the pattern picker, through the same PATCH that auto-sets
`conditioning_only` for `conditioning` — verified on a throwaway: Air Bike
tagged Conditioning via the sheet → `conditioning_only=true`; reverted), and a
**view-only Equipment row** ("Manage in Equipment →" navigates to /equipment;
inline unit add/edit removed from this sheet). Kind line under the title
("Library exercise" / "Renamed · library: <name> · N logged" / "Custom · yours")
replaces the badge pair. The Fields row is NOT added — Phase 1 adds it under Tag
once the `log_fields` DDL is approved.

**Target-sheet edit link (C11).** TargetSheet gained a quiet "Edit exercise →"
→ `/exercises?edit=<id>`; the exercises page opens that sheet from the query
param (read once, then stripped so closing doesn't reopen). Works for
library-sourced exercises because of the manage broadening — verified via
`?edit=lib_Power_Stairs` and by clicking through from a program target sheet.

**Owner decision recorded for the field-config phases: field edits are
FORWARD-ONLY — the past is never rewritten.** Old sessions keep the fields they
were logged with; a warning fires before saving a field change on an exercise
with logged history; progression gets an indicator that the fields changed, not
a reinterpretation of old data. (Phase 2 implements; recorded now.)

## Exercises polish — create-custom, pagination, Logged chip, cancels (2026-07-22)

The Exercises page's "＋ Add an exercise" sheet (library search) is GONE — with
the full catalog visible, picking a library row was a no-op by definition on
this page. Replaced by a compact "＋ New custom exercise" pill (visible on every
tab) opening a direct create flow: name → create → movement-pattern tag/skip
(same POST /custom + PATCH movementPattern path, so the tag↔flag link still
fires); on finish the list reloads and the new custom's edit sheet opens. A
thin/empty search (≤5 matches) offers "Not finding what you need? Create your
own exercise" with the search text pre-filled as the draft name. The dead
`ExerciseSearch` re-export was removed from ExerciseDetailSheet.

"See 50 more" pagination past the 150-row initial cap (repeatable to the end;
"Showing N of M." updates; search filters the full set and resets the window).
Perf: plain appended rows, verified at 200 with no jank; worst case ~880 simple
rows — acceptable; windowing is the mitigation if it ever matters. A "Logged"
filter chip (right-aligned on the tab row, off by default, page-local state)
composes with every tab — e.g. Library+Logged = library rows with ≥1 logged
entry. Cancelable edits in the edit sheet: Rename… (library) gains Cancel back
to read-only; name drafts show Cancel once dirty; Tag Change… gains Cancel that
resets the picker — verified all three cancel with zero writes (Air Bike
byte-identical after cancels). No schema; `src/core/*` untouched.

## Phase 1 — per-exercise log fields (2026-07-22, migration 0024)

**Storage.** Additive `ALTER TABLE exercises ADD COLUMN log_fields jsonb`
(migration 0024) — NULL = inherit defaults, no backfill. Applied LOCAL;
`EXPECTED_MIGRATIONS` 24→25; **prod paused for owner sign-off** (before/after:
row count identical, all NULL, migrations +1).

**Resolver — `src/lib/logFields.ts`, the ONE precedence chain:** override
(`log_fields`, sanitized to the 8-field vocabulary weight/reps/effort/duration/
distance/level/speed/incline; empty/invalid ⇒ inherit) → name-default
(`cardioFields(name)` for cardio-typed — its duration+distance fallback IS the
cardio type-default) → type-default (strength → weight/reps/effort).
`cardioFields()` is now a default-provider called ONLY by the resolver; the four
surfaces (CardioCard, TargetSheet, DayEditorView chips, AddSheet reference) all
import `resolveMetricFields` — grep-verified no direct callers remain.
`log_fields` is threaded through programs.ts → editor types, /api/sessions/[id]
→ sessionStore Occurrence/AttachExercise → LoggableOccurrence, and the manage
route → ManagedExercise. PATCH /api/exercises/[id] accepts `logFields` (null
clears; a non-empty sanitized array saves; empty/invalid → 400). Core never
reads it (grep clean) — the set_logs-only invariant stays the progression guard.

**Fields editor ("Logs & targets", all three sheet variants, under Tag).**
Eight chips pre-filled from the resolver; Type demoted to "Type (preset)" ("sets
the default fields below — edits there override per-exercise"; routing behavior
UNCHANGED this phase). Override present → "Edited — default for <type> is X ·
Reset to default"; Reset writes NULL (inherit — future default improvements flow
through), not a copy. Empty set blocked in UI + API. **Effect boundary (no
silent no-ops):** a config whose effect can't materialize this phase (strength
missing reps or holding metric fields; cardio holding strength fields) shows
"Takes effect when mixed logging ships (next update)" before AND after save.
StrengthCard untouched.

**Forward-only history warning (ships now).** Saving a field change on an
exercise with ≥1 logged entry first shows the warning (past sessions keep their
data exactly as logged; only future sessions use the new fields; progression
will note the change) with Cancel / "Save — applies going forward". Proven on
Captain's Chair (4 logged): Cancel wrote nothing; confirm changed ONLY
`log_fields`; **set_logs md5 checksum identical before/after**. No-history
exercises save without the warning.

**Verified end-to-end (throwaway rows, all reverted):** Power Stairs override
duration+distance → editor chip ("20 min · 1.5 dist"), target sheet
("Duration (min) *" + Distance, no Level — duration stays the anchor), AddSheet
reference, and session CardioCard cells (min + distance) all reflected it
immediately; Reset → NULL → name-guess (Duration+Level) returned everywhere.
Stairmaster `params` `[5,15]` byte-identical throughout — field-config saves
never touch `params`. Resolver precedence locked by 7 unit tests. Blocks parity
structural (same TargetSheet/DayEditorView engine).

## Phase 2 — mixed logging (2026-07-23, migration 0025)

**Migration 0025 (additive, prod PAUSED for sign-off):** `cardio_logs` gains
`load numeric` + `effort "effort"` — effort mirrors set_logs exactly (the same
pgEnum more_in_me/near_failure/to_failure, nullable like set_logs' effort), so
target-vs-actual stays comparable. Local applied; `EXPECTED_MIGRATIONS` 25→26.

**Profiles replace the chips.** Six named sets in `lib/logFields.ts`
(LOG_FIELD_PROFILES): Strength w/r/e · Cardio machine dur/dist/level ·
Treadmill-style dur/dist/speed/incline · Distance cardio dur/dist · Loaded
carry w/dur/dist/e · Timed hold w/dur. **Default mapping (resolver layer, no
rows written):** the cardio name-guess maps to the nearest profile — guess has
speed/incline → Treadmill-style; has level → Cardio machine; else → Distance
cardio. Consequence stated plainly: duration+level machines (Stairmaster) and
treadmills gain ONE blank-optional distance cell (+ distance as an anchor
alternative); everything else identical. Picking the default profile writes
NULL (inherit), same as Reset — never a frozen copy. Non-matching stored
overrides render honestly: "Custom config — closest: <profile> (±N fields)" +
read-only field list, no highlight, never coerced (verified with an all-8
override; prod's ONE override — Power Stairs [weight,effort,duration,level] —
is exactly this case: closest Loaded carry ±2, routes metric before AND after,
zero deploy diff, and its weight/effort cells finally materialize).

**Router is the config.** `routesToStrength` (reps resolved → StrengthCard +
set_logs; else metric card + cardio_logs) now drives: the session card router,
TargetSheet's branch, DayEditorView's chip, AddSheet's reference, and the
last-session route. `conditioning_only` demotes to default-provider (grep: its
only remaining conditional use is the Type-preset toggle's own highlight).
**Fixed point PROVEN on prod (read-only):** all 878 rows, 0 routing changes for
NULL-config rows. Gap found & fixed in verification: the ad-hoc add path
(search route → ExerciseSearchResult → addAdhoc) didn't carry log_fields — a
configured exercise added ad-hoc routed by defaults. Known edge (pre-existing
class): a swap keeps the occurrence's original config snapshot, same as
conditioning_only always did; swaps never cross the routing boundary.

**Metric card extended.** Cells from `resolveCardFields` (weight → metrics →
effort), units lb/min/mi; effort = the same 3 enum values in session voice.
Blank-optional (empty configured cells log null); the one guard stays
duration-or-distance. Verified Farmer's Walk (Loaded carry): lb·min·mi·effort
cells; weight+minutes-only log → ONE cardio_logs row {load:135, duration:5,
distance:null, effort:null}; guard rejected weight-only; zero set_logs rows.

**Target sheet generalized.** Metric fields from the resolver minus weight
(weight is logged data, never a target); effort renders as the 3-pill selector
where configured, stored in `params.effort` (tag string, additive jsonb key).
Anchor: reps → Sets* (unchanged); else duration OR distance (either alone or
both = compound "x mi under x min"); error copy "Add a duration or distance…".
Verified: blocked with neither; saves with distance-only, duration-only, both.
Units on inputs (min/mi) and cells (lb/min/mi). Chips + AddSheet refs show the
same (e.g. "5 min · 0.5 mi · near failure").

**Mixed history — chosen behavior (§6):** past logs never rewritten (set_logs
md5 identical through convert→reset, 2b2834…); the forward-only warning fires
on conversion AND on Reset; old sessions keep their mode (the occurrence
snapshot routes them — old strength sets render in the StrengthCard exactly as
logged); the NEW mode's card reference line reads "last — no prior data in this
mode · earlier strength history exists" (via a hasStrengthHistory flag on the
last-session route); the server session payload still returns the old sets.
Honest edge flagged: an OLD-session StrengthCard for a converted exercise gets
the metric-shaped last-session response, so its own "last" line reads "no prior
data" — read-only reference, not data loss.

**Boundary notes removed** — everything materializes now. Core untouched and
still set_logs-only (metric-routed exercises produce no progression signal by
construction). 168 tests; Stairmaster `[5,15]` byte-identical end to end.

## Phase 2 polish — profile UX, either-or, distance range, unit entry (2026-07-23, no schema)

**§1 Profile dropdown + STAGED Save.** The six-row radio list became a compact
dropdown (the exercises-page view-dropdown chrome), closed state = current
profile + "(default)" when inherited, or the legacy "Custom config — closest: X
(±N)". Picking now STAGES (Save/Cancel appear; the closed label + §2 equipment
answer update immediately); the forward-only history warning fires on SAVE, not
stage; Cancel writes nothing (DB-verified). Reset-to-default stages too.
Accidental instant router flips are gone.

**§2 Equipment legibility.** When the staged/selected profile routes metric,
the sheet's Equipment section is replaced by "Equipment tracking applies to
strength-logged exercises." (the only surface that conditionally shows
equipment — the metric session card never had it).

**§3 Links.** The cross-link split into separate Program → /program and Blocks
→ /blocks links; the target-sheet linkout reads "Edit exercise → name, tag,
what it logs & targets" (fields/shape — target VALUES stay in the sheet).

**§4 Either-or decoration.** Duration/Distance lost their per-field asterisks;
ONE grouped indicator ("* at least one of duration or distance"); both inputs
error-highlight only when neither is filled. Sets* unchanged.

**§5 Distance range.** Distance gained Single/Range in the target sheet
(program + blocks, same engine) using duration's exact stored representation —
number or [min,max] in params — via the new shared parse/store/format path
`lib/targetValues.ts` (duration now reads through it too; 7 lock tests incl.
the [5,15] byte-identical round-trip). Chips/AddSheet render "3–4 mi".
Verified: [3,4] stored, chip correct, no-edit save byte-identical. Sets-range
NOT added (different storage, known future).

**§7 Unit entry (canonical storage inviolable).** Weight (session cells) and
distance (session cells + target inputs) unit labels are tappable: lb↔kg,
mi↔km. In alternate mode the typed value shows its live conversion ("10 kg →
22 lb"; "4 km → 2.49 mi — stores in mi") and the SHOWN value is exactly what
stores (DB-verified both). **Rounding rule: weight → nearest 0.5 lb; distance
→ 2 decimals (mi)** (`lib/units.ts`, lock-tested). Toggling clears the field
(reinterpreting typed digits would silently change the value). The entry-unit
preference persists locally per FIELD (one localStorage key each), so it
carries across surfaces (target sheet + session cell share it); all storage
and displayed history stay lb/mi/min. Duration stays min-only.

**§6 Metric-card grid.** Numeric cells: ≤3 → one row, 4 → 2×2 (Treadmill
verified 2×2; Loaded carry one row of 3); effort renders as a consistent
full-width control below the grid — no orphan cells. 175 tests; params
byte-identical throughout.

## Units everywhere + rest on metric card + sheet integration (2026-07-23, no schema)

**§1 Global units, display + entry, strength path included.** ONE preference
per dimension (same localStorage keys as before — they were already
one-per-dimension; now display-side too, with a subscription in `lib/units.ts`
+ `lib/useUnit.ts` so every mounted surface follows a toggle together).
**Display rounding stated separately from entry rounding:** display kg → 1
decimal, km → 2 decimals (`lbToKg`/`miToKm`); entry stays weight → nearest
0.5 lb, distance → 2 decimals. Display conversion NEVER writes — proven: 6
unit toggles with no entry left set_logs/cardio_logs/exercises md5-identical.

*StrengthCard* took the layer WITHOUT touching its state machine: all internal
numbers stay canonical lb; the ONE entry boundary is `canonicalLoad`
(kg-typed → kgToLb), feeding the existing totalLoad/logSet math; display sites
(last line + recal note via `displayWeights` string transform, SetRow rows +
drop rows + offset suffix via a prop, offset-math line, progression
suggestion, equipment-page built-in badges) convert read-side. Proven: lb mode
renders byte-identically ("120 lb × 10", "↳ drop · 80 lb × 10") and stores
today's exact shape (load 100, load_entered null); kg mode reads coherently
everywhere (54.4 kg / 36.3 kg / 56.7 kg together), typed 10 kg → hint
"→ 22 lb" → stored 22, and the row reads back "10 kg". **Scoped OUT (stated
boundary, per the out-clause):** pre-filled canonical inputs stay lb-entry —
the built-in offset input (labeled "(lb)" in kg mode) and SetRow's edit form
(labeled "lb") — because reinterpreting pre-filled canonical digits under a kg
label is the corruption hazard. Distance stays entry-side conversion (display
remains mi everywhere), per the round's weight-display-only scope.

**LATENT BUG found + fixed:** the previous round's target-sheet distance
toggle persisted globally, so a sheet with a STORED mi distance could open
under a km label and a no-edit save would reinterpret mi digits as km
(2.49 → 1.55). Guard: a sheet with a stored distance always opens in mi (an
explicit in-sheet toggle clears, as shipped). Proven: global km pref + stored
2.49 → sheet opens "mi", no-edit save byte-identical 2.49.

**§2 Rest on the metric card.** The SAME machine mirrored (timer state +
restTimerBus mirror + the shared RestBanner — no second system). Stored rest:
NONE for metric entries — cardio_logs has no rest column (schema out of
scope); strength keeps writing set_logs.rest_seconds as today. The held state
drops the "written to your next set" claim via a presentational
`storesToNextSet` prop (strength copy byte-identical). Verified start/stop/
hold/discard + the session-bar mirror.

**§3/§4 Sheet integration.** The profile control now matches the Tag row
grammar (readonly value + quiet "Change…", menu below; staging/hints in the
hint tier). The Program/Blocks cross-link is ONE hint line with two inline
links (`.inlineLink`, zero button chrome). Equipment note (§2 prior round)
verified in place. 178 tests (+3 unit/display/coherence locks).

## Metric entry parity + universal units + footer (2026-07-24, migration 0026)

**Migration 0026 (additive, prod PAUSED):** cardio_logs gains `rest_seconds
integer` + `rest_source text` (timed|derived|user) + `drop_set_group text` —
each MIRRORS set_logs' column name/type/semantics exactly. FLAGGED at the gate:
§1 scoped the rest columns; `drop_set_group` was added to the same migration
because §2's drop storage mirror requires it. `EXPECTED_MIGRATIONS` 26→27.

**§1 Rest wired.** logCardio mirrors logSet's TIMED branch verbatim: rest = the
edge before this entry, only when a prior live entry exists in the occurrence
(N entries = N−1 rests); the derived-gap heuristic is reps-based and stays
strength-only (no fabricated rests). The RestBanner "→ written to your next
set/entry" copy is restored via a `nextNoun` prop (strength copy byte-
identical). Proven: entry 1 rest null, entry 2 {rest_seconds:3, rest_source:
'timed'} in the DB; entry rows read "rest 0:03 · timed".

**§2 Edit + Drop on metric entries.** Edit is inline (mirror of SetRow's):
the form offers EXACTLY the entry's stored field set (its non-null columns),
not the exercise's current config — forward-only proven: a load+duration entry
offered [lb, min] only, though the config also has distance+effort. Its anchor
rule travels with it (can't blank both duration and distance). Sync mirrors
editSet (pending_update → new PATCH /api/cardio-logs/[id]). Drop appears ONLY
when weight is in the resolved set (lock-tested; Loaded carry [Edit, Delete,
+ Drop] vs Treadmill [Edit, Delete]); REPRESENTATION: a drop is its own
cardio_logs row (reduced load + its own duration/distance) sharing the
parent's client-generated drop_set_group, parent tagged on first segment —
exactly the strength scheme; renders "↳ drop · 50 lb, 2 min".

**§3 Universal unit inputs — no lb/mi-only islands.** New contract
(`formatForUnit`/`parseInUnit` + the `UnitNumberInput` component): CANONICAL
(lb/mi) is the only source of truth in state; display = format(canonical)
(kg 1dp / km 2dp); ONLY typing writes (parse in the active unit → canonical);
unit toggles re-FORMAT, never re-parse (the lock test shows why: canonical
22.3 lb displays 10.1 kg; re-parsing would drift it to 22.5). Enumeration:
StrengthCard load cell + drop input (empty-start, entry-convert + hint),
StrengthCard built-in offset (UnitNumberInput — the prior round's scope-out is
CLOSED), SetRow inline edit (UnitNumberInput — ditto), CardioCard entry cells
(entry-convert + hint), CardioCard edit + drop forms (UnitNumberInput),
EquipmentSheet built-in (UnitNumberInput, label "Built-in kg", 20 lb shows
9.1), AddUnitModal built-in (UnitNumberInput), TargetSheet distance
single/range (UnitNumberInput — the clear-on-toggle corruption guard is
SUPERSEDED by convert-on-display). Duration stays min-only. Drift proven E2E:
10+ toggles over a pre-filled SetRow edit (120 ↔ 54.4) and equipment built-in
with md5 checksums (sets incl. load_entered/builtin_offset, cardio incl.
rest, equipment built-ins) byte-identical. Distance DISPLAY completed: entries
("3.22 km" for stored 2 mi), last lines, chips (formatStoredDistance,
lock-tested), and target inputs all follow the global unit; typed 3.22 km
stored 2 (mi).

**§4 Footer.** Remove target + "Edit exercise →" share one quiet row
(.footRow); the descriptor is a right-aligned micro-hint ("name · tag · what
it logs & targets"); Remove exercise… stays the separated destructive footer.
183 tests (+drift, drop-visibility, rest-write, distance-display locks).

## kg rounding BUG fix + target-line diagnosis + metric parity (2026-07-24)

**§1 BUG (data-affecting) — entry rounding now happens in the UNIT OF ENTRY.**
Root cause: `kgToLb` converted first and snapped to the 0.5-lb plate grid, so
kg was quantized to the wrong grid (50 kg → 110.231 → 110.0 → read back
49.9 kg). Fixed at the entry boundary only — StrengthCard's state machine
untouched. New rule (stated in `lib/units.ts`): **kg entry → nearest 0.1 kg,
then × LB_PER_KG stored to 2 dp lb; km entry → nearest 0.01 km, then ×
MI_PER_KM stored to 4 dp mi; lb/mi entry unchanged.** The canonical precision
is chosen so the entry unit's display rounding (kg 1 dp, km 2 dp) reproduces
what was typed. Display of canonical values is capped at 2 dp (`displayLb`/
`displayMi`) so a 4-dp mi never reads as "3.1069 mi". Verified E2E: typed
50 kg → stored **110.23** → reads 50 kg, survives reload, reads 110.23 lb in
lb mode and 50 kg again on toggle back. Round-trip lock added over 8 kg and 6
km values; existing drift locks still pass.

**HONEST DISCREPANCY (flagged, not silently "kept"):** the brief said "entry in
lb → keep today's nearest-0.5-lb rule". Typed **lb was never snapped** — the
0.5 grid only ever applied to the kg→lb conversion (exactly the bug). lb entry
therefore remains pass-through (unchanged in fact); snapping typed lb would
have been a new behavior change (47.3 → 47.5), so it was not introduced.

**§1 prod drift check (read-only, NOT rewritten).** Entry unit isn't recorded,
and every 0.5-grid lb value has *some* kg preimage under the old rule, so no
row is positively identifiable. Bounded and judged instead: the 36 set_logs
rows in the kg-entry window (2026-07-23/24) are all round lb machine loads
(20/50/60/70/100/110/120/140/150/160/180/190/195/220/320/340) whose kg
displays are ugly (9.1, 49.9, 88.5, 145.1 kg) — the signature of lb entry;
whole-DB census 202/202 on the 0.5 grid, 0 off-grid. **Credible drift
candidates are 5 cardio_logs rows** whose kg/km displays ARE round: ids 6,7,8
load 4.5 lb (= 2.0 kg; would now store 4.41, drift 0.09 lb) and distance
4.35 mi (= 7.00 km; would now store 4.3496, drift 0.0004 mi); ids 9,10 load
11 lb (= 5.0 kg; would now store 11.02, drift 0.02 lb). Max drift ≤0.09 lb.
Left as-is — owner's call. (Caveat also named: 110 lb displays as 49.9 kg, the
exact symptom shape, so shoulder_shrug ids 215–217 are ambiguous.)

**§2** The "→ N lb" conversion hint is gone from every weight/distance input
(strength cell, metric cells, target sheet); unit labels stay tappable.

**§3 DIAGNOSIS — no regression; two separate findings.** (a) The strength
target line renders correctly: verified live that an exercise added from a
program day shows `target 3 × 8-12 · near failure`. The owner's occurrence was
added **Ad-hoc** (prod `session_exercises` id 123, source "Ad-hoc",
2026-07-24) — `addAdhoc` carries no day target, so no line. Correct behavior;
the target itself exists (prod `program_exercises` id 13 chest_triceps
3/8-12/near_failure, and id 56 in a "test" day with more_in_me = the "relaxed"
chip the owner quoted). A naive fallback would be wrong: the same exercise has
TWO different targets across days. (b) **The metric card never had a target
line at all** — a real gap, now built: it renders from the occurrence's params
through a new shared `metricTargetParts()` in targetValues.ts (the ONE builder
the program chip and Add-picker reference now also use), unit-aware. Since a
metric target is EXERCISE-level (one unambiguous value, unlike a per-day
strength target), the ad-hoc path now carries `params` too — verified
`target 5 min · 0.5 mi · near failure`.

**§4 Metric-card parity with the strength card.** Rest moved out of the entry
string onto its own connector sub-row between entries — `RestConnector` was
generalized to value+callback props so BOTH cards share ONE component (no
second rest system); a metric rest correction writes `restSource: "user"` via
editCardio. Entry rows gained the trailing chevron and the hint ("tap an entry
to edit or add a drop"; the drop clause only where a load exists). Effort moved
out of the value string to the row's right (`setEffort`, as strength does) and
its control now uses the strength card's `cellSelect` sizing. Value hierarchy
matches: headline metrics (weight · duration · distance) prominent, machine
settings (speed/incline/level) a muted suffix. 185 tests.

## §5 Working/Warm-up on metric entries (2026-07-24, migration 0027)

Column check reported first: `set_logs` uses `set_type` (pgEnum
["warmup","working"], NOT NULL); `cardio_logs` had no equivalent → gated.
**Owner amended the proposal to NOT NULL rather than nullable-with-a-
convention** — absence isn't meaningful (every entry is one or the other), so
a NULL-reads-as-working sentinel would be a rule a future reader has to
remember. Shipped as:
`ALTER TABLE "cardio_logs" ADD COLUMN "set_type" "set_type" DEFAULT 'working' NOT NULL;`
Prod before: no column, 7 cardio rows, 27 migrations → after: NOT NULL with a
'working' default, **7 rows all backfilled to 'working'** (what NULL would have
read as), 28 migrations.

Wired end-to-end mirroring strength: the same Working/Warm-up `typeSelect` in
the entry meta row (default "working"), the `warm-up · ` row prefix SetRow
uses, and setType through logCardio/editCardio/sync POST+PATCH/hydrate and the
sessions GET. **Downstream exclusion:** the metric "last …" reference now
skips warm-ups (`WHERE set_type = 'working'`), mirroring
core/machineTracking's `setType !== "working"` skip on the strength path —
verified live (a 3-min warm-up + a 12-min working entry → the reference
returns the 12-min one). Progression needs nothing: `src/core/*` reads
set_logs ONLY, so metric warm-ups are excluded from it by construction (grep
confirms core never touches cardio_logs). 186 tests (+ a setType default/
round-trip lock).

## Default-profile audit + 15 curated remaps (2026-07-24, no schema, no writes)

Catalog audit (878, read-only prod) against the six-profile vocabulary. All 15
confirmed remaps are implemented in the RESOLVER'S DEFAULT LAYER only
(`DEFAULT_PROFILE_BY_NAME` in lib/logFields.ts) — they change what a NULL
`log_fields` resolves to. **No row was written, no migration.** An explicit
override still wins (sanitizeOverride runs first).

**Applied — → Loaded carry:** Farmer's Walk · Yoke Walk · Rickshaw Carry ·
Sled Push · Sled Drag - Harness · Bear Crawl Sled Drags · Prowler Sprint ·
Sled Overhead Backward Walk · Backward Drag. **→ Timed hold:** Plank ·
Side Bridge · One Handed Hang. **→ cardio corrections:** Elliptical Trainer →
Cardio machine (has a resistance level); Bicycling → Distance cardio (outdoors,
no machine level); Trail Running/Walking → Distance cardio (speed/incline are
machine settings). Every one had **zero logged history** (set_logs + cardio_logs
= 0); only the throwaway `test` day contained any of them (Farmer's Walk,
Trail Running/Walking).

**Matching is EXACT on the normalized display name — never substring.** A
substring rule is precisely what caused the bug this audit found: `cardioFields`
matched "row" inside "P-ROW-ler Sprint", so Prowler Sprint defaulted to a rowing
machine. Locked by tests: "Plank Jacks"/"Weighted Plank Row"/"Sled Push Press"
must NOT inherit their contained keys. Keyed on the DISPLAY name, so renaming an
exercise drops it back to the guessed default — accepted: a rename is
deliberate, and re-picking the profile is two taps.

**THE GATE (confirmed in code, now also a lock test):** `cardioFields()` has
exactly ONE call site — logFields.ts, *after* `if (!ex.conditioningOnly) return
strength`. The name-substring heuristic is therefore unreachable for every
strength-typed exercise; the trap surface is only the cardio-typed set (15 rows
in prod). "Bent Over Barbell Row" and "Step-ups" never touch it.

**Left alone (owner-confirmed), flagged ambiguous:** Isometric Chest Squeezes,
Isometric Neck Exercise ×2, Superman, Monster Walk, Spider Crawl, Forward Drag
with Press. **Rejected false positives** (pattern-matched but rep-based):
Isometric Wipers, Push Up to Side Plank, Sled Row/Reverse Flye/Overhead Triceps
Extension, Sledgehammer Swings, Drag Curl, Hang Clean/Snatch variants, Hanging
Leg Raise/Pike/Good Morning, Sit-Ups, Glute/Hip Bridges.

**TWO GENUINE PROFILE GAPS — recorded as evidence, nothing built:**
1. **Rope Jumping** — duration-only (distance is meaningless; it's also
   rep-countable). Left on Distance cardio: blank-optional already leaves the
   distance cell empty, and Timed hold would wrongly imply a *loaded static
   hold*. Evidence for a future 7th profile: **"Timed" (duration only)**.
2. **Forward Drag with Press** — a carry/drag WITH a rep component; neither
   Loaded carry (no reps) nor Strength (no distance/duration) fits. Evidence for
   a **carry-with-reps** profile.

**Also found:** the Power Stairs override is GONE — prod now has **zero**
`log_fields` overrides catalog-wide (that row read
`["weight","effort","duration","level"]` last round; something Reset it since,
which writes NULL). So every one of the 878 exercises is NULL-inherit, making
the default layer the only thing controlling any of them.

Verified in-app: Farmer's Walk → "Loaded carry (default)" + equipment note;
Plank → "Timed hold (default)" (weight lb · duration min); Sled Push renders as
a metric card with lb · min · mi · effort; struck Isometric Wipers unchanged at
"Strength (default)" with its equipment section intact. 194 tests.

### Follow-up: defaults key on the CANONICAL name (rename-proof)

Owner asked whether a rename breaks a default. It did — **`ex.name` is the
USER-FACING display name** (proof: `hanging_leg_raise` carries
name "Captain's Chair Straight-Leg Raise" / canonical_name "Knee/Hip Raise On
Parallel Bars"), and every payload selected `exercises.name`. So renaming
"Farmer's Walk" → "Farmer Carry" would have silently dropped it to Strength,
and "Walking, Treadmill" → "Morning Walk" would have lost speed/incline.

Fixed in BOTH default layers:
- the curated map is keyed on `canonicalName`, and is consulted ONLY when a
  canonical name exists — so a from-scratch custom never inherits a library
  default through a name collision (a custom called "Plank" stays Strength).
- `cardioFields` is keyed on `canonicalName ?? name` — a renamed treadmill
  keeps its treadmill fields; a custom still gets the name guess (its purpose).

`LogFieldSource.canonicalName` is **required, not optional**: the compiler —
not a convention — guarantees every surface resolves identically, since a
missing value would silently make one surface disagree with another. That
forced threading canonicalName through programs.ts, EditorExercise,
ProgramExerciseDetail, LoggableOccurrence, the Occurrence store (+
AttachExercise, hydrate, ServerSession), the sessions GET, the ad-hoc add path,
and the last-session route — 11 call sites the compiler enumerated.

Safe by data: all 15 remapped rows have a canonical_name (0 NULL), and every
cardio-typed row does too, with canonical == display today — so behavior is
unchanged for every un-renamed exercise. Verified live: renaming Farmer's Walk
to "Farmer Carry" kept "Loaded carry (default)" (kind line: Renamed · library:
Farmer's Walk); rename reverted. 199 tests (+5 rename locks).

#### Residual, accepted: rename-breakage is bounded to library exercises — customs still key on their display name

The canonical-name fix **bounds** the problem; it doesn't eliminate it, and the
remaining exposure is inherent rather than a gap to close.

**Library/curated rows (canonical_name present) are now rename-proof.** Both
default layers key on the canonical name, so renaming one cannot change how it
logs.

**Customs have no canonical name, so `cardioFields` still keys on their display
name.** Consequences, accepted:
- **Renaming a custom CARDIO exercise can change its resolved fields** — e.g. a
  custom "Rowing intervals" (duration+distance+level → Cardio machine) renamed
  to "Morning session" falls to duration+distance (Distance cardio).
- **Custom names containing heuristic substrings still hit the trap** — a custom
  named "Prowler pushes", "Throwing drills", or "Stair sprints" matches
  `row`/`stair` inside the word and inherits that machine's field set.

**Precise scope (read from `defaultLogFields`, not assumed):** the name is only
consulted for **cardio-typed customs**. A strength-typed custom hits the
`if (!ex.conditioningOnly) return strength` early return first, so its name is
irrelevant no matter what it contains or what it is renamed to. The residual
surface is therefore: *customs with `conditioning_only = true`* — currently
zero in prod (all 15 cardio-typed rows are library/curated with canonicals).

**Why accepted rather than fixed:** the display name is the ONLY identity signal
a from-scratch custom has. There is no canonical to key on, and inventing a
hidden per-custom "kind" would be a second, invisible source of truth competing
with the profile the user can already see and set.

**Mitigation (already shipped, no new work):** set an explicit profile on the
custom. `sanitizeOverride` runs BEFORE every default layer, so a stored
`log_fields` makes the name irrelevant permanently — renames and substring
collisions both stop mattering. This is the same two-tap escape hatch that
covers a wrongly-guessed default anywhere else.

---

## Equipment section rework — copy, merge redesign, one shared form, sort/filter header

No schema, no migrations. Existing units, links, and logged history untouched;
canonical storage (lb) and the global unit preference apply as everywhere else.

### 1. The subheader says what a unit BUYS you, not what it is

The old copy described the noun. The new line states the two consequences that
make picking a unit worth the tap: *"The specific machines you train on. Pick
one while logging and that machine keeps its own history, so your numbers only
ever compare against the same station — and its built-in weight is added to your
load for you."* Both halves are literally true of the engine — per-unit history
is how `previous` is scoped, and `builtin_offset` is added at log time.

### 2. Merge is a picker, not a warning

Merge **moves** history and links, then deletes the source — it never orphans a
set. Rendering it in `warnBox` amber said "danger" about the safe operation
while the genuinely destructive one (delete) wore the same colour. Amber is now
reserved for the delete guard, and merge is a plain surface.

The target list defaults to **same type as the source**, because built-in weight
and pulley semantics don't transfer across types — merging a cable unit into a
plate-loaded one silently re-interprets every load. But a MIS-TYPED unit is
itself a reason to merge, so "Show all types" stays one tap away, and a source
with no type set shows everything (it can't filter meaningfully). Search matches
label / gym / manufacturer / model, and each row carries an identifying subline
(type · gym · manufacturer · used-by · logged) — two units labelled "VSL13" are
distinguishable only by those fields, and that duplicate pair exists in prod.

### 3. ONE unit form, four functional groups

`UnitFormFields` is now the single form for both places a unit is created or
edited: the Equipment section and the session's "New … unit" sheet. Order and
grouping are identical in both; the only difference is **Type**, which the
session flow already knows (`presetType`) and therefore hides. Groups: Identity
→ Load math → Where it is → Notes. Load math is grouped and annotated because
built-in weight is the one field that changes what a logged set MEANS.

**Built-in weight is empty by default, never 0.** Zero is a *claim* that the
machine adds nothing — usually false for plate-loaded and smith units — and it
would silently understate every set logged there. Blank means unknown; the
placeholder says so.

**Census (read-only prod, at the time of this change): 19 units — 16 NULL, 0
zero, 3 positive** (HackSquatMonroePF 105, VPL-SMBP 25, 24res 24). Nothing
stores 0, so there is **no backfill decision to make**; the empty-never-0 rule
is forward-looking only.

**Bug found by the verification, fixed here:** the session form sent `model` but
`POST /api/exercises/[id]/equipment` never read it, so a model typed during a
session was silently dropped. The route now persists it. This went unnoticed
because `model` is populated on **0 of 19** prod units — the field had no users
to notice it failing.

### 4. Header mirrors the exercises page — and the sorts write nothing

Search + ＋ in one row, then a type dropdown (options and counts derived from
the data, including "no type set" — no invented vocabulary), a sort dropdown
(A–Z / Z–A / Most logged / Recently used), and a "Used" switch. Filters and
sorts compose. `lastUsed` (max session date per unit) was added to
`GET /api/equipment` to make "Recently used" real rather than a proxy; never-used
units sink to the bottom rather than sorting as "oldest".

**Sorts are display-only and deliberately so.** Drag-and-drop ordering was
explicitly NOT built: a stored order is a second ranking competing with the
derived ones, and it would need a migration to hold something the data already
answers. Verified: sorting issues only GETs — no write of any kind.

### 5. The name is the identifier, so the name doesn't shrink

`.rowName` badges are `flex-shrink: 0`, so in a `nowrap` flex row the NAME was
the only thing that could give — a unit with three badges rendered as `p…`.
The row now wraps, badges flow to a second line, and the name keeps the first.

### Verification (local, throwaway fixture, real rows untouched)

Merge proven end-to-end on throwaways: source with 2 logged sets + 1 exercise
link merged into a same-type target → both moved, source row deleted, and the
**real** equipment checksum byte-identical before and after
(`49ab7d09d034d9aa9cec0ce1dd800906`, 6 rows). Throwaways deleted afterwards;
checksum re-confirmed. Unit-preference parity confirmed on the shared form
(45 lb ↔ 20.4 kg in both the row badge and the field, storage unchanged) and a
session-side create with 10 kg typed stored canonical 22.05 lb.

---

## One unit, many exercises — the model was already right; the UI wasn't finished

No schema change. The gate found the junction table has always been
many-to-many: `exercise_equipment`'s only uniqueness is the **composite**
`PRIMARY KEY (exercise_id, equipment_id)` (verified against prod's
`pg_constraint`), with no unique index on `equipment_id` and no application code
enforcing one. The observed 19-units/19-links 1:1 shape was **residue**, not a
constraint.

### What was already shipped, and what wasn't

The picker restructure was largely done in `ec7bae1` (Jul 19) — it already loads
ALL units via `GET /api/equipment` and groups them (On this exercise → Your
\<type\> units → Other types). The prod duplicates all predate it (both VSL16s
and both VSL13s created 07-17/07-18). What was genuinely missing:

- **"Used by" was read-only text.** It now lists every linked exercise with a
  per-row Unlink and a `＋ Link an exercise…` search, filtered to exclude
  already-linked rows.
- **Link-on-pick was tried here and reverted the same day** — see the entry
  below.

### Type and gym filtering: proposed, then DROPPED on the owner's call

The round asked to filter the "other units" group to compatible
`equipment_type` and same `gym`. Both were rejected after the conflict was
surfaced, and the reasoning is worth keeping:

**Hiding a unit is the cause of the duplicates, not the cure.** The unit most
likely to need reaching is the one whose type is *wrong* — and hiding it leaves
only `＋ New unit…`, which is exactly the path that minted VSL13 and VSL16
twice. Filtering would have reintroduced the trap `ec7bae1` removed. Ordering
already solves the noise problem; filtering creates a failure mode. If "Other
types" ever gets long the answer is better labels or sorting **within** the
group, never hiding.

**Gym is unreliable as a filter key by direct evidence:** prod holds
`"Monroe PF"` (17) and `"MonroePF"` (2) for one physical gym, so a same-gym
filter would hide `24res` and `LifeFitnessShoulder` from everything else. Don't
build filtering on an unnormalized free-text field. If multi-gym becomes real,
the prerequisite is normalizing gym into a picked entity first.

### Linking never touches history — stated in the UI, proven in the DB

A set's lane is its `equipment_id`; link rows don't write it. Unlinking only
stops *offering* the unit for that exercise. The Used-by section says so
verbatim, next to the Unlink buttons.

Verified on throwaways (real local rows byte-identical before and after — three
checksums over `equipment`, `exercise_equipment`, `set_logs`):
- One unit linked to two exercises → both offer it; sets logged on each land in
  the **same** lane (3 sets / 3 exercises / 1 `equipment_id`).
- Unlink → link row gone, **all** sets keep their `equipment_id` and still
  resolve to the unit (the unlinked exercise's set still renders its label).
- One-tap link from the session: picking an unlinked unit created the
  association with no set logged, regrouped it under "On this exercise", and
  the subsequently logged set carried that `equipment_id`.
- Re-picking an already-linked unit is silent — no toast, no write.
- **Merge on a VSL13-shaped fixture** (two same-label units serving *different*
  exercises, each with its own sets): result is ONE unit linked to **both**
  exercises, all sets moved, source deleted, **0 orphans**, and each exercise's
  history intact inside the merged lane.

### Identity fields are read live (confirmed, not changed)

`set_logs` stores only `equipment_id` — no `label`/`gym`/`brand` snapshot — and
`/api/sessions/[id]` returns the id, with labels resolved from the live row at
render. Renaming a unit already reflects everywhere. **One nuance:**
`set_logs.equipment_type` IS snapshotted per set, so changing a unit's type does
not retro-change past sets' recorded type — correct for history, but it means
type is per-set truth while label is live truth.

---

## Link-on-log is the standing decision — link-on-pick was tried and reverted

**Reverted.** For one day, picking a unit in the session dropdown fired the
`exercise_equipment` insert immediately. It is now removed: `pickUnit` sets
local state only, and `POST /api/set-logs` is again the **single** writer of the
association (`onConflictDoNothing`).

**Why, from live use:** a native `<select>` makes an accidental selection easy —
scroll past an option on a phone and it commits — and every stray pick left a
real link to go and unlink by hand. **Picking is exploratory; logging is the
commitment.** Only actual use should create an association, because the link
list is what the picker's "On this exercise" group and the unit's Used-by are
built from; polluting it with hypotheticals makes both less trustworthy.

The evidence is in prod: two `exercise_equipment` rows with **zero** logged sets
for that pair — Hack Squat ↔ VSL03 and Hack Squat ↔ VSL04, both selectorized
units belonging to other exercises, on a plate-loaded exercise. Neither could
have been produced by logging. That is exactly the accidental-pick signature,
and it appeared within a day.

**The deliberate path is unaffected and is now the only way to link by hand:**
the equipment sheet's "Used by" section (`＋ Link an exercise…` / `Unlink`).
Deliberate linking belongs on a considered surface, not on a mid-workout
dropdown.

**Verified after the revert:** picking an unlinked unit in a session left
`exercise_equipment` byte-identical (`379d097a…`, 5 rows, before and after);
logging a set through the app then created the association — set 122 stored
`load_entered 99 + builtin_offset 15 = load 114` and inserted
`incline_bench_press ↔ press by the window`. Both the test set and the link it
created were removed afterwards; the local baseline checksum was restored.

---

## The phantom unit: a remembered machine the sets never carried

**The bug.** `StrengthCard` kept a per-exercise `fitness-app:last-machine:<id>`
in localStorage, written on every logged set with a resolved unit and read to
seed the picker. Opening an occurrence whose sets carried **no** `equipment_id`
fell through to that value, so the card displayed a machine the history did not
record. Because set rows render no per-set unit, an unattributed set was
visually identical to an attributed one — **six hand-attributions were silently
lost to it** (Seated Leg Curl 07-16, Seated Cable Rows 07-17): the owner saw the
right machine, changed nothing, and the rows stayed NULL.

**Correction to an earlier report.** A previous session's analysis claimed the
`setItem` had been "dropped in the 2026-07-17 card rebuild and only the read
survived." That was **wrong** — the write was live at the log-set handler the
whole time. The error came from grepping the string literal `last-machine`
(which only appears in the key builder) instead of the helper `lastEquipmentKey`.
The mechanism is simpler than described: the key was actively maintained, which
is exactly why it was so convincingly wrong.

**Fix — deletion.** The key builder, its write, and all three reads are gone.
The picker is now seeded ONLY by `occStoredUnit` (this occurrence's own sets);
absent that it shows unspecified. **Cost, accepted:** the picker no longer
pre-selects the last machine used for an exercise on a fresh occurrence. That
convenience is not worth a control that can assert an untrue fact about
recorded history — and a wrong pre-selection is one tap from being logged.

**Visibility, so this class of bug is checkable by eye:**
- A set with `equipment_id IS NULL` on a **context-bound** type (cable,
  selectorized, Smith, plate-loaded) renders a muted `· no unit`. Portable types
  (bodyweight, dumbbell, barbell) stay clean — there, no unit is the CORRECT
  state, and marking it would be noise on nearly every row. Marking **absence**
  rather than presence also keeps the common case quiet: 17 of 19 units are 1:1
  with an exercise, so naming the unit on every row says nothing.
  **Known gap:** legacy rows whose `equipment_type` is itself NULL (23 rows,
  all 07-14 or earlier) get no marker, because the rule keys on the snapshotted
  type and NULL is not context-bound. Inferring from the exercise's `load_type`
  would be a guess about history; left alone deliberately.
- The card chip stops over-claiming: a partially attributed occurrence reads
  `VSL14 · 2 of 5 sets` instead of a bare unit name. Fully attributed
  occurrences are unchanged.

### Attribution applied (6 rows, prod)

Seated Leg Curl 07-16 (70, 71, 72) → VSL16 `a7fc4f80…`; Seated Cable Rows 07-17
(101, 102, 103) → longpull 302 `f18af4e3…`. Both `exercise_equipment` links
already existed (no-op inserts). Orphans **75 → 69**. A checksum over `load`,
`load_entered`, `builtin_offset`, `reps`, `effort`, `side`, `rest_seconds`,
`rest_source`, `drop_set_group`, `set_type` **and `equipment_type`** was
byte-identical before and after (`b64efaa1e53e8235271bac48b2bb90b7`): only
`equipment_id` moved.

### Open issue, logged not fixed: the set-edit path writes `equipment_type`

The rule is that a set's recorded type is history — it describes what the set was
performed on, not what the unit is today. The app's edit path violates it: when
the owner hand-attributed sets via the UI, six rows had `equipment_type` written
from NULL to `selectorized` (ids 13, 14, 22, 25, 28, 31) alongside
`equipment_id`.

**CLOSED — fixed. See "equipment_type is history" below.** Original assessment
kept for context:

**Is it worth changing? Probably yes, but it is not urgent.** The values written
were *correct* (they matched the unit's type), so nothing is currently
misrecorded. The risk is narrow but real: re-pointing an old set to a unit whose
type differs from what was actually used would rewrite the historical type to
match the new unit, silently. That is the same class of error as the phantom
unit — the UI asserting a fact the history didn't contain. The fix is small
(omit `equipmentType` from the set-edit PATCH payload unless explicitly edited);
the reason to wait is that it needs its own verification pass over the edit and
re-point flows.

---

## Unfinished-session lifecycle: visible, sweepable, and loudly undeletable-free

**The bug, in one line:** `GET /api/sessions` filtered to
`finished_at IS NOT NULL`, and the sessions list is also the only place a
session can be deleted — so unfinished sessions were invisible **and therefore
undeletable**, and seven accumulated silently. The delete path itself was never
broken (the owner's `pending-session-deletes` queue was empty, proving no delete
ever failed to drain); they were simply never listed to delete.

### (a) Surface unfinished sessions that carry content

The list now returns finished sessions **plus** unfinished ones where
`sets + cardio + occurrences > 0`. Content is counted across **all three**
children, never occurrences alone: session 1 held 6 sets and 0 occurrences
(pre-occurrence-model), so an occurrence-only predicate would have hidden
exactly the row most worth reaching. They render in the page's existing
`inProgress` section, which already had the resume badge and a working ✕.

### (b) Husk sweep, server-side, 5 minutes

Zero-content unfinished sessions older than **5 minutes** are deleted on list
load. The threshold is **not a new number** — it is `sweepEmptySessions`'s
existing `maxAgeMs = 5 * 60_000`, mirrored deliberately so the two sweeps can't
drift into disagreeing about what a husk is. The age guard is the safety: a
session started moments ago is never eaten mid-entry. It's also recoverable by
construction — a device still holding the session locally re-creates the row on
its next sync. The sweep is wrapped in try/catch: housekeeping must never fail
the list.

A young husk (zero content, under 5 min) is swept by neither rule and listed by
neither — it lives in the local store, which is where the device that started it
already shows it. Correct: nothing to surface, nothing to reap.

### (c) A stuck delete queue is now visible

`deleteSession` wipes the local row immediately and queues the server DELETE, so
a delete whose request never lands leaves **no visible trace** — the same
invisible-failure class as the unlisted sessions. `pendingSessionDeletes()` is
now exported and the History page shows a banner with a Retry when the queue is
non-empty after a drain.

**Not doing: auto-finishing content-bearing sessions.** Converting a fragment
into a "real workout" on the user's behalf is its own surprise. Visible +
deletable is enough.

**Verified end to end on throwaway rows:** an unfinished session with 1 set (2 h
old) rendered and was deleted with ✕ — server row gone, confirmed in the DB; a
zero-content unfinished session (2 h old) was swept automatically; a
zero-content one (45 s old) was neither swept nor listed. A simulated failing
DELETE surfaced *"2 sessions deleted here but not yet on the server. Retry now"*,
and the banner cleared once the request succeeded.

### Cleanup applied (prod, owner-approved row by row)

Seven `workout_logs` deleted with a pre-flight guard that aborts on any drift
from the approved cascade counts. Result: **13 → 6 sessions, 200 → 188 sets,
4 → 1 cardio, 69 → 57 session_exercises, orphans 69 → 57**, zero orphaned
children, the Stairmaster cardio row (real training) intact, and the six
finished sessions' set data **checksum-identical** before and after
(`9260bd43a73d2af9234013c944281bc1`, 188 rows).

---

## `equipment_type` is history — closed: the edit path can no longer write it

The open item logged earlier is fixed. `set_logs.equipment_type` is snapshotted
at log time and records what the set was **performed on**. Writing it at log
time is correct; overwriting it on edit is not, because re-pointing a set to a
differently-typed unit would silently rewrite the record — a set genuinely
logged on a cable machine would become `selectorized` the moment it was filed
under a selectorized unit. That is manufacturing history, the same class of
error as the phantom unit.

**NULL is treated as data, not as a gap to fill.** "Not recorded" is a fact
about those 23 legacy rows. Filling it from the newly-assigned unit would be an
inference dressed as a record, so the edit path leaves NULL alone.

### What changed (four layers, so the mistake can't be re-made)

- **`StrengthCard.applyUnitToLoggedSets`** (the explicit "Move N logged sets →
  unit" re-point) — the dangerous path — no longer sends `equipmentType`.
- **`StrengthCard.relabelSessionSets`** (session-level relabel) — same. These
  sets already match the type by the filter that selects them, so re-asserting
  it could only ever overwrite.
- **`StrengthCard.applyOffsetToOccurrence`** (apply built-in offset to all sets)
  — same; it changes loads and unit identity, never the recorded type.
- **`editSet` in `sessionStore`** — `equipmentType` removed from the patch type
  entirely, so a future caller cannot pass it. The type signature is the lock.
- **`PATCH /api/set-logs/[id]`** — `equipmentType` is no longer read from the
  body. It is **ignored rather than rejected**, so an older client's payload
  still applies its `equipmentId` change instead of failing outright.
- **The update sync payload** no longer carries the field. The create payload
  still does — log-time behaviour is unchanged.

**`cardio_logs` needed no change: it has no equipment columns at all**, so the
metric-entry edit path cannot write a type by construction.

### Not reverted, deliberately

The six rows written NULL → `selectorized` before the fix (13, 14, 22, 25, 28,
31 — all 2026-07-14) are **left as they are**. The values are correct; reverting
would discard accurate information to restore an absence. Confirmed still
`selectorized` and correctly unit-attributed (VSL13 ×2, VSL04, VSL20, VSL14 ×2).

### Known display consequence, unchanged

Sets whose `equipment_type` is NULL get no `· no unit` marker, because the
marker keys on context-bound types and NULL is not one. Inferring the type from
the exercise's `load_type` to force a marker would be the same inference this
decision rejects.

### Proof

Three lock tests (202 total, +3): re-pointing a `cable` set to a selectorized
unit keeps `cable`; a NULL-typed set stays NULL; the PATCH sync payload has no
`equipmentType` key. Proven end-to-end at the API too — PATCHing two throwaway
sets (one `cable`, one NULL) onto a selectorized unit **while deliberately
sending `"equipmentType":"selectorized"` in the body** returned 200 and left both
types untouched (`cable` stayed `cable`, NULL stayed NULL) with only
`equipment_id` moved.

---

## Equipment P4 — stack geometry, gym as a dropdown, dead columns dropped

### Migration 0028 (written by hand)

`drizzle-kit generate` needs a TTY to resolve a drop+add as "is this a rename?",
so the SQL is hand-written — the safer choice for a destructive drop anyway,
since the intent is explicit rather than inferred.

**Added** (nullable, canonical lb, no backfill): `plate_increment`,
`add_on_weight`, `stack_max`. **Dropped**: `counterweight_lb`, `cam_profile` —
both declared in `schema.ts`, referenced by no read, no write and no UI, and
NULL on every prod row (re-verified immediately before the gate).

An **assist is now expressed as a negative `built_in_weight`** rather than a
separate counterweight column: same additive math, one field the engine already
reads, no second concept to keep in sync.

### The Load / Stack split is the point

`built_in_weight` is the ONE unit field that enters a logged number. The three
new fields describe what the machine can **select** and never enter a load.
Putting them in one "load math" group invited exactly the error that would hurt
most — typing the plate size into the field that gets added to every set. They
are now separate groups with the distinction stated in each hint.

### Pulley is scoped to cables

It renders only for `equipment_type = "cable"`. On a lever machine a pulley
ratio isn't a capability being withheld, it's a category error. Stored values on
non-cable units are left untouched — hidden, not cleared, since deleting data to
match a display rule would be the tail wagging the dog.

### Plate-increment suggestion: a lower bound, offered not applied

With >=3 distinct logged loads, the form offers the **GCD** of them. The GCD is a
lower bound on the true plate size, not a measurement: loads of 100/150 give 50,
correct as a divisor and wrong as a plate. A 10 lb stack with a 5 lb add-on
correctly yields 5 — the finest real step. It stays a one-tap suggestion the user
accepts or overrides, and it is stated in the ACTIVE unit (a "10 lb" hint beside
kg fields reads as a contradiction). Silent below 3 distinct loads, on
fractional loads, or when the GCD collapses to 1.

### Gym is a dropdown (no schema)

Free text is why one gym became "Monroe PF" x17 and "MonroePF" x2 — and a
hand-created unit reintroduced the split AFTER the owner normalised it, which is
the proof it is a UI problem, not a data problem. The field is now a dropdown of
existing distinct values plus "Add new gym..." (free text, for genuinely new
gyms), in BOTH surfaces via the shared form. Still the same text column: no
normalisation table, no schema change. A unit whose stored gym is not in the
known list opens in free-text mode so nothing is silently coerced to a
neighbouring spelling.

**Multi-gym per unit stays out of scope**: a unit is one physical machine, and
letting it span gyms would merge two machines into one lane.

## The snapshot asymmetry, stated deliberately

Three unit-adjacent facts behave differently on purpose. The rule is **what kind
of claim the field makes**, not which table it lives in:

| field | behaviour | why |
|---|---|---|
| `set_logs.equipment_type` | **snapshotted** — a unit's type change never alters past sets | It records what the set was PERFORMED on. A set logged on a cable machine was logged on a cable machine, whatever the unit is reclassified as later. |
| `label` / `gym` / `brand` | **read live** — renames show retroactively everywhere | They name a thing that still exists. No "what it was called then" claim is being made; a rename fixes the name, not the history. |
| `built_in_weight` | **corrects backward, on explicit confirmation** | The carriage has always weighed what it weighs. A wrong value is a RECORDING ERROR, and every affected row was always the corrected number. Fixing it is fixing a measurement, not rewriting history. |

This is why the forward-only rule for field configs does NOT extend here: there,
the shape of what was logged genuinely changed; here, the machine did not.

## §4 retroactive built-in correction — DEFERRED, not built

Scoped honestly and stopped, per the round's own instruction to ship §1-§3
rather than half-verify a history rewrite. What it needs that is not built: a
preview endpoint (affected count, date range, before->after loads), a
transactional confirm, the separately-defaulted-off NULL-offset option, the
progression-baseline warning, cancel-writes-nothing proof, and arithmetic locks.

**Prod scope when it is built** (read-only, at deferral): 21 offset-bearing rows
across three units — 24res 9 (07-14 -> 07-25), VPL-SMBP 6, HackSquatMonroePF 6.
ZERO rows on a built-in-bearing unit lack an offset, so the NULL-offset opt-in
would currently affect nothing.

**A live case already exists:** 24res's 07-14 rows carry `builtin_offset = 25`
while the unit records `built_in_weight = 24` — the orphan attribution (P3)
moved those rows onto the unit, and they kept the offset applied at log time.
That is precisely the disagreement §4 resolves.

`cardio_logs` has no `equipment_id` and is out of scope by construction.

---

## Stack marking is a tri-state, and a recorded one governs logging

### NULL means NOT RECORDED, not lb

`equipment.stack_unit` was first written as "NULL = lb, the canonical default".
That was wrong in the same way the phantom unit was wrong: it asserts something
the user never said. All 18 units read NULL because nothing has been recorded,
not because anyone confirmed lb — and silently pinning them to lb would
reproduce the kg-slip error in the opposite direction on a genuinely kg-marked
machine.

Adopted instead, matching the absence rule already used by `target_sets`,
`log_fields` and `built_in_weight`:

- `'lb'` / `'kg'` — **recorded**: a statement about how this machine's stack is
  stamped.
- `NULL` — **not recorded**: falls back to the global weight preference, exactly
  as before markings existed.

No migration change (still nullable text) — only the meaning, and one resolver
(`resolveWeightUnit(marking, preference)`) so the rule exists once.

### Where the marking wins, and where it doesn't

| field | governed by | why |
|---|---|---|
| Plate size / Add-on lever / Max load | the **marking** when recorded | They describe the machine's own grid; the plates are stamped in one unit. |
| The selectable-loads preview | the **marking** | It's a rendering of those same fields. |
| **Built-in weight** | always the **global preference** | It's a LOAD, not a marking — the same kind of number as a logged set. |
| The logging load box | the **marking** when recorded, else preference | See below. |

### Marking governs the logging input — a structural fix, not a warning

A machine that records its markings pins the weight box when you log on it. The
number on the pin is a fact about the machine, so typing `120` at an lb-marked
stack stores 120 — the 264.55 error (120 kg read as the lb stack number) is
**impossible there by construction**. Warnings are the wrong tool for this: they
fire mid-set, which is exactly when they get dismissed.

Fallbacks are unchanged: an unrecorded marking, a portable type (dumbbell,
barbell, bodyweight), or no unit at all all follow the global preference.

**Done at the input boundary only**, as required — the card's state machine
(lanes, offsets, timer, drop groups, swap) is untouched. Concretely: one derived
`entryUnit`, used by the single existing conversion (`canonicalLoad`) and the
box's label. The one added effect clears the field when the effective unit
changes, which is the SAME convention the manual unit toggle already used
(`setLoad(0)`), guarded to fire only on a genuine change rather than on first
resolution.

**A pinned label is not a control.** Where the global toggle renders an
accent-coloured, dotted-underlined button, a marked machine renders muted text
reading `lb · marked` — because it states a fact rather than offering a choice,
and tapping it must not imply you can change what the stack is stamped in.

**Verified with the global preference set to kg:** picking an lb-marked unit
flipped the box from `kg` to `lb · marked`; typing 120 stored **120**; a
portable exercise in the same session still read `kg`; and the equipment
checksum was byte-identical across every flip (`f054ba1d…`), so no display or
resolution path writes.

### Two form corrections

- **The increment suggestion withdraws once answered.** It stays hidden while
  Plate size has a value and returns if cleared — a suggestion lingering beside
  a filled field reads as a correction rather than an offer.
- **The gym placeholder row is gone entirely.** Not merely disabled: the field
  label already says what it is, so prompt text in the list was redundant. An
  unset gym renders blank via a `hidden` empty option, and the list contains
  only real gyms plus "Add new gym…". *(Correction to an earlier claim: the old
  placeholder could never have been SAVED as the literal string "gym…" — its
  value was `""`, which the PATCH route maps to NULL. The real fault was milder:
  it read as a choice, and picking it silently cleared the gym.)*

The **Type** placeholder is deliberately left selectable — blank is a legitimate
state there, and disabling it would remove the ability to clear a type.

---

## One machine, one unit — the marking governs every weight on it

`built_in_weight` now resolves through the same `resolveWeightUnit(marking,
preference)` path as the stack fields. Previously the Stack group honoured a
machine's marking while Built-in followed the global preference, so a kg-marked
machine rendered **two units on one form describing one machine** — precisely
the mixed-unit confusion the marking exists to remove. A carriage weight is
known in whatever unit the placard or spec sheet uses, which is the unit the
stack is stamped in.

Recorded `'lb'`/`'kg'` wins; NULL (not recorded) falls back to the preference,
unchanged. Storage stays canonical lb — entry and display only.

### Derived surfaces swept, not just the form

The rule is worth nothing if the numbers it produces are rendered elsewhere in a
different unit, so every weight the card shows for the selected machine now uses
the resolved unit: the logged-row breakdown (`74.9 kg × 8 · 49.9 + 25
built-in`), the "last" reference line, the recalibration note, the total-load
preview, the progression suggestion, the drop-set entry, the per-set built-in
offset input, and the apply-to-all chips. The equipment list's built-in badge
resolves **per row**, so a kg-marked machine reads `+25 kg` in a list where its
neighbours read lb.

**This needed no state-machine changes.** Every one of those was a display or
entry-boundary usage of `wUnit`; swapping them to the derived `entryUnit` left
lanes, offsets, timer, drop groups and swap untouched.

### Framing

The setting governs every weight on the unit, so it is no longer "the stack
unit" in the UI — it reads **"Weights marked in"**, and its hint says it covers
the plates *and* the carriage or starting resistance. **The column name stays
`stack_unit`**: a rename would cost a migration and a coordinated
expand/contract deploy to change nothing but a string, which is not free.

### Built-in scoped by type — gently

Built-in is nonzero only on plate-loaded and Smith across all 18 prod units, but
it is genuinely possible elsewhere, so it is scoped more loosely than the stack
fields:

- **Visible** on every loaded type — plate_loaded, smith, selectorized, cable.
  It is deliberately NOT hidden on selectorized: some stacks have a starting
  resistance, and an **assisted machine records its assist as a negative
  built-in** — the capability we relied on when dropping `counterweight_lb`.
  Hiding it there would quietly remove the replacement for a column we deleted.
- **Hidden** on portable types (bodyweight, dumbbell, free weight), where the
  number you log IS the weight and a per-unit carriage is meaningless.
- Hidden values are hidden, never cleared — same rule as pulley and the stack
  fields. Proven: a portable unit carrying a stored built-in of 33 was saved
  with the field hidden and kept its 33.

The hint is type-aware, because the field means different things: on
plate-loaded/Smith it is *the weight of the empty carriage or bar*; on
selectorized/cable it is *usually 0 — set it only if this machine has a starting
resistance*, with the assist framed as a negative value.

### Proof

With the global preference on **lb**, a kg-marked plate-loaded machine rendered
Built-in and Plate size **both in kg** (`25` / `20` from stored `55.12` / `44.09`
lb) with a muted `· marked` tag; its list badge read `+25 KG BUILT-IN` while
neighbours read lb; and its session card read `last 74.9 kg × 8`, `74.9 kg × 8 ·
49.9 + 25 built-in`, `KG · MARKED`. Three unmarked cards in the same session
still read `lb` / `added lb`. The equipment checksum was byte-identical across
every sheet open, preference flip and save (`aa8a7a25…`) — no resolution path
writes.

---

## The marking control sits above what it governs; sheets keyed by unit id

### Layout

"Weights marked in" governs BOTH the Load group (built-in) and the Stack group,
but it was rendered inside Stack — below one of the two fields it controls. A
control that decides the unit of two sections cannot live inside one of them.

It now sits directly after **Type**, above both groups: both state facts about
the machine rather than preferences of the user, and everything the setting
affects is beneath it. Kept as a compact row rather than a section header — it
is one field. Its hint names both scopes explicitly ("the carriage or starting
resistance below, and its plates"). Groups themselves are unchanged.

### The stale-sheet question: a harness artifact, fixed structurally anyway

**Can a real user see a previous unit's values? No.** The sheet's backdrop is
`position: fixed; inset: 0; z-index: 70`, portaled to `document.body`, with
`onClick={onClose}`. Every real tap either lands on the panel (stopped) or on
the backdrop (closes and UNMOUNTS). So `openId` cannot go A→B while mounted by
pointer input, and the sheet always remounts with a fresh draft.

Proven with three sequential opens and **zero reloads**: ZZ AAA (lb, 11/10),
ZZ BBB (kg, 10/9.1), ZZ CCC (not recorded, 33/45) — each its own data,
`sheetCount: 1` throughout, never stacked.

**The earlier misreads were the test harness, and the mechanism is worth
recording.** A synthetic `element.click()` dispatches straight to that node with
no hit-testing, so it reaches a row painted *underneath* the backdrop — which a
finger cannot. Reproduced deliberately: clicking row B's node while A was open
produced the title "ZZ BBB" with A's values (11/10), and
`document.elementFromPoint` at those coordinates returned the sheet panel, not
the row.

**Fixed structurally regardless.** The draft is a `useState` INITIALIZER, so it
only reads `unit` on mount; the guarantee therefore rested entirely on an
overlay's geometry. `<EquipmentSheet key={open.id} …>` makes a different unit a
different component instance, so the leak is impossible by construction rather
than by layout. After the key, the same pathological A→B→C sequence of direct
clicks — no closes, no reloads — showed 11/10, then 10/9.1, then 33/45.

Cheap insurance with no behavioural change on the normal path, and it removes a
class of bug rather than one instance.

---

## Retroactive built-in correction (P4 §4, deferred and now built)

### Why this reaches backward when field-config changes don't

A machine's carriage has always weighed what it weighs. A wrong
`built_in_weight` is a **recording error**, and every affected row was always
the corrected number — so correcting it is fixing a measurement, not rewriting
history. A field-config change is genuinely different: there the *shape* of what
was logged changed, which is why that stays forward-only.

### One mechanism, not two

The round scoped §1 (offer correction when built-in changes) and §2 (surface a
pre-existing disagreement) as separate flows. They collapse into one:
**always-on, read-only detection plus an explicit align action.**

Detection has to be always-on anyway, because the case that motivated this
PRE-DATES any change — the 07-14 Leverage Incline sets were logged against the
plate-loaded type default before the unit existed, then attributed to 24res by
the orphan pass. No change event would ever have fired. And editing a built-in
simply *creates* a disagreement, which the same detector then surfaces. So §1
falls out of §2 rather than needing its own trigger, and both directions are
reachable: fix the rows to match the unit, or fix the unit and then the rows.

### Semantics

- **Scope**: `set_logs` rows with this `equipment_id`. Rows with a non-NULL
  `builtin_offset` are re-based; rows without one are a **separate,
  defaulted-off opt-in**, because giving them an offset asserts you were always
  lifting more than recorded — a different claim from correcting one that
  already exists.
- **`load_entered` is never rewritten.** It is what you physically put on the
  machine; no correction to the carriage changes it. The invariant
  `load = load_entered + builtin_offset` is maintained throughout.
- The arithmetic is `offsetPatch`, **shared with the session card**, so the two
  cannot drift. Correcting to 0 clears the offset rather than storing a zero; a
  negative built-in (an assist) reduces the effective load.
- Rows already at the target are **not** rewritten — a no-op is not a change.
- Applied in **one transaction**: a half-applied correction would leave the
  invariant broken across the unit's history.
- The preview renders in the machine's **marked unit** via the same
  `resolveWeightUnit` path as the form, list badge, session card and load input
  — a confirm dialog in a different unit would be the one place on that machine
  speaking another language.
- **`cardio_logs` has no `equipment_id`** and is out of scope by construction.
- The preview warns that this unit's "last ..." references and progression
  suggestions will shift.

### Proven on throwaways; real rows untouched

A fixture mirroring 24res (unit records 24; three rows at 25, three at 24, two
with no offset):

- **Preview** — 3 changes `125 -> 124`, 3 flagged already-correct, dates exact,
  and it **wrote nothing**.
- **Confirm** — stored rows matched the preview byte-for-byte
  (`124 / 100 / 24`); `reps`, `set_type`, `effort`, `side`, `rest_seconds`,
  `rest_source`, `drop_set_group`, `equipment_type`, `equipment_id` checksum
  **identical** (`31235c69...`); invariant violations **0**; row count unchanged;
  zero orphans.
- **Cancel** — loads checksum identical (`071d44c5...`), zero writes.
- **NULL-offset opt-in** — left off, changed **0** such rows; turned on, changed
  exactly those two (`90 -> 114`, `95 -> 119`) and nothing else.
- **Detection** — surfaced `25` vs `24` with count 3; a consistent unit surfaces
  nothing; absence (NULL offset, or no recorded built-in) is never reported as
  disagreement.

### Prod state at ship: nothing to correct

Re-derived read-only: **zero disagreements**, zero NULL-offset rows on
built-in-bearing units, and zero invariant violations across all 215 sets. The
24res rows now read `124 = 100 + 24` — the owner corrected them by hand between
rounds, which is exactly what Align would have produced. The three
built-in-bearing units (24res 9 rows, VPL-SMBP 6, HackSquatMonroePF 6) are all
internally consistent, so the sheet shows the reassurance state rather than a
warning. The feature ships with no work waiting on real data.

---

## Unit-slip guard, narrowed to what markings don't already cover

Machine markings made the original slip structurally impossible whenever a
marked unit is selected — the input is pinned to the machine. This round covers
only the remaining exposure, and deliberately drops most of the original scope.

### Confirm before switching the global preference

Switching weight or distance units now asks first, inline (never a modal — this
sits mid-workout). The copy states what changes and what doesn't: entry and
display where the preference still governs, storage always canonical, nothing
already logged moves. One shared `EntryUnitLabel` serves the strength card and
both cardio inputs, so the three sites cannot diverge.

### A non-canonical preference is loud where it governs

The unit label was easy to miss, which is how the original slip happened. When
the global preference is not lb/mi AND it is the thing governing that input, the
label is a tinted warning-toned pill with a dot. A marked machine keeps its
muted `· marked` tag. **The two are deliberately unlike**: one is a MODE the
user is in, the other a FACT about a machine, and things that mean different
things must not look alike.

### Slip detection — one high-precision check, skipped where it can't apply

**Skipped entirely on a marked unit.** The box is pinned there; a warning would
be noise about an impossible failure.

Elsewhere the signal is: **the raw number matches history while the converted
number does not.** That is the exact shape of a slip — you typed the number you
always type, in the wrong unit. It is silent for honest kg entry (converted
matches history), for a genuine PR (raw nowhere near history), and where there
is no history at all.

Thresholds: raw within 15% of the recent load, converted at least 40% away.
Verified quiet across **all 18 real unit ranges** (50–340 lb) for honest kg
entry, and firing for the slip at every one of them.

**`MIN_HISTORY = 1`, and the reason matters:** the "last" reference is one
working weight with several rep counts (`120 lb × 12, 11, 10`), so requiring two
distinct loads silenced the check on essentially every real exercise — caught in
the browser, not by the unit tests, which had been feeding it multi-load
fixtures that never occur. One recent load is the right reference, and the
two-sided test keeps a lone data point from over-firing.

Advisory only — one tap to proceed, never blocks a log. `Use 120 lb` switches the
preference back and **keeps the typed number**; being in the wrong mode is the
fault, and the number was already right.

**Bug found and fixed during verification:** that fix action initially cleared
the box to 0, because the entry-unit-change effect (which clears the field, by
the same convention the manual toggle uses) fired on the switch and defeated the
whole point. A one-shot ref now lets the typed value survive precisely that
transition.

### Deliberately NOT built

The general large-jump warning (>=1.75x / <=0.6x). That is where false positives
live — a real PR or a first heavy session trips it — and with the exposure now
this narrow it would be pure nagging. A warning that gets learned-and-dismissed
is worse than none.

### §0 markings audit (read-only, at time of writing)

17 of 18 units marked `lb`; **zero marked `kg`** (the reverse-direction hazard);
one still unrecorded — `longpull 302` (cable, Precor, 6 sets at 120–130 lb).
Every lb marking is corroborated by its logged range: 50–340 lb across the
estate, all consistent with US stacks. Nothing looks mismarked.

---

## Two units, two owners — and Settings gets a home

### The rule

| | what it is | owned by | governs |
|---|---|---|---|
| **Entry unit** | a fact about the MACHINE — what you type. The pin says 120, you type 120. | the unit's `stack_unit` marking | that machine's inputs and its card |
| **Display preference** | a fact about YOU — what you read and think in. | global, in Settings | history, stats, totals, and anything not tied to a machine |

One toggle in the exercise card used to do both, which is why changing it
mid-session had the wrong blast radius: it looked local and behaved global. One
tap silently re-interpreted every number typed afterwards.

### Settings behind a gear; the More tab is gone

There was no settings surface and the More tab was empty. It is **deleted**
rather than filled — the route, the nav entry, and the page. A gear in Home's
header pushes `/settings`, which holds one PREFERENCES section with exactly two
rows (Weight, Distance) as segmented controls, unit values in the mono face
because they are data. The app version moved here from More.

**Navigation rationale (roadmap decision):** bottom-nav slots are for
**frequent, direct destinations**. Settings is infrastructure and doesn't earn
one. Consequences, recorded so they aren't re-litigated:

- The freed fourth slot is held for **Nutrition** when it ships.
- **Recovery / Oura data belongs as a Home card, not a tab** — it is glanceable,
  not navigable.
- The **"More" overflow pattern is rejected**. If a fifth domain ever appears,
  consolidate related ones rather than introducing a two-tier hierarchy; an
  overflow bucket is where IA goes to rot, which is exactly what the old More
  tab demonstrated.

### Preference inventory (asked for; nothing else moved)

Every `localStorage` key in the app, audited:

| key | kind | belongs in Settings? |
|---|---|---|
| `entry-unit-weight`, `entry-unit-distance` | global preference | **yes — moved this round** |
| `fitness-app:hint-set-tap` | one-time dismissed hint | no — never returns once dismissed |
| `fitness-app:last-equiptype:<exerciseId>` | per-exercise memory | no |
| `fitness-app:offset-ok:<exerciseId>:<type>` | per-pair confirmation | no |
| `fitness-app:pending-session-deletes` | sync queue | no |

**There are no rest-timer defaults** or any other global preference. The two
unit prefs were the whole set, so nothing was left behind.

### The indicator is read-only; one sanctioned exception

The unit label on an input now only *states* which unit is in play — muted
`lb · marked` for a machine's fact, a tinted pill for a non-canonical mode
you're in, quiet otherwise. None is tappable.

The **confirm-on-switch from last round is removed**, and this is the reasoning:
it existed because a global setting sat under a stray-tappable control in a
session. Moving the setting to Settings fixes the cause; a confirmation on a
screen you navigated to deliberately would be friction protecting against a
mistake that can no longer happen.

**The one exception** is the slip advisory's `Use 120 lb · switch to lb`. Being
in the wrong mode IS the fault there, so leaving it is the fix — and unlike the
old label toggle it is an explicitly labelled correction that says what it does.

### Dual display, only on a real mismatch

Where a machine's marking differs from the display preference, the card shows
the machine's unit primary and yours in parentheses — `70.3 kg (155 lb) × 9` —
on the "last" reference and the logged rows. You need the kg to set the pin and
the lb to know how strong you are.

Where they agree (all 18 current units) it is a **single value; the parenthetical
never appears**, or every ordinary row would carry redundant noise. Unrecorded
machines are already shown in the preference, so they get no second value
either. Aggregate surfaces — history, stats, totals — stay in the preference
only: a dual there would be noise in a place with no pin to set.

The input itself stays single-unit, the machine's marking. You type what the pin
says.

### Known gap: distance has no per-machine marking

`cardio_logs` has **no `equipment_id`**, so a metric entry cannot be attributed
to a machine and a treadmill marked in km cannot be expressed. A European
treadmill still requires switching the global distance preference in Settings.

This is deliberate, not an oversight: giving cardio an equipment link is a
schema change with real consequences (a lane model for metric entries, which the
core does not read), and the payoff is one traveller's edge case. Recorded so
the gap is a decision rather than a surprise.

---

## 2026-07-26 — Settings: "Your data" (export). "About you" gated on schema.

### §1 "About you" — GATED. There *is* a profile table; it's dead schema.

The mandatory "check first" found a `profile` table declared in `schema.ts`
(singleton `id serial` PK) with `dob`, `sex`, `height_in`, `goal_mode`,
`training_age`, `available_days`, `equipment_profile`, `activity_seed`,
`protein_target_g`, `preferences`. It exists in prod. It has **0 rows**, and a
grep across `src/` returns **no read and no write of it** anywhere in the
application — every `profile` hit is an unrelated word (log-field profiles,
muscle-emphasis profiles, `equipmentProfile`). It is inert schema left from the
spec's original shape.

Two things stop it holding an "About you" form as-is:

1. **No bodyweight column.** `body_metrics` (`date`, `weight`, `measurements`)
   exists for that and is likewise unused — 0 rows, 0 references.
2. **`dob`, `sex`, `height_in` are NOT NULL with no defaults**, so a partially
   filled form cannot be saved. The absence rule this schema runs on (NULL = not
   recorded) is violated by the table meant to hold the most optional data in
   the app.

So §1 needs a migration and is **paused for the owner** rather than built.
Nothing was written. Section order on Settings will be PREFERENCES → ABOUT YOU →
YOUR DATA; a comment marks the insertion point in `settings/page.tsx`.

### §2 Export — built

`GET /api/export` (JSON) and `GET /api/export?format=csv` (`set_logs`,
denormalized). Auth via the existing proxy matcher; a stale session gets 401,
not a snapshot. Strictly SELECTs — no writes, no server-side storage of exports.

**The full exercise library ships (877 rows), not just the 2 customs.**
`set_logs.exercise_id` and `program_exercises.exercise_id` are foreign keys into
`exercises`; an export holding only customs would need the seed re-run at
exactly the right version to resolve the other 26 exercises in history, and any
drift there orphans logged sets — the one thing this project never allows.
~940 KB of prod JSON is a cheap price for a file that stands alone.

**20 of 21 tables are included**, listed explicitly in `TABLES` rather than
derived from the schema module — a new table should have to be consciously
added, not silently swept in or silently missed. The five declared-but-unwritten
tables (`injury_flags`, `recovery_metrics`, `nutrition_entries`,
`progress_photos`, `form_checks`) are included empty: an export that quietly
skipped tables would be lying about being complete.

Only `login_attempts` is excluded (rate-limit telemetry containing IPs, not
training data) plus drizzle's migration bookkeeping. **The exclusions ship
inside the file** in an `excluded` key with reasons, so the omission is visible
to whoever opens it.

The file also carries `counts` (self-verification without re-querying), `units`
(canonical lb/mi/min/s — a number in there is meaningless without them), and
`app.migrationsApplied`, so a future restore knows which schema the rows came
from.

**`device`** is merged in client-side: the localStorage keys the server cannot
see (`entry-unit-*`, `fitness-app:*`). Captured by PREFIX, not an enumerated
list — which is how it picked up stale `fitness-app:last-machine:*` keys from a
build that no longer writes them. A backup should record what is there, not what
the code believes should be there.

### Restore sufficiency — honest answer

The JSON is sufficient to rebuild the database, with two known gaps, both
inherent rather than fixable by adding a table:

1. **Unsynced local sets.** The export reads the server. Anything still in the
   IndexedDB outbox is not in it. Sync first, then export.
2. **Serial sequences.** Row ids are exported; `setval` for each sequence is
   not. A restore must reset sequences or the first insert collides.

Everything else — history, program, equipment, the exercise graph, per-device
preferences — round-trips.

### CSV

One table (`set_logs`), denormalized: ids resolved to exercise/machine names,
ordered by session date. NULL is written as an **empty field**, never `0` or
`"null"` — the absence semantics only survive the round trip if blank stays
blank. RFC 4180 escaping with CRLF terminators; `csvField`/`toCsv` are pure and
tested (12 tests).

---

## 2026-07-27 — Export corrections: true finish time, sessions CSV, husk predicate

### Progression IS consuming effort (answering the §5 question first)

`set_logs.rir` being 0/215 is expected and correct, not a gap. The adapter
derives RIR from the `effort` enum — [`coreAdapters.ts`](../src/lib/coreAdapters.ts)
calls `normalizedRir(r.effort, r.rir)`, which prefers an explicit `rir` and
otherwise maps the tag (`to_failure` → 0, `near_failure` → 1, `more_in_me` → 3).
`rir` is the escape hatch for an exact number the UI never asks for.

What IS partial: **52 of 215 sets carry an effort tag** (27 near_failure,
14 to_failure, 11 more_in_me); the other 163 reach the core as `rir: null`.
So progression receives effort on about a quarter of sets — the plumbing works,
the input is sparse. That's a logging-habit question, not a code defect.

### §1 `finished_at` is a last-modified stamp, not a finish time

Four of seven finished sessions had `finished_at` diverged from
`first_finished_at`; log 3 read 2026-07-25T07:54 for a session that ended
2026-07-14T22:30 — eleven days late.

The CSV now exports `session_ended_at` (coalesce of `first_finished_at`,
`finished_at`) and keeps the re-stampable value as `session_last_updated_at`,
labelled for what it is. History and Home already read `firstFinishedAt`;
`FinishSheet`'s "Previously finished at …" was the single remaining surface
showing the rewritten value and now shows the stable one.

**Rename proposal (NOT taken):** `finished_at` → `last_finished_at` would be a
pure-rename migration touching four insert sites, the sync payloads, the local
IndexedDB shape and the `ServerSession` interface — for zero behaviour change.
The column is now labelled honestly at every read; that is enough. Recorded in
SPEC-DRIFT instead.

### §3 Content means LOGGED, not planned

Predicate changed from `sets + cardio + occurrences > 0` to `sets + cardio > 0`
in all three places that must agree: the server list filter, the server sweep
([`api/sessions/route.ts`](../src/app/api/sessions/route.ts)) and the local
`discardSessionIfEmpty`. Adding an exercise states an intention; only a logged
set states a fact. Log 48 survived five hours on one occurrence and zero sets.

**The accepted cost:** staging a session and navigating away now discards it.
An unlogged plan is cheap to rebuild; an invisible husk is not, because the
list is the only place a session can be deleted.

Both directions are locked by tests: an occurrence-only session is now a husk,
and a session with sets and NO occurrences (the pre-occurrence-model shape)
still counts as content and is never swept.

### Two bugs found while building the sessions CSV — worth remembering

1. **Interpolating drizzle columns into a raw `sql` subquery drops the
   qualification.** `${setLogs.workoutLogId} = ${workoutLogs.id}` renders as
   `"workout_log_id" = "id"`; both bind to the INNER table, and every count
   comes back **0 with no error**. Spell correlations out literally
   (`c.workout_log_id = workout_logs.id`). Caught only by diffing against psql.
2. **`created_at` is `timestamp WITHOUT time zone`.** It was written by `now()`
   under the database's `TimeZone`, so it must be read back under
   `current_setting('TimeZone')` — prod is GMT, the local dev DB is
   America/New_York. Hardcoding `'UTC'` was wrong by four hours locally.
   A raw `sql` expression also carries no column decoder, so timestamps must be
   formatted to strict ISO in SQL rather than handed back as values.

**Known, unfixed, and reported:** the JSON export's tz-less `created_at` columns
are parsed by node-postgres in the RUNNING PROCESS's timezone. Correct on Vercel
(UTC), shifted when run locally. A global `setTypeParser(1114, …)` in
`db/client.ts` would fix it everywhere but changes every query in the app —
too broad to slip in unrequested.

---

## 2026-07-27 (later) — Occurrence → program day, with the cascade proved first

### §0 The FK proof, and a correction to my own claim

`session_exercises.program_day_id` is the first foreign key from logged history
into plan rows, so `ON DELETE SET NULL` was proved before the migration shipped,
on a throwaway inside a rolled-back transaction: a day with 3 occurrences and 12
logged sets, then `DELETE FROM program_days`.

**Result: day deleted, 3/3 occurrences survived with `program_day_id` NULL,
12/12 sets survived, volume checksum 13500 unchanged.**

The counterfactual — the same delete with CASCADE — **corrected a claim I had
made**. I said the sets would follow their occurrences. They do not:
`set_logs.session_exercise_id` is itself `ON DELETE SET NULL` and the sets keep
`workout_log_id`, so the volume checksum held at 13500 there too. What CASCADE
actually destroyed was all 3 occurrence rows — the session's ordered exercise
list, its per-occurrence `completed` flags, and every set's link to the
occurrence it belongs to.

So the real cost of a stray CASCADE is a session gutted into a loose bag of
sets, triggered by an ordinary tidy-up in the program editor. Still decisive for
SET NULL; just not the mechanism I claimed. The reason is written into the
migration SQL and `schema.ts` so nobody "tidies" it later.

### The migration had to be split, against the request to bundle

The `rom_note` drop could NOT ride along with the `program_day_id` add. Drizzle
expands `db.select().from(setLogs)` into an explicit column list, so between
`migrate` and `deploy` the LIVE build still names `rom_note` — dropping it first
500s every set read. The add has the opposite constraint (the new build needs
it). Expand and contract cannot share a migration; this is the same 0028/0029
split as the equipment columns.

**0031 (this round, expand):** add `program_day_id`. **0032 (queued, contract):**
drop `rom_note`, to run only after this build is live. All `rom_note` code
references are already removed, so the deploy is drop-ready.

### §5 The finish-time editor is NOT broken — the premise didn't hold

Traced end to end and checked against git history. `SessionHeader.save()` has
computed `new Date(y, m - 1, d, hh, mm).toISOString()` — correct local wall clock
→ UTC — since the editor was introduced (`dc690ea`), unchanged through the
redesign (`b813e30`). Display is `toLocaleTimeString()`. The server PATCH parses
an ISO-Z string. There is no point in the chain that treats an entered local
time as UTC.

Log 3 holds `2026-07-14T22:30:00.000Z`, which is **exactly what an entered
6:30 PM produces** in America/New_York. An entered 10:30 PM would have stored
`2026-07-15T02:30:00Z`. The `.000` milliseconds confirm a typed value rather
than a system stamp. What looked like "22:30 stored as UTC" was a UTC instant in
the export being read as a local wall clock.

The value is still wrong — it precedes the session's own first set by 31 minutes
— but the cause is a typo, not a conversion.

**Secondary finding, genuinely misleading:** `first_finished_source = 'user'`
does not prove the TIME was user-entered. The PATCH route stamps `'user'` when
only the DATE is edited (`route.ts`: `if (updates.date !== undefined && …)`).
Provenance on that column means "a user edited this row", not "a user set this
instant".

### Guards built instead

An end before a start is impossible, so it is now rejected in both places:
the editor (inline warning, sheet stays open on the value) and the PATCH route
(400 with `startedAt`/`given`). The sessions CSV gains an `ends_before_starts`
column so a negative `duration_min` cannot be scrolled past.

Both guards read `created_at` through
`at time zone current_setting('TimeZone')`. The first version compared against
the raw column and was four hours looser on a non-UTC host — it accepted
`2026-07-11T22:00Z` for a session that started `2026-07-12T00:01:50Z`. Verified
fixed by re-testing that exact window.

### §6 Export timezone fix, scoped to the route

`utcSafeShape()` builds a select in which every tz-less timestamp column is
rendered to strict ISO-8601 Z **by Postgres**, derived from drizzle's own column
metadata (`columnType === "PgTimestamp" && withTimezone === false`) rather than
a hand-listed set of columns.

Verified locally, where host and database disagree: `workout_logs#18.created_at`
is stored naive as `2026-07-11 20:01:50.125` under a America/New_York database,
and the export now emits `2026-07-12T00:01:50.125Z` — the true instant, matching
psql. It previously emitted `2026-07-11T20:01:50.125Z`.

The global `setTypeParser(1114, …)` fix is deliberately NOT taken; see
SPEC-DRIFT.

### §5 set notes / rom_note

Set-level `notes` are exposed in the set-edit sheet only — never mid-set. An
empty or whitespace-only box stores NULL, not `""`, so "no note" stays one state
rather than two. Verified round-trip through the PATCH route.

### Backfill provenance (paused, previews generated read-only)

Occurrence → program_day mapping is unambiguous: **zero occurrences match more
than one day**, 64 of 65 map, the 1 remaining is genuinely "Ad-hoc" and stays
NULL. (65, not the 66 previously reported — log 48's occurrence went with the
husk sweep.)

The 23 `logged_at` rows are ids 7–29 inclusive, all in log 3, receiving values
between `2026-07-14T23:01:31.206Z` and `2026-07-14T23:58:40.667Z`. 192 rows must
not move; volume checksum 236416 must not change.

---

## 2026-07-27 (final) — Backfills run, 0032, drop-set snapshot, derived program

### The three backfills — committed to prod

Run as a two-pass script: the whole sequence executed once inside a transaction
that was rolled back regardless of outcome, asserted, and only then repeated for
real. Any failed assertion aborts before the real pass is attempted.

| | wrote | proof |
|---|---|---|
| A · occurrence → `program_day_id` | 64 | 1 ad-hoc stays NULL |
| B · `logged_at = created_at` | 23 | ids **7–29 inclusive**, all in log 3 |
| C · log 3 `first_finished_at` | 1 | `2026-07-14T23:58:41Z`, pinned to its last set |

**Provenance for B (the whole point of recording it):** set_logs ids
7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
27, 28, 29. Their `logged_at` is derived from `created_at`, not client-stamped.
Everything outside that range was client-stamped at log time.

Unchanged across the write, by checksum: 215 sets, 65 occurrences, 7 sessions,
volume 236416, and an md5 over every set's load/reps/effort/equipment. The 192
untouched `logged_at` values hashed identical.

Log 3 now reads `started 23:01:31Z → ended 23:58:41Z`, duration **57 min**,
`ends_before_starts` false.

**A guard caught my own bad assertion**, which is worth recording as the reason
the rehearsal pass exists. The first run failed on "the 192 logged_at values are
byte-identical" — because I hashed `where logged_at is not null`, which selects
192 rows before the write and 215 after. The data was fine; the check compared
different row sets. Re-pinned to the fixed id range (`id not between 7 and 29`).
A rehearsal that can only ever pass is not a rehearsal.

### §2 Drop segments lost their equipment snapshot

`addDrop` in StrengthCard copied `equipmentId`, `equipmentLabel`, `setType` and
`side` from the parent but **never `equipmentType`**, so every drop segment came
out typeless. Now inherits `equipmentType` and `equipmentBuiltInWeight` too.

This mattered beyond cosmetics: the `· no unit` marker requires a context-bound
`equipment_type` to fire, and so does the "unattributed sets" audit — so a
typeless drop segment was **invisible to the very query that would have found
it**. Verified through the real UI: parent and segment both `selectorized`.

**3 drop groups exist in prod, 2 are affected** (segments 61 and 110). Group
55/56 is intact, so something once carried the type — origin not established.
Backfill proposed, not run: both would gain their parent's `equipment_type`
(`cable`, `selectorized`); neither changes `equipment_id`.

### §3 The sessions CSV's program is derived, not stored

`workout_logs.program_id` is never written, so emitting it produced a
permanently blank column. Replaced with `programs` / `program_ids` /
`program_count` derived through `session_exercises.program_day_id`, plus
`block_occurrences` and `adhoc_occurrences`.

Multi-program sessions list every program rather than picking one; a session
with no program-linked occurrence reads `(ad-hoc)`. Blocks are excluded from the
program columns and counted separately — they are `program_days` of the hidden
block library, and counting them as a program would have put
`__block_library__` in the name list of almost every session.

### §5 Butterfly — the report did not reproduce

Checked the cited ids directly: **250, 251, 252 all carry
`equipment_id = 7d40d4f1…`**, the same unit as 7/14 and 7/18. All 9 Butterfly
sets across all three dates are attributed. Nothing to correct.

The real unattributed population is **30 cable sets in 8 exercise/date groups**,
none of them Butterfly — listed in the round report.

---

## 2026-07-27 (close-out) — drop-type backfill, provenance fix, set_index note

### The set-56 question, answered

**There is exactly one strength drop-creation path** (`addDrop` in StrengthCard),
and `git log -S` confirms it **never** carried `equipmentType` until this
session. The metric card's `+ Drop` writes `cardio_logs`, which has no equipment
columns at all — structurally incapable of this bug. So set 56's type did not
come from a second creation path.

Nor from a later edit: `equipment_type` is only ever written by `logSet` /
`POST /api/set-logs`. `editSet` deliberately excludes it and the PATCH route
ignores it (both documented in place). An edit **cannot** set it.

What the data shows:

| set | unit | unit's own type | set's type |
|---|---|---|---|
| 55 / 56 | VSL18 | selectorized | both `selectorized` |
| 60 / 61 | *none* | — | parent only |
| 109 / 110 | VSL03 | selectorized | parent only |

55/56 and 60/61 were logged **11 minutes apart in the same session on the same
build**, so no version difference explains it. The remaining consistent
explanation is an **earlier round's hand-repair** — the one that wrote
`equipment_type` onto unit-attributed sets by deriving it from the unit. It
would have caught 56 (has a unit, logged 01:12) and not 110 (logged 21 hours
later, after that repair ran), and could never have caught 61 (no unit to derive
from). That fits every observation, and it is a repair, not a code path — so the
question is closed: **there is one drop path, and it had one bug.**

### The 2-row backfill

61 → `cable`, 110 → `selectorized`; taken from each segment's PARENT, never from
its unit — the parent is the row that recorded what was performed. Neither
`equipment_id` changed. Asserted: exactly 2 rows, an md5 over *everything except
equipment_type* unchanged, and an md5 over `equipment_type` on all other rows
unchanged.

**Correction to an over-claim in the round report and the previous commit
message:** this did NOT leave all 215 sets typed. It took typeless sets from 11
to **9**. The remaining 9 are ids 7–18 on 2026-07-14 (Triceps Overhead Extension
×3, Triceps Pushdown ×3, Dips ×3) — none in a drop group, all from the earliest
logged session, i.e. genuine pre-model legacy rows that never recorded a type.
They have no parent to inherit from, so NULL there is the honest value and they
are left alone.

### `first_finished_source` now means what it says

Removed the line stamping `'user'` on a DATE-only edit. The column marks a
hand-set INSTANT, matching the `restSource: 'user'` convention it was modelled
on. Verified in all three directions: a date-only edit leaves it NULL; setting
the instant stamps `'user'`; explicitly CLEARING the instant also stamps, since
that is equally a deliberate act.

Forward-only — log 3's `'user'` is now accurate, because backfill C set that
instant by hand.

### `set_index` gaps are documented, not renumbered

Gaps mean a set was deleted; duplicates mean a drop segment shares its parent's
index. Both look like data loss to a cold reader and neither is. Renumbering
would rewrite history for cosmetics, so the semantics are documented instead —
in the CSV route AND in a `readingNotes` block inside the JSON itself, alongside
notes on absence, timestamps and the two finish columns. The reader most likely
to be misled is the one that never sees this repo.

---

## 2026-07-27 (About you) — profile + dated weigh-ins; bodyweight is NOT load

### Bodyweight is a body-composition metric, not a load input — CLOSED

This closes a question open across three rounds. **Bodyweight will never feed
`set_logs.load`.** It is tracked for body composition (weight trend, future
stats, LLM context) and nothing else.

The reasoning, in one line: **training load measures what you ADDED; bodyweight
is a separate metric that happens to share a unit.** Pullups, Dips and Captain's
Chair correctly record `load 0` — the weight added on those sets was zero.

What that decision deletes outright: no `set_logs.bodyweight_lb` snapshot
column; no `load = bodyweight + belt` arithmetic; no day-to-day bodyweight
jitter leaking into stall detection and volume-load; no retroactive correction
flow; and no decision needed about the 20 existing `load 0` rows — they stay 0,
correctly. The proposal from the earlier round is withdrawn, not deferred.

### Storage

`profile` holds what changes on a scale of years (dob, sex, height_in,
training_years); `body_metrics` holds dated weigh-ins. Bodyweight is NOT a
profile column, because a single mutable field would be a lie the moment you
weigh yourself again — and the time series is the point.

**DOB, not age.** Age is DOB plus time, so storing it means every derived number
rots silently and a stale 34 is indistinguishable from a correct one.

**`training_years` numeric, not the `training_age` enum.** Novice/intermediate/
advanced can't be self-reported consistently, and the argument for keeping the
category rested on `volume.ts`, which has zero production importers — it isn't
consuming anything today. The enum column is LEFT IN PLACE (additive change,
nothing dropped) but is not surfaced; a category can be derived from years later
if anything ever needs one.

Only fields the owner will actually fill are on screen. `goal_mode`,
`available_days`, `protein_target_g` and `activity_seed` stay off it — inert
controls turn honest context into clutter.

### Height follows the WEIGHT preference

`height_in` is canonical inches, rendered ft/in when the weight preference is lb
and cm when it's kg. A body measurement has no machine marking to respect, and
nobody thinks in pounds and centimetres at once. `inToFtIn` rounds the total
BEFORE splitting, so 71.6 in is 6′ 0″ and never 5′ 12″ (locked by test).

Verified: toggling the preference flipped height 5′ 11″ → 180.3 cm and weight
177.5 lb → 80.5 kg together, and an md5 over both tables was **identical before
and after** — a toggle writes nothing.

### Weigh-ins: append, back-date, one per day

A new weigh-in appends; it never overwrites, because that history IS the trend.
The single exception is same-date, enforced by a unique index: correcting this
morning's number updates this morning's row rather than leaving two rows for one
morning. Back-dating is a feature — weights known from before the app was used
are as real as today's. Only future dates are refused.

**A history view needs no rework.** `GET /api/body-metrics` already returns every
row newest-first; a history screen is a component over that response, not a
change to the route.

### `set_index`-style reading notes extended

`readingNotes` in the JSON export now covers `body_metrics` (a time series;
latest row = current; back-dated rows expected; one row per date) and `profile`
(singleton, NULLs mean not-recorded, `training_age` retained but unused), plus
an explicit `bodyweight_is_not_load` note so the decision above survives contact
with any future reader of the file.

### What progression does for a load-0 exercise (reported, not changed)

See the round report. Summary: rep-based signals WORK (`progressing` and
`true_stall` both fire); `increase_load` fires on reps and suggests +5 lb, which
reads as "add a belt" and is reasonable; but **regression detection is
structurally dead** — `sessionVolumeLoad` is `Σ(0 × reps) = 0` for every
session, so the "volume-load fell 2+ sessions" branch can never trigger. Also
`topSet` degenerates to the FIRST working set when all loads tie, so
comparisons are set-1-vs-set-1 rather than best-vs-best.

---

## 2026-07-27 (weigh-in history) — view / edit / delete, and a hydration bug

### The history sheet

`body_metrics` rows were write-only from the UI: Settings showed the latest and
nothing else, so a mistyped or throwaway entry was permanent. Tapping the
Bodyweight row now opens a sheet listing every weigh-in newest-first, each
editable in BOTH dimensions (a weigh-in can be wrong in its number or its day)
and deletable behind a two-tap confirm. Adding lives here too, so weigh-ins have
one home; the Settings row is a summary.

No schema. New routes: `PATCH`/`DELETE /api/body-metrics/[id]`.

The summary is recomputed from the server after every write, so deleting the
newest entry falls back to the next one rather than showing a stale number, and
reads `not set` — in the same muted style as the other unset fields — once none
remain.

### Date collisions: refuse, don't replace

`body_metrics_date_uniq` allows one row per date, and the two ways of reaching
an occupied date are NOT the same act:

- **Editing** an entry's date onto an occupied one is **refused** (409
  `date_taken`), and the message names the day and the weight already there. An
  upsert would silently destroy a real measurement with no trace.
- **Adding** on an existing date still updates that day's row. That is a
  correction to that day, which is what the add flow should mean.

### A hydration bug found while verifying, and fixed

The unit toggle showed `lb` highlighted while every value on the page rendered
in `kg`. Not a new bug and not in this round's code: `useWeightUnit` seeded
`useState` from `localStorage` during render, so the client's first render
disagreed with the SSR HTML (which can only produce the default). React's
response to that mismatch is *"this won't be patched up"* — leaving the
control's own highlight permanently wrong whenever the stored preference wasn't
the default.

Fixed in `useUnit.ts`: initial state is the SSR default, and the stored value is
adopted in an effect. One extra render with the default is the price.

Worth recording because the failure mode is nasty — **the control lied about its
own state**, and every value on the page was right, so nothing looked broken
enough to investigate. It was only visible by comparing the toggle against the
numbers beside it.

---

## 2026-07-27 (audit fixes) — "a server write nobody reads", and a correction

Items #1–#3 and #5 of the divergence audit were one missing discipline, not four
bugs. The newest surfaces (`profile`, `body-metrics`, `EquipmentSheet`) already
read their responses; the older ones never learned to.

### #1 — the dead route

`StrengthCard.applyOffsetToOccurrence` PATCHed `/api/machines/[id]`, a route the
Machines → Equipment rename deleted on **2026-07-16**. The response was never
read, so it 404'd silently for eleven days while the code comment promised the
offset "also becomes that unit's stored default". Now points at
`/api/equipment/[id]` and checks `res.ok`. Verified: new route 200 + value
stored; old route 404.

It caused no divergence only because the three units carrying offsets were set
through the equipment editor instead. Luck, not safety.

### #2 — AddUnitModal conflated offline with rejection

The offline fallback (set-sync auto-registration) carries only id + label +
type + offset, so on a 4xx/5xx the gym, brand, model, plate increment, add-on
weight, stack max, pulley ratio and notes were silently discarded while the
screen showed a fully specified unit.

Now: a thrown fetch still falls through quietly (correct — the unit re-registers
on the next set sync); a non-ok response stops with an inline error and the form
untouched. **Verified both, and they differ:**

- simulated 500 → sheet stays open, "Couldn't save this unit: simulated server
  failure", and every input value byte-identical to before the submit.
- simulated true offline → sheet closes, no error, unit selected.

A first attempt at the offline test failed only the POST while letting the list
GET succeed — an impossible combination that made the unit look unselected. Ran
it again with every request failing before reporting anything.

### #3 — program-day writes threw into the void

`DayEditorView` made five writes through `api()` (which throws on non-ok) with
zero try/catch in the file. Each now catches and surfaces. **Reorder reverts**
as well as reporting: `commitExOrder` captures the previous order before the
optimistic `setExOrder` and restores it on failure, so a failed drag can't leave
the list showing an order the server never accepted.

**Driven through the UI, not verified by construction** (it is the only change
in the round with real logic rather than a try/catch). Custom view, a real
pointer-event drag of row 1 down past row 2 — `left_click_drag` does NOT work
here, dnd-kit's PointerSensor needs intermediate `pointermove` events past its
6px activation distance, so the sequence is dispatched by hand.

| | POST | banner | UI order | server order |
|---|---|---|---|---|
| reorder rigged to 500 | attempted once | shown | **reverted to server's** | unchanged |
| same drag, allowed through (control) | succeeded | none | new order | **matches UI** |

The control is what makes the failure case mean anything: it proves the drag
genuinely moves rows, so the reverted order is the revert logic working and not
a drag that never registered. Local order restored afterwards.

### #5 — exercise writes detected failure and dropped it

`ExerciseDetailSheet.patch()` (rename / retag / field config) had a try/finally
that caught nothing, so a rejection escaped unhandled with the sheet showing the
new value. `collapse()` checked `res.ok` and did nothing when false. Both now
report. Also `exercises/page.tsx` `tagAndFinish` silently ignored a failed
movement-pattern PATCH — an untagged exercise is excluded from substitution and
volume math, so that one was expensive to drop.

### #6 — the three StrengthCard localStorage seeds

`hintDismissed`, `equipType` and `offsetConfirmed` all seeded `useState` from
localStorage during render. `equipType` is the one that mattered: a stored type
differing from `suggestEquipmentType()` would leave the `<select>` showing the
server's value while state held the stored one — the phantom-unit shape.

All three now take the SSR default and adopt after mount. **No state-machine
change was needed:** `equipType`'s adoption went into the EXISTING restore
effect, which already carried the `equipTouched` guard, so precedence is
unchanged (server truth > last used > suggestion) and no new state was added.
`offsetConfirmed` is already re-derived by its own effect, whose first run is
mount.

### #4 — I WAS WRONG, and reverted my own "fix"

I reported that the husk sweep's `created_at < <JS Date>` comparison was wrong
by the database's UTC offset, citing the login_attempts precedent. **That was
wrong about the mechanism.** When Postgres compares a `timestamp` to a
`timestamptz` it casts the timestamp using the session `TimeZone` — which is
exactly the zone `defaultNow()` wrote it in, and nothing else writes that
column. Proven on the local America/New_York database: the bare comparison and
an explicit `at time zone current_setting('TimeZone')` agree on every row.

I had already applied the conversion. I reverted it rather than ship a no-op
presented as a fix, and replaced it with a comment explaining why the code is
correct as written — including a do-not-"fix"-this note, since it looks like the
login_attempts bug and isn't.

What actually broke login_attempts was the WRITE side: app-supplied values in
the process's zone mixed with `now()` values in the DB's zone. That hazard is
real, applies to `updated_at`, and is recorded in SPEC-DRIFT rather than patched
four times.

---

## 2026-07-27 (session surface) — concrete progression, load bounds, session notes

### §1 Concrete progression — and a correction to the brief's example

The core still decides *whether* to add load; `src/lib/nextLoad.ts` decides
*which number*, at the presentation layer. `src/core/*` gains no equipment
knowledge — verified by grep. The snapping was doable outside core, so it was.

The increment resolves stored → derived → nothing. The derived step reuses
`suggestPlateIncrement` (the equipment form's "Suggested from your logs"), not a
second GCD, and its result is a LOWER bound — it may propose a smaller step than
the machine offers, never an unreachable one.

**Measured against real prod data, 9 of 19 lanes produce a concrete number
today; the other 10 fall back to generic wording** because `suggestPlateIncrement`
needs three distinct loads and they have two. That ratio improves on its own as
history accumulates — no data entry required.

**Two corrections to the verification brief:**

- `VSL16` is **Seated Leg Curl** with loads 140/150 — two distinct, so it
  correctly falls back to generic. The example intended was **VSL09**, which is
  Leg Extensions with 140/150/160 → yields 10 exactly as described.
- `VSL10` is **Calf Press on the Leg Press Machine** (300/320/340 → 20), not
  the exercise implied.

The behaviour described is real; the unit labels were transposed.

### §2 Load sanity — the ceiling, and why that number

`ABSURD_LOAD_LB = 2000`. Justification: the heaviest raw squat on record is
~1100 lb and a fully loaded leg press tops out near 1500 lb, so 2000 clears
every legitimate entry — while still catching the errors that actually happen
(9999, 12345, a decimal slip turning 1500 into 15000). Locked by a test that
asserts silence at 45/120/185/315/405/500/700/1100.

Deliberately NOT derived from history: the "2× your usual" bound was rejected in
the slip-guard round because a genuine PR trips it, and it is not being
reintroduced under another name.

The `stack_max` check is precise but silent — NULL on all 18 units — so the
ceiling is the path that actually fires. Both are advisory: one tap to proceed,
never blocking, dismissal keyed to the value so correcting the number re-arms it.

### §3 Session notes

`workout_logs.notes` existed and had never been surfaced. Now behind the ✎ in
the session header (not a field between sets) and editable afterwards from the
History row's expanded detail — which is the more useful moment, since what's
worth recording about a session is usually clearer in hindsight.

Rides the EXISTING `metaDirty` path rather than a second queue, so a note
written offline drains with the date/time edits. Empty or whitespace-only stores
NULL. A session carrying a note shows `· note` on its History row and beside the
date in the session header.

### Verification coverage, stated honestly

Unit-tested: increment resolution, the add-on grid (120 + 10-plate/5-lever =
125), the stack-max cap, and every sanity bound — 14 new cases.

Driven through the app: the note round trip (save → list → clear to NULL), the
History indicator, and the History editor prefilling the right row's text.

**Not driven end to end:** the concrete-suggestion line rendering on a card.
That needs a lane with three distinct loads AND a progression run returning
`increase_load`, i.e. three staged sessions on one unit — and the standing rule
forbids fixturing card behaviour via SQL. The resolver is unit-tested and the
grid inputs are confirmed reaching the client from `GET /api/equipment`; the
render itself is verified by construction.

---

## 2026-07-27 (input limits) — prevention replaces the absurd-load warning

### The warning is gone; the machine-specific one stays

`ABSURD_LOAD_LB` and its branch are deleted — no readers remain. Catching a
slipped digit is an input constraint's job, not a line of commentary under the
field. The `stack_max` arm survives because it says something a limit cannot
("400 lb is above this machine's 240 lb stack"), stays advisory, and stays
silent across all 18 units until a stack max is recorded.

### The cap is on INTEGER DIGITS, and the keystroke is REFUSED

`maxLength` would have broken real values — 177.5 is six characters, 4.35 is
four — so `maskNumeric` (src/lib/numericInput.ts) counts digits before the
decimal point instead. Decimals stay free below the cap and a leading minus
survives where the field opts in.

A keystroke that breaks a rule returns the PREVIOUS text, so `12345` in a
4-digit field leaves `1234` and the `5` never appears. The field never displays
a value it won't keep — that is the difference between a limit and an
autocorrect.

### The bug this shook out — worth remembering

`177.5` first came out as `1775`. Several callers (StrengthCard's load/reps,
SetRow) hold their state as a NUMBER, so an in-progress `"177."` round-tripped
through the parent as `Number("177.") = 177` and the decimal point vanished as
it was typed.

`NumberInput` now owns its display text and only emits upward — the same
`text` + `lastEmitted` pattern `UnitNumberInput` already used, and for exactly
the same reason. The resync compares NUMERICALLY, so `"177."` vs `177` isn't
mistaken for an external change.

Caught by typing character-by-character in the real field. A single
`setValue("177.5")` would have passed, because the failure only exists while a
trailing point is on screen.

### The enumeration

Every numeric input now routes through one of two components — **zero raw
`<input type="number">` remain outside `NumberInput` itself**:

| where | fields | cap |
|---|---|---|
| Session card | load, drop load | 4 |
| | reps, drop reps | **3** (integer-only) |
| | built-in offset (UnitNumberInput) | 4 |
| Metric card | duration, distance, load | 4 |
| | speed | **3** |
| | incline, level | **2** |
| Target sheet | target sets | **2** |
| | rep min/max/single | **3** |
| | duration, distance | 4 |
| | speed / incline / level (metric config) | 3 / 2 / 2 |
| Equipment form | built-in (negative allowed), plate size, add-on, stack max | 4 |
| Settings — About you | training years | **2** |
| | height cm / ft / in | **3 / 1 / 2** |
| Weigh-ins | bodyweight (add + edit) | 4 |

`type="text"` + `inputMode` is deliberate: a real `number` input reports partial
and exponent values as an empty string, which silently defeats a
keystroke-refusing mask, and it draws spinners nobody taps on a phone.

Load, distance, duration, bodyweight and the stack fields keep 4 — none has an
obvious tighter bound that couldn't bite a legitimate entry (a loaded leg press,
a long ruck, a marathon). Left at the default rather than guessed.

Entry-side only: an md5 over every stored load and rep count is identical before
and after.

---

## 2026-07-27 (note placement) — the note gets its own line

Behind the ✎ was the wrong home. That pencil sits beside the date and edits the
date and time, which is exactly what it looks like it does; hiding a second,
unrelated thing there conflated them. A ⋯ menu would have been no better — a
note you must remember to go looking for defeats the point of writing one.

The note now renders on its own line under the session title: the text when
there is one (truncated to a single line, muted, tappable, full text in the
title attribute), and a quiet `+ Add note` when there isn't. One line of
vertical cost, and it only ever shows content or an invitation to add some.

The `· note` marker in the date line is gone — redundant once the note itself
is on screen — and its dead CSS class was swept. The ✎ editor is back to date
and time only, with its own save; the note has its own. History's row indicator
and editor are unchanged.

Verified in the app: `+ Add note` is the topmost element at its position
(elementFromPoint), a saved note renders truncated with `white-space: nowrap` +
`text-overflow: ellipsis`, and the ✎ editor contains exactly two inputs — a
date and a time — with the note line still rendered beside it.

---

## 2026-07-28 — Timeline notes: annotating the gaps between sessions

### Why a new table and NOT `injury_flags`

`injury_flags` is not one of the inert declared-but-unwritten tables — it is
**read by `loadActiveInjuryStructures()` and feeds `src/core/substitution.ts`**.
A row meaning "on holiday" written there would have silently started excluding
exercises from substitution, and nothing would have surfaced it. It is also
keyed on anatomy (`structure` NOT NULL), carries an `active` boolean rather than
dates, and its `created_at` is when you typed it, not when the period began.

It is a **current-state clinical filter**; this is a **historical explanatory
annotation**. Same word, different jobs — and only one of them may change what
the app suggests.

`recovery_metrics` is daily numeric telemetry with no text column and no range.
Neither fits.

**`timeline_notes` is inert by construction.** Nothing in `src/core/*` reads it
and no adapter passes it in — verified by grep. That separation is the entire
reason it is a separate table.

### The model

`start_date` NOT NULL · `end_date` NULL = **still ongoing** (not unknown) ·
`kind` free text with a picker of five suggestions, NOT an enum (an enum means a
migration the first time reality produces "moved house") · `notes` NOT NULL —
the one justified exception to the absence rules, because a note with no text
explains nothing · `created_at` **timestamptz**, deliberately not the tz-less
default the rest of this schema keeps paying for.

A single-day entry is a range where start equals end. One thing, not two.

### Rendering

Interleaved into History newest-first, ordered by `start_date`. **Not a card**:
no border, no chevron, no session chrome — a left accent rail with the range and
text set small, so it reads as connective tissue rather than an entry. A range
overlapping sessions spans them without displacing anything, because notes and
sessions are separate items in one sorted stream.

A **gap marker** appears between sessions more than three days apart — three
rather than two because a rest day and a missed day are normal and don't need
explaining. It carries the gap's own interior dates so `+ Add note` arrives
pre-filled (verified: an 11-day gap pre-fills Jul 2 – Jul 12).

Gaps are computed from SESSIONS ONLY: a note doesn't close a gap, it explains
one, so a gap that already has a note still shows both.

### Additions

**A general `+ Note`** sits beside the History heading — plenty of notes
("started a new job, sleeping badly") belong on a normal week with sessions
either side and have no gap to hang off.

**Edit and delete** in the same sheet, including a one-tap "ended today" /
"still ongoing" toggle, since closing an open note is the natural follow-up to
writing one and re-opening it must be just as easy.

**The CHECK constraint never reaches the UI.** `validateNote()` checks the date
order first and returns *"The end date can't be before the start date."* A
partial edit validates against the STORED start, so setting only an end is
checked properly.

### Addition 4 — the session note editor is a sheet

Inline pushed the exercise cards down the moment you tapped, moving content
under your thumb as you were about to type. It is now the app's standard bottom
sheet (add-exercise, unit, target), with a 5-row textarea. **Verified: the first
card's position is byte-identical before and after opening.**

Header gap 8px → 2px: the title, date and note line now read as one block, with
the space to the first card coming from the list's own margin as everywhere else.

**History's row editor was left inline** — deliberately. It lives inside an
expansion the user has already opted into by tapping the sync dot; that
expansion moves the rows below it either way, so the editor adds no new shift.
A sheet there would be ceremony for an edit already two taps deep.

### Prod migration

34 → 35 (exactly one). `timeline_notes` 0 rows; 215 sets and volume checksum
236416 unchanged; the range CHECK present in prod.

---

## 2026-07-28 — History as a timeline: span rails

A dated note is a SPAN, and rendering it at one point meant the longer it ran
the harder it was to find — backwards. Sessions are now nodes on a spine and
notes are rails in the gutter beside it.

### Geometry: per-row segments, not absolute positioning

Each row draws its own short rail segment for every span active on that row's
date; contiguous segments meet and read as one line. No measurement, nothing to
recompute on resize, and — the point — a note can never displace a session,
because the gutter is a fixed column beside the cards rather than a row among
them.

Row gaps had to go to zero: any vertical space between items shows as a SEAM in
the rail. Separation comes from the card's own padding instead.

Lanes pack greedily by start date, lane 0 to whichever began earliest so
long-running background context sits nearest the spine. **Past MAX_LANES = 3 a
span gets no lane and is counted into a "+N more" marker** rather than dropped —
losing one silently would mean the screen lying about a note the owner wrote.

**Gutter: 44px at one lane, +8px per extra.** On a 390px screen every pixel is
taken from the session card, so it never reserves space for lanes not in use.

### Palette

From the app's own tokens, not raw hues: illness `--hue-nutrition` (amber),
injury `--danger` (red), travel `--hue-recovery` (teal), deload `--hue-coach`
(violet), other `--text-3`. `other` is deliberately colourless — an untyped note
shouldn't imply a category it doesn't have.

### The bug the tests did not catch

`chipRowIndex` originally returned -1 for a span covering no session row, and
the caller rendered nothing — **a note the owner wrote, stored, and could not
see.** That is the common case for a short note in a quiet week, and my own unit
test asserted the -1 as correct. It was only visible in the browser, where a
"flight day" note simply wasn't there.

Now it chips against the first row older than the note (keeping chronology), or
the last row if it predates everything. The test was rewritten to assert the
corrected behaviour, with a note that the browser caught it.

Also fixed: `SessionRow` rendered an `<li>` inside the timeline's own `<li>` —
invalid, and React said so twice in the console. It takes an `asDiv` prop now.

### Gap prompts removed

The per-gap `+ Add note` is gone. Prompting on every rest gap would push the
owner to annotate ordinary rhythm, and once some gaps carry notes and others
don't, absence stops meaning anything — which would break the export's own
promise that silence is never evidence. Adding lives on the header `＋ Note`.

**Gap labels survive above a FIXED 7 days.** Fixed rather than derived from
typical spacing: an adaptive threshold would stop labelling a week off precisely
during an already-sparse period, which is when it matters most. Legible beats
clever. No affordance on the label — orientation only.

### The sheet

Read-first: kind chip in colour, range with a DERIVED duration (`since Jun 28 ·
30 days`, recomputed every open rather than frozen), then the full text with
`white-space: pre-wrap` and no truncation. **Mark ended today** appears only
while the note is open, since closing one is the natural next act and beats
opening an editor to change a single date. Edit hands off to the existing editor
sheet; Delete keeps its confirm.

### Session header — the real source of the gap

Last round I tightened `.sessionHeader`'s own `gap` 8px → 2px and the dead space
persisted, because it was never coming from there. The actual sources were
`.page`'s `gap: 12px` between the header and the card list, and `.headerLine`'s
own `padding: 4px 2px`. Fixed by zeroing the header gap, dropping the block
padding, and pulling the header up 6px — title, date and note now sit flush with
6px to the first card.

The note is an ANNOTATION now, not a subheading: `✎` glyph plus text at 0.73rem
in `--text-3`, against the 1.15rem title. No "Note:" label (spends width on what
the glyph conveys) and no "see note" button (hides the content when seeing it is
the point).

### Old tile chrome dropped

The note tile's borders never matched the session cards, and under rails a note
isn't a tile at all — the treatment was removed rather than restyled, and its
dead CSS swept.

---

## 2026-07-28 (chip treatment) — the note stopped looking like a session

Against `history-timeline-mock-v2`, one thing was wrong: the chip was rendered
INSIDE a session row's content block, above the card. That made it read as a
field belonging to that session — a note about the workout rather than an
annotation beside the timeline.

Three changes, all from the mock:

1. **The chip is its own row.** It is spliced into the stream immediately above
   the row it anchors to, as another item in the same sorted list. Sessions keep
   their positions; nothing is wrapped around anything.
2. **It is a PILL, not a line of text** — `inline-flex` so it shrinks to its
   content instead of spanning the card's width (the specific thing that made it
   look like an entry), with a border and text in the kind's colour. The palette
   now drives the border too, at 40% alpha.
3. **No spine dot on a chip row.** Dots mark sessions; a note is not a node.

**Sessions became individual cards.** The continuous grouped card could not
survive chip rows spliced between sessions — per-card is what lets a chip sit
between two sessions without breaking either one's chrome, and it is what the
mock does.

Two things caught while matching it: bare `[data-kind="…"]` selectors are not
valid in a CSS module (pure-selector rule), so they are scoped to `.tlItem` /
`.tlViewKind` / `.tlDot`; and the card padding I added doubled `.row`'s existing
12px/14px, squeezing the title and wrapping the meta line onto two rows once the
44px gutter took its share of 375px.

Verified: `border-radius 999px`, border and text in `--danger` for injury,
`display: inline-flex` at 291px rather than full width, `closest('.rowWrap')`
null (genuinely outside any session card), topmost at its own coordinates, and
the sheet still opens with no layout shift.

---

## 2026-07-28 (equipment specs reach the suggestion) — verification, no code change

The owner filled `plate_increment`, `add_on_weight` and `stack_max` on the twelve
VSL units from resolved Precor DSL model specs. Prompt 45's concrete-suggestion
work was built when all three were NULL everywhere, so this is the first time the
`stored` arm of `resolveIncrement` has ever been taken in production. Verified
read-only by running the SHIPPED functions (`resolveIncrement`,
`nextSelectableLoad`, `selectableLoads`, `checkLoadSanity`) against real prod
rows rather than re-deriving the arithmetic.

**It landed.** 12 of 19 units now resolve `stored`, 2 still resolve `history`,
5 remain generic. Three things the fill actually bought:

1. **Five units were rescued from generic** — VSL02, VSL06, VSL11, VSL14, VSL16
   each have fewer than 3 distinct logged loads, so the GCD returned null and the
   card fell back to wording with no number. They now step concretely.
2. **VSL10's inferred increment was wrong and is now corrected.** Its logs
   (300/320/340) give a GCD of 20; the machine is really a 10 with a 5 lb add-on.
   This is the documented GCD-as-lower-bound failure showing up in real data, and
   it is exactly why the stored value takes precedence rather than being averaged
   with or validated against the derived one.
3. **The `at_max` arm became reachable.** With `stack_max` NULL, `selectableLoads`
   returned `[]` and the only max test was `spec.max != null` — never true, so the
   topped-out branch was dead code. Twelve units now enumerate a grid; asking from
   each ceiling returns `at_max`.

The add-on is doing its job: with increment 10 and add-on 5 the grid is
10, 15, 20, 25 … so the next load above 120 is **125**, not 130 — confirmed on
VSL14, whose real top logged load *is* 120.

No data-entry errors found. No logged load exceeds its unit's `stack_max`, and
all 33 distinct (unit, exercise, load) combinations land on a selectable point of
the grid their own specs describe — a wrong increment or add-on would have
produced off-grid history immediately.

**Still unfilled, recorded not corrected:** the seven non-VSL units. Four have
real weight stacks and want all three fields (`Monroe Gen Cable Tower` — the
most-used unit at 37 sets, `LifeFitnessShoulder`, `Pulldown304`, `longpull 302`);
three are plate-loaded or smith (`24res`, `HackSquatMonroePF`, `VPL-SMBP`) where
`stack_max` is meaningless but `plate_increment` still is not. These are the
owner's to fill; nothing was written.

### A note on scope

`loggedLoads` in `GridSpec` is **per unit**, not per core lane — it comes from
`/api/equipment`'s `array_agg(distinct load)` grouped by `equipment_id`, so a unit
carrying two exercises (VSL13: Butterfly and Reverse Machine Flyes) pools both
into one GCD. That is correct for inferring a machine's plate size and wrong as a
statement about either lane's history; it only ever feeds the grid, never core.
The live suggestion anchors on the top working set of **today's** occurrence
(`StrengthCard`'s `topLoggedLoad`), not the historical maximum.

---

## 2026-07-28 (deferred to the LLM phase) — five progression findings

Recorded now while the reasoning is fresh. **None of these are being fixed this
round**; `src/core/*` is untouched. Three come from diagnosis of the current
engine, two are requirements for the phase that follows.

**Frame the whole list honestly: the LLM phase is for interpretation, not for
recovering missing inputs.** It receives the same 24% effort coverage the rules
engine has. Load, reps, sets and time remain the primary signals — which is fine,
because those are what actually drive hypertrophy.

### 1 · `regression` is dead for bodyweight exercises

`sessionVolumeLoad` is `Σ(load × reps)` (`progression.ts:51`), which is
identically 0 when load is 0. The regression test is
`lastThree[0] > lastThree[1] > lastThree[2]`, and `0 > 0 > 0` never fires. The
fatigue/deload signal is therefore permanently blind on Pullups, Dips and
Captain's Chair — not weak, structurally unreachable.

**Resolution reached:** a static bodyweight and a rep-only trend are the *same
computation*. Multiplying every set by a constant cannot change the direction of
a comparison, so a constant multiplier makes the trend purely rep-driven. It is
one change, and it needs no stored bodyweight — which matters, because storing
one would make every historical set's volume depend on a weight measured today.

### 2 · `topSet` degenerates when loads tie

`session.workingSets.reduce((best, s) => (s.load > best.load ? s : best))`
(`progression.ts:57`) uses a strict `>`, so at a constant load — every bodyweight
lane, and any session where the top load repeats — it never advances past the
seed and returns **set 1**, not the best set.

**Concrete consequence, worth keeping:** 7/6/6 followed by 5/8/8 reads as
*regression* by set 1 (7 → 5) and *progress* by best set (7 → 8). Same data,
opposite conclusion, decided entirely by an implementation detail of a reduce.

### 3 · Untagged sets are assumed to be at target effort

`(s.rir ?? context.targetRir) <= context.targetRir` appears at
`progression.ts:83` and `:118` and `stallBuster.ts:33`. The `??` means *no effort
recorded* is treated as *exactly at target*, which passes the test. With effort on
52 of 215 sets, **~76% of the data is assumed at-target**, biasing both
`true_stall` and `increase_load` toward firing.

**Record the dead end plainly: effort cannot be inferred from these logs.**
Within-session rep decay was considered as a proxy and **rejected** — the owner
logs to a rep target, not to failure, so 10/10/10 is the expected shape of an
easy session and a hard one alike and carries no effort information. The options
are to keep assuming (biased toward action) or to stop assuming (mostly silent).
Neither is fixable by rules; both are judgement calls about what a missing value
should mean, which is why this goes to the LLM phase rather than getting a
threshold.

### 4 · Exercise-specific progression norms *(requirement)*

Some movements warrant holding a load for several sessions to consolidate form;
others tolerate frequent jumps. A single rule applied to every exercise is wrong
in both directions — too eager on the technical lifts, too conservative on the
machines. The engine has no representation for this and no way to derive one.

### 5 · Plateau interpretation *(requirement)*

When load stops moving, the engine cannot tell whether that is expected for the
movement, a cue to hold the load and add reps, or a signal to swap to a harder
progressable exercise. `true_stall` detects the *pattern*; deciding what it means
is judgement, not pattern-matching.

---

## 2026-07-28 (increment disagreement) — the record vs the rows, made visible

A stored `plate_increment` wins over the GCD in `resolveIncrement`, which is
correct — but it means the stored value silently overrides the one piece of
evidence capable of contradicting it. VSL10 is the live case: every load logged
there is a multiple of 20 (300/320/340), the unit is set to 10, and the visible
consequence was the card offering 345 on a stack that may not select it.

Same shape as the built-in disagreement, so it gets the same treatment:
`findIncrementDisagreement` in `src/lib/stack.ts`, rendered in the Stack section
of `UnitFormFields` as the existing `warnBox` — quiet, informational, no fix
offered. **Resolution order is unchanged**; `nextLoad.ts` has a zero diff. This
only makes the disagreement sayable.

### The predicate is narrower than "they differ", and that's the whole design

Firing on any inequality would make this constant noise, because **the add-on
lever legitimately produces a finer GCD than the plate size.** A 10 plate with a
5 lever selects 10, 15, 20, 25…, so loads of 15/25/35 give a GCD of 5 against a
stored 10 — completely correct data, and a hint there would be wrong every time.

So the derived step must be a **strict multiple** of the stored one: the logs
never once used the finer notch the unit claims to have. 5 is not a multiple of
10, so the lever case stays silent; 20 is, so VSL10 speaks. Deliberately not a
claim the stored value is wrong — you can own a 10 lb plate you have simply
never used an odd number of. Hence "Check the machine?", not "Fix this".

Confirmed against prod rather than assumed: **1 of 19 units fires** (VSL10), and
every other unit is silent for a distinct, correct reason — 6 store nothing,
5 have fewer than 3 distinct loads, 6 agree exactly. Driven through the real UI
on a staged local unit: the hint renders, `Selectable: 10, 15, 20 … 400 lb` is
unaffected beside it, and correcting the plate size to 20 removes it live.

### "No grid yet" — the counterpart to "Selectable:"

Four stack units still have no `plate_increment` / `add_on_weight` / `stack_max`
(Monroe Gen Cable Tower at 37 sets, LifeFitnessShoulder, Pulldown304,
longpull 302). Blank fields already show themselves; what they don't show is the
consequence — that the unit has no ceiling to be at, and no topped-out answer to
give. The hint names what's missing and says the absence is unrecorded rather
than "no ceiling", which is the actual distinction.

Scoped to weight stacks by the existing `hasWeightStack`, so plate-loaded and
Smith units — where `stack_max` is a category error, not a gap — show nothing.
Verified live by switching a unit's type to `plate_loaded` and watching the hint
disappear along with the add-on and max fields.

### One bug caught in the browser, not by a test

`add {gridMissing.join(" and ")} and this unit…` rendered as **"a max loadand
this unit"** — JSX drops the trailing space on an expression when the line wraps.
Three sibling text nodes, the third beginning `"and this unit"` with no leading
space. Fixed with an explicit `{" "}`. A unit test on the predicate would never
have found it; only reading the rendered string did.

---

## 2026-07-28 (session logging) — leading zero, lane prefill, mid-session reorder

### §1 · A field holding a default appended instead of replacing

Typing `5` into a reps box showing `0` produced `05`, with no way to delete the
zero. Two independent halves, because they fail independently:

**The mask** now drops leading zeros followed by another digit, so `05` collapses
to `5` with no focus event involved. Only zeros with a DIGIT after them go, which
keeps both legitimate zeros intact: a deliberate `0` (added weight on a bodyweight
lift) has nothing after it, and `0.5` has a decimal point.

**Selection on tap** is the other half, and `onFocus={e => e.currentTarget.select()}`
DOES NOT WORK on its own. It looks like it does until you drive a real field: the
browser's own mouseup lands after the focus handler and collapses the selection to
a caret. Measured in the running app — `selectionStart/End` came back `[2,2]` on a
field showing `81`, and typing appended. The fix suppresses only the mouseup that
COMPLETES the focusing tap, leaving later ones alone so drag-select inside an
already-focused field still works. It lives in one shared hook
(`components/selectOnFocus.ts`) rather than three call sites.

Two automation artifacts wasted time and are worth recording so the next session
doesn't re-chase them: the browser tool's `type` action inserts at the caret and
does NOT honour an existing selection, and a JS `.focus()` fires no focus event
when the document itself isn't focused. Both made a working fix look broken.
Real clicks plus `execCommand("insertText")` is what actually exercises this.

### §2 · Prefill from the lane's last session

`sets[0]` WAS NOT the first working set, and using it would have shipped a
plausible-looking bug. `loadSetLogInputsForExercise` has no `ORDER BY`, so its
row order is whatever Postgres returns — measured load-DESCENDING on real data
(180, 175, 164 for a session logged 164, 175, 180). The prefill would have
silently used the heaviest set.

Fixed by adding an explicitly ordered `firstWorkingSet` to the last-session
route, ordered by `set_index` then `id`. Deliberately ADDITIVE rather than
sorting the shared adapter: that adapter feeds core, and core's `topSet` breaks
ties by input order, so re-ordering it would quietly change progression verdicts.

The first working set is the choice on purpose — the last set is usually the most
fatigued and the heaviest is a peak; neither is where you begin. Warm-ups are
excluded by the query. History stores the TOTAL, so the built-in offset comes
back off before prefilling: putting 65 into a box whose label already adds a 20 lb
bar would claim 85. Rendered in the unit the lane displays in, via the existing
resolver. It is a UI default, never a write, and never reads a target.

**Sets 2 and 3 already carry forward** — the log handler doesn't reset the
inputs, so what you typed for set 1 stays. Nothing was built for that.

**Known, pre-existing, NOT fixed:** the card's `last …` line reads `sets[0]` too,
so it shows the heaviest load and lists reps in load order. The staged session
logged 164×9, 175×6, 180×5 and the line reads `last 180 lb × 5, 6, 9` — backwards.
Left alone this round because changing it changes a display the owner reads every
session, and it deserves its own decision.

### §3 · Mid-session reorder — the ordering column already existed

**Answered before building, since it changed the shape:** `session_exercises`
HAS `order_index` (integer, not null, default 0). It is populated contiguously,
it is already the read order (`orderBy(sessionExercises.orderIndex)`), and it
already round-trips through the `/api/session-exercises` upsert. Ordering is
EXPLICIT, not implicit-by-id. **No schema change, no migration.**

So the work was UI only: `SortableList`/`SortableRow` from the program editor,
unchanged — same PointerSensor, same 6px activation, same grip-only activator.
`SortableRow` gained an `as` prop because the session list is a real `<ol>` whose
children are `<li>`, and a wrapper `<div>` between them is invalid nesting (the
trap the History timeline already hit); the cards take `asDiv` in exchange.

`reorderOccurrences` writes contiguous 0..n-1 rather than a chain of swaps, so a
multi-position drag lands in one consistent state. Occurrences missing from a
stale list keep their relative position AFTER the named ones — a stale list can
never silently drop a card. Scoped by construction: the write set is built from
that session's own occurrences, so a foreign id is ignored rather than
re-indexed. An unchanged order is a no-op and does not dirty the sync queue.

Revert is structural rather than a saved copy: the list renders from the store,
so a failed write leaves the store unchanged and the refresh puts the card back.
Verified by patching `IDBObjectStore.put` to throw — the order snapped back and
"Couldn't save that order — the list is unchanged." appeared.

Verified end to end by dispatching a real pointer sequence (`left_click_drag`
does not activate dnd-kit — the 6px sensor needs intermediate `pointermove`s):
the drag reordered, survived a reload, reached Postgres as contiguous 0–7, and
the other two sessions kept their indices.

---

## 2026-07-28 (session surface) — grip in the header, rest above the route, one source for `last`

### §1 · The grip moved inside the card, and the wrapper disappeared with it

It was rendering as its own element above the card, reading as a stray object
rather than part of the card it moves. It now sits **leftmost in the existing
header row**, before the checkbox — matching the program editor, and away from
the `⋯` so a drag handle and a menu button aren't neighbouring targets.

**It adds no height**, verified by measuring rather than eyeballing: the header
was already 52px because `⋯` carries the shared 44px tap-target minimum, and the
grip takes the same 44px target behind an 18px icon. The header is `flex` /
`nowrap` and the grip is one more item on the line.

Two attempts were wrong before this one, both caught by lint against a HEAD
baseline rather than by looking:

1. Passing the dnd-kit activator into the card as a `grip` prop produced eight
   `Cannot access refs during render` errors — a ref-setting function crossing a
   component boundary. Renaming the fields off `ref`/`props` did not help.
2. The fix is that **the card IS the sortable row**: `useSortableCard` is called
   inside the card, so the ref is created where it is used. The `SortableRow`
   wrapper, the `as="li"` prop and the cards' `asDiv` prop all went away, and
   with them the `<ol>`/`<li>` nesting problem — the list is a plain `<ol>` of
   `<li>` cards again. The hook's result must be DESTRUCTURED at the call site;
   `sortable.setNodeRef` in JSX trips the same rule that `setNodeRef` does not.

`touch-action: none` is on the grip only, so a vertical drag starts there while
the rest of the card keeps scrolling and tapping normally.

### §2 · Rest now outlives the route

**Reported before changing, because half the ask was already true:** elapsed was
ALREADY wall-clock — `timerStart` held `Date.now()` and every reader derived
`Date.now() - start`. The intervals only forced repaints; nothing accumulated.

What actually stopped the rest was three separate things: the state was a
`useState` inside `StrengthCard` (unmounted by navigation), the effect cleanup
called `publishRestTimer(null)` on unmount — actively cancelling it — and
`SessionBar` renders only on `/log/[id]`, so nothing showed it elsewhere anyway.

So the bus became the owner and is persisted to localStorage as
`{ startedAt, sessionId, instanceId }`. The cards restore from it on mount when
the record is theirs, and the unmount cleanup is gone. A malformed record reads
as NO timer rather than a rest starting at `NaN`, which would render an absurd
elapsed value and then write it onto a set.

Off-session screens get a `RestPill` in `GlobalNav` — that is the bar that
persists there, since `SessionBar` is the logging-mode bar and its Finish/Add
need log-page state. Tapping it returns to the owning session.

**Completion behaviour is unchanged because there is none**: the count-up
target+notify was removed in 2.6-3, so a rest runs until you stop it (holding the
value) or log a set (consuming it). Nothing fires at any threshold, on-screen or
off. The value written to the next set is untouched.

Verified live: started a rest, went to Equipment (`resting 0:19`), **reloaded**
(`resting 0:38` — the whole JS context was destroyed and rebuilt), returned to
the session (`0:59` in both the card banner and the session bar, matching true
elapsed). A backgrounded tab is a strictly weaker disruption than that reload.

### §3 · `last …` reads the session as logged

The last place the missing `ORDER BY` survived. The line read `sets[0]`, so it
showed the heaviest load with reps in load order: a session logged 164 → 175 →
180 rendered `last 180 lb × 5, 6, 9`. It now reads `setsInOrder`, ordered by
`set_index` then `id` server-side. Warm-ups excluded, same as prefill.

**Correction (same day):** the first version of this note justified `set_index`
over `logged_at` by claiming `logged_at` is NULL on 23 backfilled rows. That is
backwards — prompt 49 backfilled ids 7–29 FROM `created_at` precisely so they
would have one, and the check afterwards returned `missing_logged_at 0`. Re-read
against prod: 245 rows, **0 missing `logged_at`**, all 23 of ids 7–29 populated.
The choice is still right, for the real reason: `set_index` is the explicitly
recorded logged order, whereas `logged_at` is a derived stamp on those 23 rows
and would order them by when the backfill computed them.

**Drop segments, checked while correcting this.** A drop SHARES its parent's
`set_index` — three pairs in prod (55/56, 60/61, 109/110), all `working` rows —
so `id` is not a formality in that ORDER BY, it is the only thing separating a
parent from its drop. In all three the parent holds the lower id and the heavier
load, so `set_index, id` yields parent-then-drop, which is the order they
happened. Locked with a test so a future "tidy" of the ordering can't silently
reverse a drop pair.

What the line does with them is **unchanged and imperfect**: drops are `working`
rows, so they were already inside the old `sets` array and are already counted in
the rep list. The line flattens them, so Machine Shoulder Press on 2026-07-16
reads `… 7, 3` where the `3` is a drop segment, not a third working set. The set
ROWS distinguish drops with `↳ drop`; a one-line summary cannot. Left alone
deliberately — changing what the line COUNTS is a behaviour change, and this
round was an ordering fix. Worth a decision of its own if the `3` ever misleads.

The shared adapter is still NOT sorted, for the reason established last round:
core's `topSet` breaks ties by input order. `session.sets` is returned unchanged
beside the new ordered field.

### §4 · The line and the prefill now share one source

They were two fetches at two scopes — the line exercise-scoped, the prefill
lane-scoped — so a card opened showing `last 164 lb × 9` beside inputs sitting on
45/8 until a unit was picked. Two things claiming the same history, disagreeing.

One effect now, one response, one rule: **scope narrows only when a unit is
actually chosen.** No unit (including a portable exercise, which has none to
choose) → both read the exercise's most recent working set, so the inputs are
populated the moment the card opens. A unit chosen → both narrow to that lane.

The case the brief didn't specify: a chosen unit with **no history of its own**.
Both fall back to exercise scope so they still agree, and the recalibration note
explains where the numbers came from. Falling back only for the line is what let
them disagree in the first place.

`entryTouched` still wins over everything — verified by typing 77, switching
units, and watching the line narrow to `100 lb × 12, 10, 8` while the input
stayed 77.

---

## 2026-07-29 (0035 timestamptz) — APPLIED LOCAL AND PROD

13 `timestamp WITHOUT time zone` columns across 9 tables become `timestamptz`.
The nine `date` columns are untouched and are not in the migration: a weigh-in
on Jul 27 is Jul 27 in every zone, and converting one would introduce the exact
bug this removes.

### The USING clause is `current_setting('TimeZone')`, not `'UTC'`

The owner's brief specified `AT TIME ZONE 'UTC'`, which is correct on prod
(Neon TimeZone = GMT) and **wrong locally** — the dev box runs
America/New_York for both node and Postgres, so local rows hold Eastern
wall-clocks. Since migrations run local-first, a hardcoded 'UTC' would have
corrupted the rehearsal meant to validate them.

Demonstrated on the local run rather than argued: `set_logs` id 29 was
`2026-07-12 01:42:19.825773` and is now `2026-07-12 01:42:19.825773-04` — the
wall-clock digits byte-identical, the correct Eastern offset added. A hardcoded
'UTC' would have rendered it `2026-07-11 21:42:19-04`, four hours off.

### Pre-flight (read-only, prod)

* **0 indexes** touch any of the 13 columns; every index on those tables is on
  `id` or a client id. **0 views**, **0 generated columns**, every default is
  exactly `now()`. The 13 constraints on them are all NOT NULL (`contype='n'`),
  which `ALTER COLUMN ... TYPE` preserves. Nothing to drop or rebuild.
* `timeline_notes_start_idx` is on `start_date`, type `date` — not converting.
* Values are UTC on prod: `set_logs.created_at` vs `logged_at` agree 222/222.
* Both writers agree: `now()` and app `new Date()` landed 95 ms apart.

### Shims removed in the same round (the owner's amendment, and he was right)

`utcSafeShape()` and `createdAtInstant`'s double conversion in the export, and
the `at time zone` round-trip in `sessions/[id]`. All three were identity
round-trips only while the session zone is GMT. The export now uses a plain
`select()` and returns the same ISO-8601 Z strings — verified live: `set_logs`
id 31, raw `2026-07-12 22:23:13.511111-04`, exports as
`2026-07-13T02:23:13.511Z`, byte-identical to what the old shim computed.

`api/sessions/route.ts`'s husk predicate needs **no change** and never did — but
its comment did, because it explained the old hazard as though it were current.
Before 0035 it was correct only by coincidence: a JS Date bound compared against
a tz-less column resolved through the session zone, which happened to match the
zone `defaultNow()` wrote in — on prod because both are UTC, on the dev box
because both are Eastern. A host in a third zone would have made it hours loose,
silently. Both sides are now instants.

### Two corrections to the verification list

* **The volume checksum is 259046, not 236416.** 236416 was taken at 215 sets;
  prod now holds 245 after the Jul 28 session. The gate is "unchanged ACROSS the
  migration" (259046 → 259046), not equality with the older figure — asserting
  236416 would fail for a reason that has nothing to do with this change.
* **The 19:58 anchor lives on `first_finished_at`, not `finished_at`.** Log 3's
  `first_finished_at` is `2026-07-14 23:58:41+00` = 19:58 ET as expected;
  `finished_at` reads 00:53 ET because it is a last-modified stamp and was
  rewritten on Jul 28. Both columns are already `timestamptz` and neither is in
  this migration, so this is about which one to READ when checking the anchor.

### Applied to prod 2026-07-29

Run against the Neon DIRECT endpoint (`ep-spring-mode-atj10u3g`, not the pooler)
per the runbook, which reported `TimeZone = GMT` — so `current_setting('TimeZone')`
resolved to UTC there and the conversion added a label without moving a value.

Every gate met: types **13 tz-less → 0**, timestamptz **5 → 18**, date **9
unchanged**; migrations **35 → 36**; all nine row counts identical
(`set_logs` 245, `exercises` 878, `session_exercises` 78, `equipment` 19,
`workout_logs` 9, `programs` 2, `profile` 1, `cardio_logs` 1, `injury_flags` 0);
volume checksum **259046 → 259046**; anchor **222/222**; log 3 at **19:01 /
19:58 ET**; `set_logs` id 7 reads **`2026-07-14 23:01:31.206105+00`** — the
before-value with `+00` appended and nothing else changed.

**The deploy gap was proved harmless before pushing**, not assumed: the OLD
shim expression evaluated against the newly-converted columns returns byte-
identical strings to the new one (`2026-07-14T23:01:31.206Z` either way),
because `tstz at time zone 'GMT' at time zone 'UTC'` round-trips to the same
instant under a GMT session. So migrate-then-deploy had no window in which the
live build misread anything — the ordering was a preference, not a requirement.

Post-deploy the export now returns `created_at` as `2026-07-14T23:01:31.206Z`,
identical to `logged_at` on the same row — the 222/222 anchor visible directly
in the payload rather than only in a check.
