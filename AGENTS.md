<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project docs — read these at session start

Any agent working in this repo (Claude Code, Codex, etc.) must read these first.
They live in `docs/`:

| Doc | What it is |
|---|---|
| [`docs/fitness-agent-spec.md`](docs/fitness-agent-spec.md) | **The authoritative spec (v0.5) — source of truth.** If your instinct contradicts it, the spec wins; raise it, don't silently deviate. |
| [`docs/CODEX-ONBOARDING.md`](docs/CODEX-ONBOARDING.md) | Product vision, architectural philosophy, domain context, and the working process. The *why* that isn't in the code. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Running log of every implementation decision and deviation — the shared contract between agents. **Read at session start; append at session end.** |
| [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) | The actual repo state (stack, schema, modules, API surface, offline/sync internals, tests, traps). Generated from the live repo — may be stale if the other agent shipped since; re-verify before relying on details. |

The hand-curated exercise graph is data at `src/db/seed-data/pf-exercise-seed.json`
(loaded by `src/db/seed.ts`) — that file is authoritative over any copy elsewhere.

**Load-bearing rules (full detail in the docs):** no LLM/vision code unless
explicitly asked; keep `src/core/*` fully general (zero routine-specific literals
outside test fixtures — self-check every session); offline-first is
non-negotiable; migrations run local-first, prod held until the user reviews;
never mass-delete data or migrate prod without explicit sign-off; keep exercise
IDs stable so logged history is never orphaned; commit in small logical chunks.
