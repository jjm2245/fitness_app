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
