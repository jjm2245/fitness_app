# RUNBOOK.md — production migrations & deploys

**What this is:** the exact steps to ship a schema change to production safely.
Prod is Vercel (auto-deploys `main`) + Neon Postgres, live at
**https://fitness-app-self-pi.vercel.app**. Single operator (the owner).

**Why a runbook and not an automated migrate-on-deploy step:** a build-step
migration that fails mid-deploy is hard to roll back and can leave prod
half-migrated with no operator in the loop. With one operator, a short manual
sequence you run deliberately — migrate first, watch the gates, then let the
deploy land — is safer than automation you can't supervise. (Decision recorded in
DECISIONS.md, Part 5.)

---

## The core hazard

**Vercel auto-deploys `main` the instant you push.** The app code and the
database migrate on *different clocks*: pushing code that expects a new column
deploys in ~1 min, but the column doesn't exist until you run the migration by
hand. So the rule is:

> **Migrate the database BEFORE the new code serves traffic.**

For an *additive* change (new nullable column / new table — the usual case),
migrate first and the old code keeps working against the new schema, then the
deploy lands. For a *breaking* change (drop/rename/NOT NULL a column the old code
reads), there is no safe simultaneous order — do it as an expand→migrate→contract
sequence (add the new shape, deploy code using it, backfill, then drop the old) so
no single step breaks the running app.

---

## Neon endpoints — pooled vs direct

Neon gives two host forms. **`drizzle-kit migrate` must use the DIRECT endpoint**
— the pooled (`-pooler`) endpoint chokes on the multi-statement DDL migrations.

- **Pooled** (app runtime / `DATABASE_URL` in Vercel):
  `...@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`
- **Direct** (migrations only): the same host with **`-pooler` stripped**:
  `...@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require`

Pass the connection string **inline on the command** — never commit it, never put
it in a checked-in `.env`. (Credentials are the owner's to manage; see the secrets
note in DECISIONS / the deploy-hardening session.)

---

## Standard deploy (additive change)

1. **Author the migration locally.** Edit `src/db/schema.ts`, generate the SQL
   (`npx drizzle-kit generate`), and **bump `EXPECTED_MIGRATIONS`** in
   `src/lib/migrationStatus.ts` to the new count. `/api/health` returns 503 while
   the DB is behind that number — that's the guard.
2. **Apply + verify locally first.** `npm run db:migrate` against your local
   `DATABASE_URL`, then `npm test` and a clean `npm run build`. Migrations are
   applied **local-first**; prod is held until you've seen it work.
3. **Capture before-counts on prod** (read-only). For any migration that touches
   or backfills data, run a quick `SELECT count(*)` on the affected table(s) and
   note the numbers. This is the habit that made the equipment_type / skill_level
   backfills auditable — you can prove after that only what you intended changed.
4. **Migrate prod** with the **direct** endpoint:
   ```bash
   DATABASE_URL='<DIRECT endpoint string>' npm run db:migrate
   ```
   For a data backfill, run the one-shot `UPDATE ... WHERE <col> IS NULL` (idempotent)
   and re-run the before-counts query as **after-counts**. Confirm the delta is
   exactly what you expected and nothing else moved.
5. **Deploy the code.** Push to `main` (or promote in Vercel). Vercel builds and
   serves. Because the DB is already migrated, the new code finds the schema it
   expects.
6. **Verify prod is healthy:**
   - `curl https://fitness-app-self-pi.vercel.app/api/health` → expect `200` (503
     means the DB is still behind `EXPECTED_MIGRATIONS`).
   - Load the app, exercise the changed path once.
   - `npm run db:check` against prod confirms the DB is at the code's migration
     count.

## Seed / library changes

`release = db:migrate && db:seed && db:seed:library`. `db:seed` (curated graph)
and `db:seed:library` (free-exercise-db ingest, slow) are **idempotent** — safe to
re-run; they upsert. Run them after `db:migrate` when a change touches seeded data
(e.g. a new curated exercise or a `skill_level` tag). Order matters: `db:seed`
first (curated rows), then `db:seed:library` (library rows + merges that inherit
onto curated rows).

## Rollback

- **Additive migration:** usually nothing to undo — the new column/table is inert
  to old code. If the deploy itself is bad, revert the code in Vercel; the extra
  column can stay.
- **Data backfill:** the before/after counts are your undo reference. Backfills
  here are written `WHERE <col> IS NULL` so re-running is a no-op; to reverse, you
  need the before-state (another reason to capture it in step 3).
- **Breaking migration:** don't. Use expand→contract so there's never a step that
  needs a rollback under load.

## Hard rules (from AGENTS.md / the spec)

- **Never mass-delete data or migrate prod without explicit owner sign-off.**
- **Migrations run local-first; prod is held until reviewed.**
- **Keep exercise IDs stable** — logged history references them; a rename is an
  edit, never a delete-and-recreate.
- **Propose prod writes before running them** (show before/after).
