# SUBSTITUTION-JUDGMENT.md

**What this is:** the *soft-preference* substitution judgment that the
deterministic engine can't derive — extracted here as durable prose so it can't
rot. Distilled from the hand-curated `exercise_substitutions` table (see the
provenance note at the bottom).

**Why it lives here and not in the table:** the table references exercises **by
name**, and names change (exercises get split, merged, renamed). An inert table
nobody reads would silently rot until its notes pointed at exercises that no
longer exist under those names. Humans and the future agent layer will read
`docs/`; they won't read a decaying table the engine ignores. So the *judgment*
lives here; the table is documentation-only (see CURRENT_STATE §9).

**Scope — this is soft preference, not a hard rule.** Hard exclusion (an injury
that makes a movement unsafe) is already enforced in code: the substitution
engine filters candidates by `affectedStructures[]` (e.g. `lumbar_spine`), and
`injury_flags` gate what's offered. Nothing below is a safety *gate*. It's the
"all else equal, prefer this" coaching context — the kind of judgment an LLM
coach should weigh, and that the pattern+muscle+equipment engine has no way to
know on its own.

---

## The one real theme: back-friendly substitution

Nearly all of the genuine judgment in the curated list is about **protecting the
lumbar spine** — swapping a spine-loading movement for one that trains the same
muscles with less axial/shear load, *specifically when the back is flaring up*.
The engine can match muscles and pattern; it can't know "prefer the version that
spares the lower back today." That preference is the asset.

**When the back is flaring, prefer these stand-ins:**

| Instead of… | Prefer… | Why |
|---|---|---|
| Smith / barbell squat | **Leg press** | Same quad loading, back-supported — preferred if the back flares. |
| Stiff-legged deadlift / RDL | **Machine leg curl + hip thrust** (split the hinge) | Trains hamstrings and glutes separately without loading a hinge; preferred if the back flares. |
| Stiff-legged deadlift | **Lighter DB RDL**, or a **45° back extension** | Reduce spinal load / when there's no hinge tolerance at all. |
| Seated cable row | **Chest-supported machine row** | Removes the torso as the stabilizer — preferred if the back flares. |
| Seated back-extension machine | **Glute bridge / hip thrust**, or **bird-dog / dead-bug** | Posterior-chain and anti-extension core work at low spinal load. |
| Seated leg curl | **DB / Smith RDL** | Works, but note: this *adds* lumbar load — the opposite direction, so only when the back is fine. |

**Rotation / oblique work — the lumbar-safe alternative:**

| Instead of… | Prefer… | Why |
|---|---|---|
| Rotary-torso machine | **Cable Pallof press** (anti-rotation) | Trains the obliques by *resisting* rotation instead of forcing loaded spinal rotation — safer for the lumbar spine. |
| Weighted Russian twist | **Cable Pallof press** | Same reason — anti-rotation over loaded rotation is safer for the lumbar spine. |

That's the whole judgment corpus: **prefer back-supported or anti-rotation
variants when the lower back is the limiting factor.** Everything else in the
curated table (travel/band versions, free-weight equivalents, "machine
available" swaps) is mechanical equivalence the engine already reproduces from
pattern + muscle + equipment, and is deliberately *not* carried here.

---

## For the future agent layer

When exercise-selection judgment gets an LLM/agent layer (Phase 3+, deferred),
this is the shape of context to feed it: a **soft preference keyed on a
transient state** ("back flaring today") rather than a permanent attribute.
Model it as a preference/penalty the agent weighs, not a filter — the hard
filter (`affectedStructures` + `injury_flags`) already exists below it in the
deterministic core.

---

## Provenance

Distilled from `exercise_substitutions` (71 hand-curated rows,
`candidate_exercise_id` all null — the engine never reads them). Six rows carried
explicit safety notes ("safer for lumbar", "preferred if back flares", "lumbar
load — see back caution"); several more carried back-friendly `when_context`
values. Those are captured above. The table itself is retained as
documentation-only; see CURRENT_STATE §9 and DECISIONS.md.
