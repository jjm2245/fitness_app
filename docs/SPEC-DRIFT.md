# SPEC-DRIFT.md — where the built system diverges from the spec's intent

**Purpose.** [`fitness-agent-spec.md`](fitness-agent-spec.md) is the
**authoritative statement of intent** and is human-owned. This file reports,
section by section, where the code has diverged from or outrun the spec — **what
the spec says vs. what is true** — so the owner can fold the real decisions into
the next spec revision.

This is a **signal, not a bug list.** The spec is not auto-synced to the code on
purpose: if it silently tracked reality it would stop being a check on the code
and drift would stop being information. Each item is a "did we mean this?" prompt
for the spec owner, **not** something an agent should "fix" by editing the spec.

---

## Status: current as of v0.6 — clean slate

**The spec is v0.6.** Every drift item this file previously tracked (the
`Machine`→`Equipment` type-vs-instance model + additive offset, `pulley_ratio`
excluded from load math, RIR→effort-tag, the session-v2 / occurrence model, the
rest-edge / drop-set / side / timestamp fields, `load` as effective total, the
substitution division of labor + `SUBSTITUTION-JUDGMENT.md`, the opaque lane key +
recalibrate-with-continuity + unspecified-gets-its-own-lane, the
`defaultLoadIncrement`-keys-on-`load_type` impurity, and the §15 status
delegation) was **folded into v0.6** — see its "What changed in v0.6" section.
There is **no open drift** between the built system and the spec right now.

**Deliberately-deferred items are not drift** — they're recorded as intent in the
spec and tracked live in [`CURRENT_STATE.md`](CURRENT_STATE.md) §9: the agent
layer (§15 M3), recovery/nutrition/body/dashboard (§10–§12, Phase 3–5), form
analysis (§12a, Phase 6), and the per-unit-increment refinement (§7). Building
those is on-plan, not divergence.

---

## How to use this file going forward

When the build next outruns v0.6 — a schema change, a new model decision, a
behavior that contradicts what the spec says — **append it here** under a
`## §N — <topic>` heading, framed as "spec says X / built is Y / did we mean
this?". Do **not** edit the spec to match. When the owner cuts the next spec
revision, they fold these in and this file returns to the clean-slate state above.

_(Nothing to fold in as of v0.6. Add new drift below.)_

## `workout_logs.finished_at` is named for a fact it stopped carrying

The spec's session lifecycle (§7a) treats finishing as a single event, so one
`finished_at` was enough. The built system allows **re-finishing** — reopening a
finished session, logging more, finishing again — and each re-finish re-stamps
the column. `first_finished_at` was added as the stable anchor once that started
jumping edited sessions to "today" in History.

The result is a column whose NAME says "when this session finished" and whose
VALUE means "when this session was last touched". Four of eight prod sessions
have the two diverged; the worst is eleven days apart.

Nothing is broken — every reader now uses `first_finished_at`, and the export
labels the two separately (`session_ended_at` / `session_last_updated_at`). But
the schema still reads as if a session finishes once. A rename to
`last_finished_at` (or `updated_at`) was proposed and declined: pure-rename
migration, four insert sites, the sync payloads, the IndexedDB shape and the
`ServerSession` interface, for zero behaviour change.

Recorded here so the next spec revision can name the lifecycle it actually has:
a session ends once and can be amended many times.

## Instants are stored in `timestamp WITHOUT time zone`

Most timestamp columns in this schema (`created_at`, `updated_at` on every
table) are `timestamp` with no zone. They hold a wall clock written by `now()`
under whatever the database's `TimeZone` happens to be — GMT in prod,
America/New_York on the local dev database. Nothing in the value records which.

This is why the same class of bug keeps reappearing, three times now:

1. `login_attempts.created_at` compared against a JS `Date` was ~4h off, and was
   fixed by making that one column `timestamptz` (DECISIONS, earlier).
2. The JSON export shifted every `created_at` by the exporting host's UTC
   offset, because node-postgres parses a tz-less column in the running
   process's timezone.
3. The `first_finished_at` guard compared against a raw `created_at` and was
   four hours looser than intended on a non-UTC host.

Each was fixed narrowly and correctly, and each fix has to be remembered
independently. The spec never says instants are zone-less — it says a session
has a start and an end, which are moments in time.

**A proper fix** is `ALTER TABLE … ALTER COLUMN created_at TYPE timestamptz
USING created_at AT TIME ZONE current_setting('TimeZone')` across every affected
column: mechanical, one-way, and correct because the `USING` clause reads the
value under the same setting that wrote it. It touches ~12 columns on 20 tables
and changes the type every query returns, so it needs its own round with real
verification — not a rider on a feature change.

Recorded here rather than done: the drift is that the schema models wall clocks
where the domain means instants.
