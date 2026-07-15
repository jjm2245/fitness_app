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
