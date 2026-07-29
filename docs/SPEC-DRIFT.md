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

When a drift is closed by a change to the BUILD rather than by a spec revision,
mark its heading `✅ RESOLVED (migration NNNN)` and append a resolution section —
**don't delete the entry.** The original reasoning is why the fix was worth
doing, and a deleted entry reads as though the problem never existed. A resolved
entry needs nothing from the spec owner at the next revision: the build has come
back to what the spec already meant.

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

## ✅ RESOLVED (migration 0035) — Instants are stored in `timestamp WITHOUT time zone`

> **Closed 2026-07-29 by migration `0035_timestamptz`.** All 13 tz-less columns
> across 9 tables are now `timestamptz`; the three read-site shims that existed
> to supply the missing zone were removed in the same round. The entry below is
> kept as written, because the reasoning is what justified the migration and the
> next person deserves to see it. Resolution notes are at the end.

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

### ✅ Resolution — migration `0035_timestamptz`, 2026-07-29

Done as described above, including the `current_setting('TimeZone')` USING
clause. That detail turned out to be load-bearing rather than stylistic: the
approved brief specified a literal `AT TIME ZONE 'UTC'`, which is correct on
prod (Neon reports GMT) but would have shifted every local row four hours,
because the dev database runs America/New_York — and migrations run local-first,
so the hardcoded version would have corrupted the rehearsal meant to validate
it. The local run showed values byte-identical with only the correct `-04`
offset added.

Scope: 13 columns, 9 tables, 1,233 rows. **The nine `date` columns were
deliberately excluded** — `workout_logs.date`, `body_metrics.date`,
`timeline_notes.start_date`/`end_date`, `profile.dob` and the rest are calendar
dates, not instants. A weigh-in on Jul 27 is Jul 27 in every zone; converting
one would have introduced the very bug this removed.

Verified on prod: every row count unchanged, volume checksum 259046 either side,
the `created_at` ↔ `logged_at` anchor still 222/222, and workout log 3 still
reading 19:01 / 19:58 America/New_York. Values gained a `+00` label and moved by
nothing.

The three narrow fixes this entry complained about having to remember
independently are gone: `utcSafeShape()` and the export's double conversion, and
the round-trip in `sessions/[id]`. The husk predicate in `sessions/route.ts`
needed no code change but had its comment corrected — it was previously right
only because the writing zone and the comparing zone happened to match.

### ✅ RESOLVED (migration 0035) — Addendum: `updated_at` mixes two clocks in one column

Same root cause as the entry above, recorded alongside it rather than patched
separately. The `updated_at` columns on `exercises`, `programs` and `profile`
are `timestamp WITHOUT time zone`, and they get written two different ways:

- `defaultNow()` on insert — the DATABASE's clock, under the database's
  `TimeZone` (GMT in prod).
- `updatedAt: new Date()` from the API routes (`exercises/[id]`,
  `exercises/custom`, `profile`, `programs`) — a JS Date, serialized in the
  RUNNING PROCESS's zone.

On Vercel both are UTC and agree. Anywhere else they don't, so a single column
ends up holding values from two clocks with nothing recording which is which.

**Deliberately not patched.** Converting each write site would be four one-off
fixes that leave the column still zone-less; the real fix is the `timestamptz`
migration described above, which resolves this and the other three instances of
this bug together. These columns are informational — nothing compares or
displays them — so the cost of waiting is zero.

### ✅ Resolution — migration `0035_timestamptz`, 2026-07-29

Resolved by the migration, and **not by changing a single write site** — which
is the part worth stating, because it explains why waiting was right.

Two writers were never the defect. Mixed provenance only mattered because the
column could not record a zone: a `timestamp` stores a wall clock and discards
the offset, so a value written by `now()` under GMT and one written by
`new Date()` under some other process zone become indistinguishable the moment
they land. The column threw away the only thing that could have told them apart.

`timestamptz` normalises on write. Both writers now resolve to the same instant
regardless of which zone produced them, so `defaultNow()` and
`updatedAt: new Date()` can coexist in one column with nothing ambiguous about
the result. The four one-off fixes this entry declined to make were correctly
declined — they would have papered over a storage problem at the call sites.

Confirmed empirically before migrating rather than assumed: across 878
`exercises` rows, no `updated_at` / `created_at` delta fell in the hour-scale
band an offset mismatch would produce, and the app-written and DB-written
values from the same seed run landed 95 ms apart. Both writers had in fact been
agreeing, because Vercel runs UTC — but that agreement was a property of the
deployment, not of the schema. Now it is a property of the schema.
