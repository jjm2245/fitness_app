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

## Status: v0.6 — six open drift entries

**The spec is v0.6.** Every drift item this file previously tracked (the
`Machine`→`Equipment` type-vs-instance model + additive offset, `pulley_ratio`
excluded from load math, RIR→effort-tag, the session-v2 / occurrence model, the
rest-edge / drop-set / side / timestamp fields, `load` as effective total, the
substitution division of labor + `SUBSTITUTION-JUDGMENT.md`, the opaque lane key +
recalibrate-with-continuity + unspecified-gets-its-own-lane, the
`defaultLoadIncrement`-keys-on-`load_type` impurity, and the §15 status
delegation) was **folded into v0.6** — see its "What changed in v0.6" section.

**Open as of 2026-07-29 (6 entries), plus 2 closed by the build.** They differ in
weight — one is a promised mechanism that cannot fire, one is a behavioural
question, and two are notifications:

| Entry | Weight | State |
|---|---|---|
| §7 — regression unreachable on bodyweight lanes | **highest** | Open. The spec promises a deload trigger that *structurally cannot fire* on Pullups / Dips / Captain's Chair. Resolution known, deferred to the agent layer. |
| §7 / §1 — PR detection vs the spec's deprioritisation of PRs | **behavioural** | Open, and the one needing a human judgement rather than a decision about wording. |
| §7 — an absent effort tag is read as at-target | medium | Open. Biases `true_stall` / `increase_load` toward firing; not fixable by rules. |
| §7 — set-counting uses three emphasis tiers, not the spec's two | medium | Open. The build is the better of the two; the sentence is what's wrong. |
| §6 — `timeline_notes` outruns the spec | low | Open — a notification. New schema to name; no behaviour the spec would object to. |
| `workout_logs.finished_at` named for a fact it stopped carrying | low | Open **deliberately.** The label is already correct at every read site; a rename is a migration for a name. |
| Instants in `timestamp WITHOUT time zone` | — | ✅ closed by migration 0035 |
| `updated_at` mixes two clocks | — | ✅ closed by migration 0035 |

*(This block previously read "there is no open drift", which stopped being true
the moment the `finished_at` entry was appended below it. Keep it in step with
what the file actually contains.)*

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

_(Six entries to fold in at the next revision — see the table above.)_

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

---

## §7 — Set-counting uses three emphasis tiers, not the spec's two

**Spec says.** §7: *"a working set counts 1.0 for the primary muscle and 0.5 for
meaningful secondaries; warm-ups count 0."* Two tiers, stated as a fixed rule
because "without a fixed rule the volume landmarks are meaningless."

**Built is.** The seed JSON's `emphasis_convention` declares **three** tiers —
1.0 primary / 0.5 meaningful secondary / **0.3 minor secondary** — and it was
hand-tagged that way. `src/db/seed.ts` stores the per-relation value verbatim in
`exercise_muscles.emphasis`, and `countedSetContribution()` in
`src/core/volume.ts` sums that stored value directly rather than flattening every
secondary to 0.5.

**This was intentional, not an oversight.** The call was made in the first
session and recorded under *"Seed loader (spec §6, seed file's own notes)"* in
[`DECISIONS.md`](DECISIONS.md): the three-tier tagging is *"strictly more
information and clearly intentional in how the seed was hand-tagged."* That
reasoning still holds — flattening 0.3 to 0.5 would invent emphasis the tagger
did not intend, and dropping it would discard a distinction they made on purpose.

**Why it is recorded here anyway.** Standing rule: spec-versus-reality
divergence belongs in this file so the spec owner can fold it into the next
revision. It never got an entry, and has been live since the first session with
only that `DECISIONS` note. It surfaced again while writing the Stats inventory
in [`CURRENT_STATE.md`](CURRENT_STATE.md) §10, which documents it for readers
with **the code as authoritative** — correct for someone building a screen, but
that is a reader-facing note, not a signal to the spec owner. This is the signal.

### The concrete consequence

Production carries **35 `exercise_muscles` rows at emphasis 0.3, across 22
exercises — and 14 of those 22 appear in actual logged history**, i.e. half the
28 exercises ever trained. This is not a theoretical corner:

| Exercise (logged) | 0.3 relation |
|---|---|
| Hack Squat | calves, hamstrings |
| Smith Machine Stiff-Legged Deadlift | forearms, lats, upper_traps |
| Machine Shoulder (Military) Press | upper_traps |
| Butterfly | anterior_deltoid |
| Pullups | mid_traps |
| Wide-Grip Lat Pulldown | rhomboids |
| Machine Preacher Curls / Standing Biceps Cable Curl | brachialis |
| …and 6 more | |

**The spec's sentence is ambiguous for a 0.3 relation, and BOTH resolutions
disagree with the code.** A reader implementing §7 literally must decide whether
a minor secondary is a "meaningful secondary":

- read as **not** meaningful → contributes 0 → total is **0.3 lower per counted
  set** than `volume.ts` returns;
- read as **a** secondary → contributes 0.5 → total is **0.2 higher**.

Either way the number disagrees, and neither reader would know it. **This is the
thing a Stats surface or an LLM summary would get wrong by trusting the spec
sentence** — it would produce a muscle-week total that looks plausible, sits
beside `VOLUME_LANDMARKS` (floor 8, productive 10–20) as though comparable, and
silently misplaces a muscle relative to its landmark. The failure is quiet: no
error, just a wrong zone.

**Not changed, deliberately.** The spec, the seed and `volume.ts` are all
untouched — intent is human-owned, and the built behaviour is the better of the
two. What is owed is a **spec revision naming the third tier**, so the sentence
and the code stop disagreeing. Until then: **use `volume.ts`, not the sentence.**

---

## §7 — Regression detection is structurally unreachable on bodyweight lanes

**Spec says.** §7 line 229: *"regression across 2+ sessions → fatigue → deload /
reduce load"*, and line 240 makes it a deload trigger: *"**Deload triggers
(any):** 2+ sessions of regression; …"*. Stated unconditionally — no carve-out
for any class of exercise.

**Built is.** The trend runs on volume-load. `sessionVolumeLoad()`
(`src/core/progression.ts`) is `Σ(load × reps)`, and the test is
`lastThree[0] > lastThree[1] && lastThree[1] > lastThree[2]`. On a bodyweight
lift `load` is 0 by design (load measures what was *added* to the body — see the
closed bodyweight decision), so every session's volume-load is identically 0 and
`0 > 0 > 0` is never true.

**Pullups, Dips and Captain's Chair therefore have no fatigue signal and no
deload trigger at all** — not a weak one, an unreachable one. Confirmed in prod:
all 25 sets across those three exercises carry `load` min 0, max 0.

The spec promises a safety mechanism that a whole class of trained exercises
cannot reach, and nothing in the app says so. That is the drift.

**The resolution is already known** and is not lost: a static bodyweight and a
rep-only trend are *the same computation* — multiplying every set by a constant
cannot change the direction of a comparison, so a constant multiplier makes the
trend purely rep-driven. One change, and it needs **no stored bodyweight**, which
matters because storing one would make every historical set's volume depend on a
weight measured today. Deferred to the agent-layer round.

See [`DECISIONS.md`](DECISIONS.md) 2026-07-28 ("deferred to the LLM phase") and
[`CURRENT_STATE.md`](CURRENT_STATE.md) §9.

---

## §7 — An absent effort tag is read as at-target

**Spec says.** §7 line 210: the 3-point tag (`more_in_me | near_failure |
to_failure`) is the primary signal and *"exact `rir` remains optional"*. The spec
is **silent on what absence means** — it says the precise number is optional, not
that a missing tag should be treated as any particular effort.

**Built is.** `(s.rir ?? context.targetRir) <= context.targetRir` — at
`progression.ts:83`, `progression.ts:118` and `stallBuster.ts:33`. A set with no
effort recorded resolves to *the target*, i.e. is assumed to have been taken to
the intended effort. Both `true_stall` and `increase_load` require
at-or-below-target effort, so the assumption biases them **toward firing**.

**The scale, stated honestly — and it is volatile, not fixed.** 71 of 244 sets
carry a tag overall (**29%**). Per session it swings widely rather than trending:

| Session | 07-14 | 07-16 | 07-17 | 07-18 | 07-21 | 07-23 | 07-25 | 07-28 |
|---|---|---|---|---|---|---|---|---|
| tagged | 7% | 0% | 0% | 47% | 59% | 30% | 26% | **66%** |

Across the last four sessions it is **45%**, not the ~65% a glance at the most
recent session suggests. Exposure may well be shrinking, but with eight sessions
and that variance it is **not yet demonstrated** — 66% is one session, not a
trend. Treat 29% as the historical figure and expect it to move.

**Why it is not simply fixed.** The alternatives are *keep assuming* (biased
toward action) or *stop assuming* (the engine goes mostly silent on the majority
of sets). Neither is a threshold problem. Effort **cannot be inferred** from
these logs: within-session rep decay was investigated as a proxy and **rejected**
— the owner logs to a rep target rather than to failure, so 10/10/10 is the
expected shape of an easy session and a hard one alike and carries no effort
information. Recorded so the proxy is not rediscovered.

See [`DECISIONS.md`](DECISIONS.md) 2026-07-28 and
[`CURRENT_STATE.md`](CURRENT_STATE.md) §11.

---

## §7 / §1 — PR detection sits against the spec's deprioritisation of PRs

**Spec says.** PRs are deprioritised in all three places they appear:
line 5, *"goal = muscle gain with recomposition … **not strength/PRs**"*;
line 47, *"your goal (aesthetics/hypertrophy, **no barbell PRs**)"*; and
line 236, the stall-buster is *"framed as 'keep overloading to keep growing,'
**not 'hit a PR.'**"*

**Built is.** Per-lane weight PR detection (2026-07-29): a `★ PR` chip on the set
row, a `best … · date` line in the card header, and a gradient wash on the row at
the moment one is logged.

**The defence is genuine, and is recorded first because it is the stronger
reading.** A per-lane machine best is a **progressive-overload marker, not a
powerlifting PR** — and progressive overload is the hypertrophy mechanism the
spec itself runs on. The spec is rejecting *strength as a goal* and *barbell
PRs as an ambition*, not the observation that a load went up on a machine. The
detection is deliberately weight-only and lane-scoped; rep records were
considered and rejected by the owner as "not what PR means".

**The tension worth weighing at the next revision is behavioural, not
technical.** The chip fires on **load alone**, so `190 × 6` after `180 × 9`
registers as a PR even though it may be the worse hypertrophy set — fewer reps,
less volume-load, possibly a shorter time under tension. A celebration attached
purely to load can pull training toward heavier-and-fewer, which is exactly the
drift the spec's PR language exists to prevent. The feature may therefore be
correct in mechanism and still push behaviour the wrong way.

Two mitigations exist. **Neither is proposed here** — this is a signal, and the
choice is the owner's: gate the PR on reps staying within the target range, or
mark **volume-load** bests instead of weight bests. Nothing has been changed.

---

## §6 — `timeline_notes` outruns the spec

**Spec says.** Nothing. There is no timeline-note concept and no dated-annotation
model anywhere in v0.6.

**Built is.** A `timeline_notes` table (migration 0034): a date range with a
**nullable open end** meaning *still ongoing* rather than unknown, a free-text
body, and a loose `kind` that is a suggestion rather than a controlled
vocabulary. Rendered as span rails down the History gutter. It exists so that a
gap in `workout_logs` is **interpretable**: two weeks of silence otherwise looks
identical whether the owner was ill, deloading, travelling, or had stopped.

**Low stakes, and worth saying so plainly.** It is **inert by construction** —
`grep -rn timeline src/core/` returns nothing, and that is the entire reason it
is a separate table from `injury_flags`. `injury_flags` **does** reach the
engine: `loadActiveInjuryStructures()` in `src/lib/coreAdapters.ts` feeds
`src/core/substitution.ts:23`, where a candidate is excluded if its
`affectedStructures` intersect an active flag. A row meaning "on holiday" landing
in that table would silently remove exercises from substitution.

So this entry is a **notification, not a concern**: new schema the spec should
name at the next revision, carrying no behaviour the spec would object to. See
[`DECISIONS.md`](DECISIONS.md) 2026-07-28 (timeline notes) for the
injury-flags-vs-timeline-notes separation.
