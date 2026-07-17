# Fitness Optimization Agent — Scope & Build Spec (v0.6)

**Vision:** A private, single-user app whose core is an *agent* that designs and continuously re-optimizes your training against evidence-based principles, adapts in real time to changing constraints (travel, limited equipment, fewer days, a tweaky joint), and — over later phases — folds in recovery, bodyweight, nutrition, and progress photos to steer your whole physique trajectory.

**User profile:** male, born 1999 (age computed from DOB); ~170 lb, 5'11" (lean-normal, BMID ~24); training age < 1 year (novice); goal = muscle gain with recomposition (build muscle, lose/hold fat, aesthetics-first, not strength/PRs); trains 6 days/week PPL, ~1 hr lifting + 15–30 min abs/cardio per session, at Planet Fitness; minor non-hindering back discomfort; deployment = **mobile-first PWA, personal use, single user**.

### What changed in v0.6
Folded in the real decisions from the build (source: `SPEC-DRIFT.md`). The system outran this document; v0.6 restates intent to match.
- **§6 — `Machine` → `Equipment`**, with a **type-vs-instance** model, an **additive built-in offset** (superseding v0.5's "counterweight" framing), and `pulley_ratio` **captured but deliberately excluded from load math**.
- **§6 — RIR → effort tag** (`more_in_me | near_failure | to_failure`) as the primary signal; exact RIR is optional.
- **§6 — session-v2 / occurrence model**: a session is a *thing you start*, not a calendar day; ordered occurrences with repeats.
- **§6 — rest as an edge** (N sets ⇒ N−1 rests), plus drop sets, unilateral sides, and set timestamps.
- **§6 — `load` is the effective total** (`entered + built-in offset`), components stored.
- **§5/§8 — substitution division of labor stated**: the engine *computes* candidates; the curated list is inert and its **notes are LLM-material** (`docs/SUBSTITUTION-JUDGMENT.md`).
- **§8/§9 — the opaque lane key**: how "loads are context-bound" is enforced without equipment concepts leaking into the core; plus **recalibrate-with-continuity** and unspecified-gets-its-own-lane.
- **§15 — status delegated to `CURRENT_STATE.md`**; the spec keeps milestone *definitions* only.

### What changed in v0.5
- **Build status recorded** (§15): Milestones 1, 2, and 4 built and verified; the deterministic core was audited and confirmed **fully general / data-driven** — no routine baked into engine logic.
- Added **§7a Program management** — a program is user-owned editable data, not app structure; program create/edit is the next build step so the routine stops being a seeded default.
- Logged two **known non-fatal leaks** from the build (a blanket default program in the seed loader; a `DAY_ORDER` sort literal in the program API), both in the seed/API layer and both slated for the next session.

### What changed in v0.4
- Added **video form analysis** (§12a) as a later phase — on-device pose estimation for objective metrics + a vision-model pass for gross-error coaching. Scoped honestly: an assistive check, **not** a form verdict or injury clearance.

### What changed in v0.3
- Added a **Planet Fitness equipment preset** (§8a) — no loadable barbell/rack; Smith machine is the primary barbell-like tool; dumbbells + fixed bars are the true portable anchors; toggles for location variation.
- **Progression metric is now volume-load (load × reps)**, not estimated-1RM — more valid in hypertrophy rep ranges and on machines/Smith.
- Added **recomp/lean-bulk/cut modes**, a **protein target**, a **calorie seed → empirical correction** method, and a **logging-completeness check** (§11).
- Added **RIR calibration** (occasional to-failure sets to anchor perception), a **per-session volume budget** (~60 min), **balance constraints**, a **fractional set-counting rule**, a **cold-start** phase, **layoff/return** handling, **ongoing-injury/contraindication** logic, and a **linear-progression exit plan** (novice→intermediate).
- Reinforced the **aesthetics-first dashboard** framing (a flat scale during recomp is success, not failure).

---

## 1. How your profile shapes the product

Defaults the engine ships with, to revisit as you advance:

- **Volume:** start each muscle ~8–12 hard sets/week; let progression, not volume inflation, drive early gains. Reserve ~16–20+ for genuine stalls.
- **Frequency:** ~2x/muscle/week. Your 6-day PPL delivers this; the engine optimizes *within* your 6 days rather than fighting your preference, and leans on recovery data to catch over-reach.
- **Progression:** double-progression, measured by volume-load (see §7). Rising reps at a fixed load is progress, not a stall.
- **Proximity to failure:** most working sets at ~1–3 reps short of failure — logged as an **effort tag**, not a number (§6). *Not* every set to true failure (too costly on a 6-day split). Reserve true failure for safe isolation/machine work, and use it periodically to calibrate perception (see §7).
- **Protein:** ~1.6–2.2 g/kg (~150–170 g/day for you) — the biggest hypertrophy lever after energy balance.
- **Split:** your 6-day PPL is respected; split becomes a *tunable output* only when days change (see §7, §8).
- **Adherence > cleverness:** remove friction from logging and progression first.

> Your gym (Planet Fitness) and goal (aesthetics/hypertrophy, no barbell PRs) are well-matched — PF's machine-and-Smith setup covers every movement pattern and is more than enough for muscle growth. The only real ceiling is heavy barbell strength, which you've said you don't care about.

---

## 2. Core use cases (requirements the build must satisfy)

1. **Travel / limited equipment** — swap exercises for what's available, preserving weekly stimulus per muscle; progress via effort/volume, not identical loads.
2. **Progress photos + history-based diet guidance** — derive maintenance from intake vs. weight trend; nudge intake toward the goal; photos as a trend check.
3. **Central health dashboard** — training + nutrition + Oura (sleep, steps, HRV, readiness) as transparent sub-scores, not one opaque rank.
4. **Calorie cross-validation** — reconcile screenshot/manual entries against a tiered source-of-truth (incl. eating out), with confidence flags.
5. **Stall-buster** — detect true stagnation (reps *and* load flat at target effort) and push a concrete intervention.
6. **Equipment-aware loads** — account for equipment type, per-unit built-in weight, and pulley ratio so a stack number isn't treated as universal (§6, §9).
7. **Fewer-days restructuring** — reshape the split when you train <6 days to still hit each muscle ~2x.

Plus the scenarios surfaced in review: **cold start** (first weeks, no history), **layoff/return** (detrain → ramp back), **ongoing injury** (weeks-long work-arounds, contraindication-aware), and **linear-progression exit** (when novice progression stops working).

---

## 3. Scope & phases

| Phase | Ships | Why this order |
|---|---|---|
| **1. Programming agent + logging** | Program from goal + days + PF equipment; live substitution; fast offline-capable logging; auto progression | Core loop; immediate value |
| **2. Progression intelligence** | Volume-load progression, stall detection, deload prompts, per-lane tracking, effort calibration, balance checks | Turns logs into coaching |
| **3. Recovery + body metrics** | Oura pull (sleep/HRV/readiness/steps); bodyweight with trend smoothing; standardized progress photos | Cheap, motivating; feeds deloads + calorie model |
| **4. Nutrition** | Screenshot/manual logging with tiered source-of-truth; recomp calorie/protein model; food-photo estimation | Hardest accuracy problems |
| **5. Whole-system optimization + dashboard** | Agent reads training + recovery + weight + intake + photos together; recomp guidance; sub-score dashboard | The original vision |
| **6. Form analysis (video)** | On-device pose estimation (reps, depth, tempo, ROM, symmetry) + sampled-frame vision coaching for gross errors | Highest-value on free lifts; strong accuracy/safety caveats — build last |

**MVP = Phase 1.**

---

## 4. System architecture (mobile-first, single-user)

Thin mobile client over a small backend; the agent is three layers, not a chatbot.

```
  ┌───────────────────────────────────────────────┐
  │  Mobile client — installable PWA               │
  │  - home-screen app, offline logging            │
  │  - camera: food photos, screenshots, selfies   │
  │  - IndexedDB cache → syncs when back online     │
  └───────────────┬───────────────────────────────┘
                  │ HTTPS
  ┌───────────────▼───────────────────────────────┐
  │  Reasoning layer (Claude API, server-side)     │
  │  - interprets fuzzy input; explains rationale  │
  │  - picks among substitution candidates         │
  │  - parses screenshots / food photos (vision)   │
  └───────────────┬───────────────────────────────┘
                  │ tool / function calls
  ┌───────────────▼───────────────────────────────┐
  │  Deterministic core (backend code)             │
  │  - volume math, volume-load progression        │
  │  - substitution filtering, per-LANE tracking   │
  │  - stall + deload logic, balance checks         │
  └───────────────┬───────────────────────────────┘
                  │ reads / writes
  ┌───────────────▼───────────────────────────────┐
  │  Data layer + scheduled jobs                   │
  │  - exercise/equipment graph; logs; body; intake │
  │  - daily Oura pull; food-DB lookups             │
  └───────────────────────────────────────────────┘
```

**Why a PWA fits here:** the usual PWA weakness (deep phone-health integration) doesn't bite — Oura comes from its cloud API via your personal token, pulled server-side. Camera capture works in the mobile browser. Wrap with Capacitor later only if you want a store install.

---

## 5. The agent design (deterministic vs. LLM)

| Task | Owner |
|---|---|
| Volume targets, volume-load progression, stall/deload logic, balance checks, calorie seed math | Deterministic |
| Lane grouping + re-baselining (via an **opaque lane key** — the core never learns what a Smith is, §8b) | Deterministic |
| Substitution candidate filtering (pattern + muscle + equipment + contraindications) | Deterministic |
| Substitution final pick + explanation; free-text constraint parsing; symptom/readiness interpretation | LLM |
| Screenshot → structured macros; food photo → range+confidence estimate | LLM (vision) |
| Coaching / motivation voice | LLM |

**Orchestration:** backend tools (`get_program`, `compute_progression`, `find_substitutions`, `log_set`, `lookup_food`, `get_recovery`, `flag_readiness`); LLM plans, deterministic functions return ground truth, LLM narrates.

**Substitution — the division of labor, stated explicitly.** The **deterministic engine computes candidates** live from the graph (movement pattern + muscle overlap + available equipment + injury structures). The hand-curated candidate list is **not** the source and is deliberately left inert — resolving it would create a second, stale substitution source competing with the engine. What the engine *cannot* derive is **soft preference**: "leg press if the back flares", Pallof as the lumbar-safe rotation, chest-supported rowing when the back is cranky. That judgment is **LLM-material, not core-material**, and lives as prose in `docs/SUBSTITUTION-JUDGMENT.md` for the agent layer. Hard exclusion is already structural via `affected_structures` / injury flags.

---

## 6. Data model (single-user)

```
Profile
  dob, sex, height, goal_mode (recomp | lean_bulk | cut),
  training_age, available_days, equipment_profile (default: PF preset),
  activity_seed = sedentary (base; superseded by Oura), protein_target_g, preferences
  ← age computed from dob; activity derived from Oura when available

Exercise                     ← substitution graph
  id, name, canonical_name?, library_id?      ← one entry: library name displayed, curated tags kept
  movement_pattern (nullable ← untagged = unplaceable, excluded from volume/substitution)
  primary_muscles[]{muscle,emphasis}, secondary_muscles[]
  equipment_required[], load_type, portable
  affected_structures[]      ← contraindication matching (e.g. "lumbar_spine")
  unilateral, stability_demand, skill_level, stretch_emphasis, rep_range_default, description?

Equipment                    ← replaces v0.5's `Machine`; see the type-vs-instance note below
  id (surrogate), label (display name — names carry no data)
  equipment_type (bodyweight | dumbbell | kettlebell | fixed_barbell | olympic_barbell |
                  ez_barbell | cable | selectorized | smith | plate_loaded)
  built_in_weight            ← ADDITIVE offset the equipment contributes (Olympic bar 45,
                               PF Smith ~20, plate-loaded = unknown, not 0)
  pulley_ratio (1:1 | 2:1 | other | unknown)   ← captured; NEVER in load math (see below)
  manufacturer, location, description, notes

Program        split_type, days[]
ProgramDay     name, order_index               ← day order is data, not a code literal
ProgramExercise  exercise_id, target_sets, rep_range, effort_target, order
  ← reusable blocks (abs, cardio finishers) are ProgramDays under a hidden container program

WorkoutLog (a session)
  client_session_id (unique, client-owned)     ← a session is a thing you START, not a calendar day
  date                       ← STABLE; set at creation, never rewritten
  first_finished_at, first_finished_source     ← display time; user-editable
  finished_at                ← re-stampable (finish is not a one-way door); drives nothing user-facing

SessionExercise (an occurrence)               ← the ordered performed list
  client_instance_id, order_index, exercise_id, completed
  ← repeats allowed: the same exercise can appear at multiple positions

SetLog
  session_exercise_id        ← attaches to the OCCURRENCE, not just the exercise
  set_index, set_type (warmup | working)
  load_entered, builtin_offset, load          ← load = entered + offset (the effective total)
  reps
  effort (more_in_me | near_failure | to_failure)   ← PRIMARY signal
  rir?                       ← optional exact number; the adapter derives one when needed
  side (left | right | both)  ← unilateral exercises only
  drop_set_group?            ← links nested drop sets
  rest_seconds, rest_source (timed | derived | user)   ← restBefore; null on set 1 of an occurrence
  logged_at                  ← client-stamped; drives rest derivation
  equipment_type, equipment_id?, notes

CardioLog      workout_log_id, exercise_id, duration_min, incline/speed/distance/level?, notes
  ← its own table: the core reads only set_logs, so cardio is STRUCTURALLY invisible to volume math

BodyMetric     date, weight (7-day trailing average), measurements?
ProgressPhoto  date, pose, storage_ref (encrypted), notes
RecoveryMetric date, sleep, hrv, resting_hr, readiness, steps, active_kcal  (Oura)
NutritionEntry date, source, food_ref, kcal, protein, carbs, fat,
               source_tier (1|2|3), confidence, discrepancy_flag
FormCheck      date, exercise_id, view, metrics{...}, llm_cues[], confidence, flagged_issues[]
InjuryFlag     structure, severity, notes, active(bool)  ← seeds contraindications
```

The `Exercise` + `Equipment` graph is the asset that makes adaptation and equipment-aware loads possible. Seed from an open dataset (`free-exercise-db`, Unlicense); hand-enrich pattern/emphasis/affected-structure tags. **Curated and library entries are one pool** — the real distinction is **fully-tagged vs. untagged**, not "mine vs. theirs." An exercise graduates to first-class the moment it has a movement pattern; tagging happens **on add**, only for exercises actually used.

### The four model decisions worth stating

**1. Equipment = type + instance.** "Machine" was doing two unrelated jobs: *instance identity* (which unit — the same number means different resistance on different units) and *added weight* (the constant the equipment contributes). They're orthogonal, and different equipment needs different combinations: an Olympic bar has an offset but no instance value; a leg-extension machine is the reverse; a Smith needs both; dumbbells need neither. So: **equipment type is always a real answer; the unit selector appears only for context-bound types.** "Instance matters?" is the inverse of `portable`.

**2. Built-in weight is additive — this supersedes v0.5's `counterweight_lb`.** v0.5 framed a Smith bar as a *counterweight* that reduces load from 45. The built model states the same physical fact more usefully: the equipment **contributes** a constant you **add** to what you selected. `load = load_entered + builtin_offset`, components stored, math shown transparently ("90 + 20 bar = 110"). Standardized tools get real defaults (Olympic 45); unit-specific ones default to **unknown, never 0** (plate-loaded carriage weight), and a non-zero offset is **never auto-applied from a name keyword** — wrong-toward-zero costs nothing, wrong-toward-45 silently corrupts every set.

**3. `pulley_ratio` is captured but never computed with.** An *additive* offset doesn't cancel (90→100 with a 20 lb bar reads +11%, truly +9% — so it must be in the number). A *multiplicative* ratio **does** cancel (140→150 on a 2:1 reads +7.1%; true 70→75 = +7.1% — identical), because loads are lane-scoped per unit, so the ratio is constant within every comparison the engine makes. Folding it in would manufacture false precision (friction, routing, and cam aren't captured either). Its value is **interpretation for the agent layer**, not arithmetic.

**4. Effort tag over RIR.** A 3-point tag (`more_in_me | near_failure | to_failure`) is more honest to log mid-set than a precise RIR you don't actually know — and novices systematically misjudge RIR. Exact `rir` remains optional; the adapter normalizes the tag into whatever the core consumes. The user's anchor: failure = a rep you cannot complete.

---

## 7. Programming engine

**Volume landmarks** (per muscle/week), scaled by training age: floor ≈ 8–10 (novice start), productive ≈ 10–20, push higher only when stalled *and* recovery intact.

**Set-counting rule (fixes a hidden validity gap):** a working set counts 1.0 for the primary muscle and 0.5 for meaningful secondaries; warm-ups count 0. Without a fixed rule the volume landmarks are meaningless.

**Per-session volume budget:** fit each session to ~60 min including warm-ups and 2–3 min compound rests — roughly 5–6 working exercises. Don't overstuff; on a 6-day split the risk is junk volume, not too little.

**Progression — volume-load driven:**

```
signal = trend(Σ working-set load × reps) per lift, per LANE (§9)
- top of rep range across sets at target effort → add smallest load step, reset reps
- reps rising at same load → progress, continue
- load AND reps flat at target effort for N sessions (same lane) → TRUE STALL
- regression across 2+ sessions → fatigue → deload / reduce load
```

Volume-load is used instead of estimated-1RM because e1RM is unreliable in the 12–20 rep hypertrophy zone and on cable/Smith machines where resistance isn't constant.

**Effort calibration:** you define failure as a rep you cannot complete — a useful anchor, and the reason the effort tag works (§6). Most sets stop 1–3 short of that; periodically, on safe isolation/machine lifts, take a set to true failure to recalibrate perception, and flag chronic over- or under-shooting.

**Stall-buster:** fires only on a true stall, and **rules out an equipment/lane change first** (§9). Interventions in order: micro-load bump → add a rep target → add a set → adjust rest → deload-and-recharge. Framed as "keep overloading to keep growing," not "hit a PR."

**Balance constraints:** the optimizer checks push/pull balance and commonly-neglected muscles (rear delts, hamstrings, external rotators) and enforces exercise order + warm-ups — hitting set targets alone can still produce imbalance and injury risk.

**Deload triggers (any):** 2+ sessions of regression; low Oura readiness/HRV trend for several days; scheduled ~every 6–8 weeks.

**Cold start (first ~2 weeks):** no history to autoregulate on → conservative default loads, a short calibration phase to find working weights and anchor RIR, and no stall/deload logic until enough data exists.

**Layoff/return:** after a gap (travel, illness, ≥~7 days) → don't resume at prior loads; ramp back over a few sessions (reduced load/volume), since novices detrain quickly.

**Linear-progression exit:** novice session-to-session progression typically ends within ~6–18 months. When simple progression repeatedly fails across lifts despite good recovery, the engine flags the systemic transition to intermediate-style programming (weekly progression, more planned variation) — the model knows its defaults expire.

**Split selection:** function of `available_days`, holding ~2x/muscle. Fewer days → consolidate toward full-body/upper-lower on compounds covering multiple patterns; frequency preserved, weekly volume compresses, so prioritize highest-return compounds.

**Known impurity — `defaultLoadIncrement` keys off `load_type`.** This is the last taxonomy inside the core. It's defensible (a cable's smallest step differs from a dumbbell's, for *everyone* — it encodes no routine), but the Equipment model makes increment properly a **property of the unit**: this cable stack moves in 10s, that one in 5s. Intended end state (deferred until real per-unit increments exist): the adapter passes a per-unit increment and the core stops keying on `load_type` at all.

---

## 7a. Program management — routine as editable data

Core principle, reaffirmed after the v0.5 audit: **the engine is general; a program is data the user owns, not structure baked into the app.** The deterministic core was verified free of routine-specific literals — exercise IDs, day names, muscle names, and rep ranges live only in seed data and the `programs` / `program_exercises` tables.

**Structure:** `programs` → `program_days` (named, `order_index` — day order is *data*, never a code literal) → `program_exercises` (per-exercise targets). **Reusable blocks** (abs, cardio finishers) are program days under a hidden container program — same tested CRUD, no parallel concept. Attaching a block to a session is optional and skippable; **logging is the primitive, programs are optional scaffolding.** An ad-hoc exercise attaches to the *session*, never to a phantom program.

To make this true in practice (not just in the core), a program must be **creatable and editable in the app**, not only seeded:
- Pick exercises from the graph; group them into days; set per-exercise targets (sets, rep range, effort).
- Generic novice numbers (§1) may *pre-fill* a new exercise, but they are editable defaults — never a blanket value the engine depends on, and never a fixed policy.
- The current PPL routine is then simply "the first program the user created" — one instance of what a general engine supports. That is the intended separation.

The seed creates the initial program only when none exists — it must never wipe user edits.

---

## 8. Adaptation / substitution engine (use cases 1 & 7)

**Trigger:** free-text constraint → LLM → structured change (equipment loss, exercise-specific issue, time crunch, fewer days, injury).

**Resolution (deterministic candidates, LLM pick):**

```
candidates = Exercise where
    movement_pattern == original.movement_pattern
    AND overlaps(target_muscles, original.target_muscles)
    AND equipment_required ⊆ available_equipment
    AND affected_structures ∩ active_injuries == ∅     ← contraindication-aware
rank by muscle-emphasis similarity + skill match
LLM picks best 1–2 (informed by docs/SUBSTITUTION-JUDGMENT.md), preserves weekly volume, explains tradeoff
```

**Key property:** substitution preserves the weekly *stimulus*, not the load number. A travel week is a short **parallel track** — progress on effort/volume there, resume home numbers on return.

**Ongoing injury (not just one-time swaps):** an `active` InjuryFlag persistently excludes contraindicated movements by *affected structure*, not just movement pattern — so it won't propose a swap that's wrong for the specific issue.

### 8a. Your equipment reality — Planet Fitness preset

Verified for 2026: standard PF has **no loadable barbell, squat rack, or power rack** — Smith machines instead; dumbbells (typically to ~75 lb) and fixed-weight bars (to ~60 lb); cable/functional trainers; extensive selectorized machines. Some newer locations add half racks / plate-loaded stations (toggle).

Design consequences:
- **Smith machine = primary barbell-like tool** (squats, presses, RDLs, rows, hip thrusts). Fine for hypertrophy. But `load_type = smith`, `portable = false`, and its bar starts at ~15–20 lb (counterweight), so its numbers don't transfer to a real barbell.
- **Dumbbells + fixed bars = your true portable anchors** (`portable = true`). Note the ~75 lb dumbbell cap: you may outgrow DB pressing/rowing eventually → shift those toward reps/tempo/machines near the ceiling.
- **Default `equipment_profile` = PF standard kit**, with per-item toggles ("my location has a half rack," "dumbbells to 60," etc.) so recommendations stay flexible if your gym differs.
- The user also has **barbell access elsewhere** (Olympic bar, rack) — so Olympic barbell and hack squat are real, and free weights remain genuine portable anchors.

### 8b. The lane key — how context-binding is enforced without leaking into the core

The load-bearing abstraction that keeps §9 true *and* the core general:

```
laneKey(equipment_type, unit_id) →
    unit_id                    ← a named unit (context-bound)
    "<type>:unspecified"       ← a generic unit of that type (its OWN lane, not portable)
    null                       ← the portable lane (free weights / bodyweight; never re-baselined)
```

The adapter computes the key; the core receives an **opaque string**, groups by it, and re-baselines when it changes. **The core never learns what a Smith is.** No equipment types, offsets, or ratios in `src/core/*` — that's what makes "loads are context-bound" enforceable without equipment vocabulary contaminating the engine.

---

## 9. Equipment & load portability (use case 6 — verified)

A stack number isn't a universal unit of resistance. Single-pulley (1:1) ≈ stack weight at the handle; double-pulley (2:1) ≈ half. The PF Smith bar ≈ 15–20 lb, not 45. Friction, cable routing, and cam profiles (brand-dependent) shift it further. The ratio doesn't change whether a lift builds muscle — that's effort, overload, ROM — but it changes how load is *measured and compared*.

- Machine/Smith/cable loads are **context-bound**: every set carries a **lane key** (§8b); progression is tracked per lane and **re-baselines on change** instead of flagging a false stall.
- Free weights/bodyweight are the **portable anchors** (`null` lane — never re-baselined).
- **Effort and volume are the universal currency** when absolute load can't travel.

**Re-baseline means recalibrate, not amnesia.** Lane separation is *physics*; forgetting is a *choice*, and the wrong one. Switching units changes the **load reference**, not the **stimulus** — 3×10 near failure on unit A → 3×10 near failure on unit B is not a regression. So the app never says "no data, starting over"; it says *"recalibrating for this unit — you were at 140 on the other."* (Cross-unit conversion ratios are learnable later from effort-matched sets on both units — a derived stat, not core logic.)

**"Unspecified" gets its own lane, not the portable one.** Filing an unnamed Smith into `null` would promise comparability that doesn't exist (Smith loads don't transfer between units). So unspecified = *a generic unit of that type*, carrying the type-level default offset, in its own lane.

**Relabel is session-scoped.** Naming a unit mid-session reassigns *that session's* sets to it — within one session you're demonstrably on one unit. It does **not** backfill prior sessions; across weeks that's a guess.

---

## 10. Recovery inputs — Oura (Phase 3)

**Source:** Oura cloud API via a **Personal Access Token** (stored server-side; scheduled backend pull). No official one-click connector; community MCP servers exist if you later want conversational querying. Rate-limited — cache, modest windows.

**Data:** sleep, HRV, resting HR, readiness, steps, active calories, temperature.

**Uses:** (1) a recovery modifier on volume/deloads (down-trending HRV + rising resting HR + poor sleep → reduce volume or deload); (2) **activity input for the calorie model** (steps/active-kcal supersede the manual activity seed); (3) the dashboard.

**Honest caveat:** wearable recovery is a *readiness/adherence* signal, not a hypertrophy dial. It informs weekly volume and deload timing, not per-session set counts.

---

## 11. Nutrition & source-of-truth (use case 4, Phase 4)

**Goal mode = recomp** (default): eat around maintenance, high protein, expect a roughly flat scale while composition improves. Modes `lean_bulk` (small surplus, faster muscle + some fat) and `cut` are switchable — mode changes the calorie target and how the dashboard reads the scale. Recomp is unusually effective now because you're a novice (newbie-gains window); it's also the slowest route to visible muscle, an honest tradeoff surfaced in-app.

**Calorie model:**
- **Seed (cold start):** Mifflin-St Jeor from DOB-age/sex/height/weight × activity. Current seed for you (age 27, male, 5'11", 170 lb, **sedentary base** — desk job, minimal movement outside the gym): non-exercise maintenance ≈ **2,100–2,250 kcal**, with training/cardio burn added on top from Oura's measured active-calories rather than baked into a guessed multiplier. Recomp target ≈ maintenance; protein ≈ **150–170 g/day**.
- **Correction (empirical):** after ~2 weeks, recompute maintenance from 7-day intake average vs. bodyweight trend (and Oura active-calories). Empirical beats any formula — and because your base is sedentary but your training is frequent, letting Oura measure the real movement matters more here than assuming an activity bucket.
- **Logging-completeness check:** the empirical method biases low if you under-log; flag suspiciously low logged intake vs. expected before trusting the computed maintenance.

**Source-of-truth hierarchy (for cross-validation):**
- **Tier 1 (authoritative):** barcoded/packaged → USDA Branded + Open Food Facts (free); chain restaurants → chain's published data (legally required for 20+ location US chains) via Nutritionix (best US chain coverage), FatSecret (international), Suggestic.
- **Tier 2 (good estimate, portion-dependent):** generic/home foods → USDA FoodData Central.
- **Tier 3 (best-effort, flagged):** independent restaurants / mixed dishes → closest match or photo estimate with a wide range. No source of truth; say so.

**Cross-validation:** match each entry to the highest tier available; surface discrepancies (screenshot says 800, chain says 950). Even chain data is the standardized recipe, not your plate — the confidence label is the feature.

**Suggested stack:** USDA + Open Food Facts (free) + Nutritionix free developer tier for eating out (personal volume fits the free tier). Convenience aggregators (YMove, Calorie API) bundle a single key but mostly lack chain menus — keep Nutritionix for dining out.

**Photo estimation:** noisy (portion, hidden oils, mixed dishes worst) → range + confidence, one-tap correction, reason over trends, never a single meal as truth.

---

## 12. Body metrics, photos & dashboard (use cases 2 & 3)

- **Bodyweight:** reason over a 7-day trailing average; flag trend, not daily noise.
- **Progress photos:** standardized capture (same lighting/distance/pose/time, fasted); same-pose side-by-sides; camera works in the PWA.
- **Dashboard (aesthetics-first):** transparent sub-scores — training (volume/progression/adherence), nutrition (intake vs. target, protein hit), recovery (Oura) — with an optional roll-up, never one opaque "rank." Crucially, weight/size/strength don't move together in a recomp: a **flat scale with rising measurements and better photos is success, not failure**, and the dashboard must say so rather than privileging the scale.
- **Recomp logic (Phase 5):** agent reads weight-trend slope + intake + recovery + photo cadence for small, sane calorie nudges.

---

## 12a. Form analysis (video) — later phase (Phase 6)

An **assistive** form check, not a verdict and not injury clearance. Highest value on your free movements (Smith/DB squat, the deadlift hinge) — which is also your back-risk zone, so framing matters.

**How it works (two tiers, mirroring the agent split):**
- **Objective metrics (deterministic, on-device):** MediaPipe / TensorFlow pose estimation runs in the PWA browser on your phone — rep count, squat depth, tempo/time-under-tension, range-of-motion consistency, and left/right symmetry. These are geometry, so they're high-confidence.
- **Gross-error coaching (LLM, server-side):** sample 5–10 frames across a rep (optionally with a pose-skeleton overlay) → Claude vision with an expert-coach prompt → plain-language cues for *gross* errors (knee valgus, spinal flexion, depth failure, hips rising before chest).

**Honest ceiling (built into the UX):**
- Single-camera 2D loses depth; accuracy drops with bad angles, occlusion (machine frames, other people), and movement complexity — gross-error detection runs ~70–80%, subtle form does not.
- The tool offers a *hypothesis*, never a diagnosis — it can't tell whether a forward lean is ankle mobility, hip mobility, or motor pattern.
- **Not medical/physio advice.** Given the user's back, it must never say "your back is fine, keep loading" — it flags what it sees and, for anything concerning on a hinge/squat, points to a professional.

**Camera protocol:** side-on for squats/hinges, consistent distance, phone propped/stable — placement carries most of the accuracy, so the app prompts for it.

**Privacy:** pose estimation is on-device, so raw video needn't leave the phone; only sampled frames or extracted keypoints are sent for the coaching pass, opt-in per use. Any stored video is encrypted and deletable.

---

## 13. Tech stack

- **Client:** mobile-first **PWA** — installable, service worker for offline logging, IndexedDB cache with sync, browser camera API; on-device pose estimation (MediaPipe / TensorFlow.js) for Phase-6 form metrics.
- **Backend:** small typed server (Node/TS or Python/FastAPI) — deterministic core, tool endpoints, scheduled jobs (daily Oura pull, food-DB calls), all secrets. Client holds no keys.
- **DB:** Postgres; object storage (S3-compatible) for encrypted images.
- **AI:** Anthropic Claude API (tool use + vision), server-side only.
- **Auth:** single user → device passcode; third-party tokens server-side.

Pragmatic solo stack: Postgres (Neon) + PWA frontend + thin AI/orchestration server on Vercel. Capacitor later only if you want a store install.

**Two disciplines the build proved necessary:**
- **Additive IndexedDB migrations.** A destructive `upgrade` (drop/recreate stores) silently destroys **unsynced in-flight data** on the next version bump. Upgrades branch on `oldVersion` and preserve; new *record fields* are schemaless and need no bump at all — only new stores/indexes do.
- **Client-owned identity.** Sessions, occurrences, and equipment created offline carry **client-generated ids** (`client_session_id`, `client_instance_id`), so an offline row maps to exactly one server row on sync. This is what makes offline-first safe; it also killed the date-as-identity bug (two sessions in one day collided).
- **Migrate before deploy.** Auto-deploy + manual migrations ships code against a schema prod lacks. `db:check` / `/api/health` are the gates; `docs/RUNBOOK.md` is the procedure.

---

## 14. Privacy, security & safety

- Encrypt progress photos at rest; isolate image storage; on-device-only option.
- Oura/food/Claude secrets server-side; never in the client or URLs. If you self-host an Oura MCP later, vet it (some pass health data to the LLM provider).
- **Not medical advice:** clear disclaimer; defer to a professional for pain/injury/medical issues. Your minor back discomfort seeds a caution flag (back-friendly variations, real warm-ups, "did this aggravate it?" logging) — if it changes or worsens, that's a clinician, not the app.
- **No disordered-eating reinforcement:** no aggressive targets or punishment framing; ranges and trends over precise per-meal prescriptions; a flat recomp scale is framed as success.

---

## 15. Build milestones (definitions)

> **Live status is NOT here.** It lives in `docs/CURRENT_STATE.md` (§9 gaps / in-flight). This section defines *what each milestone means*; duplicating status is what made this document rot. Same rule that fixed the onboarding doc's phase table: each fact lives in exactly one place.

1. **Foundations** — exercise + equipment graph seeded/curated; schema; PWA shell with offline logging.
2. **Deterministic core** — volume, volume-load progression, set-counting, per-lane tracking, substitution filter; unit-tested, no LLM. Standing invariant: **audited free of routine-specific literals** (no exercise ids, day names, muscle names, or rep ranges in `src/core/*` outside test fixtures).
3. **Agent layer** — Claude tool-use over the core; free-text constraint → change; substitution final-pick + explanation; coaching voice. **Deliberately deferred** until real logged history exists to reason over — building coaching on unvalidated thresholds would cement guesses.
4. **Logging UX** — offline-first logging, warm-up/working distinction, equipment tagging, sessions list, ordered occurrence composition, progression/substitution wired to real data.
5. **Recovery / body / nutrition / dashboard** — Oura → bodyweight + photos → nutrition source-of-truth + recomp model → sub-score dashboard → whole-system optimization.
6. **Form analysis (video)** — last; strong accuracy/safety caveats (§12a).

**Ordering principle:** validate on real training before layering more on top. The design/gamification pass sits between 4 and 3 — *mechanics* (XP, streaks) wait until real usage shows what's worth reinforcing.

---

## 16. Open decisions & risks

- **Graph + equipment curation cost** — manual tagging (pattern, emphasis, affected-structures, per-unit offsets, pulley ratios) is the differentiator; budget time. Tagging happens **on add**, not up front.
- **Weak offsets are the silent-corruption risk** — the PF Smith default (~20 lb) is a plausible middle, not a measurement (real ones run 6–45), and it's the most-used equipment. A wrong offset skews every set on that unit in the same direction. Measure and set it per unit.
- **Watch item — derived rests may be theater.** Prod shows *zero* derived rests (all `user` or null): the plausibility filter may simply never fire for real logging behavior (batch-logging → <15s → unknown; logging after the fact → >8min → unknown). If still zero after real timer use, drop the derivation rather than maintain a filter that never fires.
- **Skill-level provenance is weak** — backfilled from `free-exercise-db`'s unverified `level`. Fine for a tie-break; flag if ranking degrades.
- **Form vs. logged reps** — the engine measures *logged performance*, not true stimulus; flag implausible rep jumps, hold ROM/tempo consistency (no video verification until Phase 6).
- **Food accuracy expectations** — keep Tier 3 honestly low-confidence, or trust erodes.
- **LLM cost/latency** — keep math deterministic; call the model only for language/judgment/perception; cache explanations.
- **The sync layer is the most dangerous code here** — four bugs found (silent 401 swallowing, concurrent double-insert, un-dirtied occurrence list, the guard's own phantom). Each was invisible until poked. Every fix gets a regression test; treat "verified" claims skeptically and specify the *exact scenario* to test.
- **Multi-device** — detect-and-warn, never auto-heal: after a wipe, local hydrates *from* the server, so local isn't reliably the source of truth.
- **Scope creep** — the agent layer stays deferred until real logging validates the thresholds.
