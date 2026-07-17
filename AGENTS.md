<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project docs — read these at session start

Any agent working in this repo (Claude Code, Codex, etc.) must read these first.
They live in `docs/`:

| Doc | What it is |
|---|---|
| [`docs/fitness-agent-spec.md`](docs/fitness-agent-spec.md) | **The authoritative spec (v0.6) — source of truth.** If your instinct contradicts it, the spec wins; raise it, don't silently deviate. |
| [`docs/CODEX-ONBOARDING.md`](docs/CODEX-ONBOARDING.md) | Product vision, architectural philosophy, domain context, and the working process. The *why* that isn't in the code. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Running log of every implementation decision and deviation — the shared contract between agents. **Read at session start; append at session end.** |
| [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) | The actual repo state (stack, schema, modules, API surface, offline/sync internals, tests, traps). Mechanical facts are auto-generated (`npm run docs:refresh`); re-verify judgment sections if the other agent shipped since. |
| [`docs/SPEC-DRIFT.md`](docs/SPEC-DRIFT.md) | Where the built system has diverged from the spec's intent — section by section. A signal for the spec owner to fold into the next version, **not** something to auto-correct. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | How to ship a schema change / backfill to production safely — migrate-before-deploy order, Neon direct-vs-pooled endpoints, before/after counts, the health/`db:check` gates. Read before any prod migration. |
| [`docs/SUBSTITUTION-JUDGMENT.md`](docs/SUBSTITUTION-JUDGMENT.md) | The back-friendly substitution judgment the deterministic engine can't derive (soft preference; hard exclusion is code). Extracted from the otherwise-inert curated substitutions table. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The UI design language (tokens, accent rules, nav model, shell components). Any UI work builds on these tokens — don't invent new chrome; phases 2–3 restyle the remaining screens against this contract. |

**At session end, update the docs (standing rule):** run `npm run docs:refresh`
(regenerates the mechanical facts) and hand-edit the judgment sections of
`docs/CURRENT_STATE.md` (new gaps / in-flight / traps), then append your decisions
to `docs/DECISIONS.md`. `npm run docs:check` must pass (it fails if the
auto-generated facts are stale). **Reality tracks the code; intent does not** —
never edit `fitness-agent-spec.md` to match the code; record the divergence in
`SPEC-DRIFT.md` instead.

The hand-curated exercise graph is data at `src/db/seed-data/pf-exercise-seed.json`
(loaded by `src/db/seed.ts`) — that file is authoritative over any copy elsewhere.

**Load-bearing rules (full detail in the docs):** no LLM/vision code unless
explicitly asked; keep `src/core/*` fully general (zero routine-specific literals
outside test fixtures — self-check every session); offline-first is
non-negotiable; migrations run local-first, prod held until the user reviews;
never mass-delete data or migrate prod without explicit sign-off; keep exercise
IDs stable so logged history is never orphaned; commit in small logical chunks.
