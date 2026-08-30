# TLine MVP

TLine is an internal, read-only line verification module inside TData. It compares a fresh official-source snapshot with a fresh Admin line snapshot and stores immutable evidence plus a separate manual status overlay.

## Safety state

The committed defaults are intentionally fail-closed:

```text
TLINE_ENABLED=0
TLINE_SCHEDULER_READY=0
TLINE_ADMIN_MODE=http
```

The HTTP Admin adapter remains unavailable until its endpoint, authentication, pagination and response schema are confirmed. `fixture` mode is accepted only outside production. The scheduler can be enabled only after the deployment readiness flag and all sport/championship windows, tolerances and Admin IDs are configured.

No TLine code mutates Admin data. Browser code never receives Admin credentials.

## Local verification

Use a dedicated loopback PostgreSQL database whose name contains `test`. Pass both connection variables only to the migration/test processes:

```powershell
$env:DATABASE_URL = 'postgresql://<local-user>:<runtime-password>@127.0.0.1:<local-port>/tdata_tline_test?schema=public'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:migrate:deploy
npm test
npm run test:tline:coverage
npm run typecheck
npm run lint
npm run build
```

Do not put the runtime password in repository files or shell scripts. If a local file is required, create `C:\Users\Sa1z1ngr0z\Desktop\TData\.env.test.local`, keep it ignored by Git, and define `DATABASE_URL=...` and `TEST_DATABASE_URL=...` there with local-only values. Existing scripts do not automatically load that file; inject it only into the intended test process.

The base additive migration is `backend/prisma/migrations/20260830190000_tline_mvp/migration.sql`; the Admin hierarchy is added by `backend/prisma/migrations/20260830233000_tline_admin_hierarchy/migration.sql`. Before production both must pass a clean test database and a restored production dump rehearsal, followed by a schema diff.

## Admin hierarchy and team directory

TLine models the Admin scope explicitly as `Sport → Global Header/Shapka → Championship`. All three external IDs are independent positive-integer strings. Existing championships remain unassigned after the hierarchy migration; the migration never substitutes an Admin Championship ID for a Shapka ID.

The operator imports XLSX or a public Google Sheet only after selecting a championship. The server derives its Sport and Shapka, upserts `AdminTeam` records, and adds memberships to the Shapka directory. Repeated imports update names and add memberships but never delete teams omitted from a later table. Every championship under the same Shapka can search that directory, while mappings stay championship-scoped.

A manual mapping may use any positive Team ID. An ID missing from the selected Shapka creates a deterministic internal `AdminTeam` and is shown as `Вне справочника`; it is not silently added to the imported directory. `Очистить` stores a locked `MANUAL_UNMAPPED` state instead of deleting evidence. `Снять блокировку` makes the row eligible for a later Shapka-scoped automap.

## Volleyball pilot

The migration and `db:seed` idempotently create the active `Волейбол` sport plus the two approved 2026/27 pilot championships:

- `Волейбол. Россия. Высшая лига А. Женщины` — `01KYPZAKJB0SMM0D6TGV3W0Y85`;
- `Волейбол. Россия. Высшая лига Б. Мужчины` — `01KZQZR5T3NETE0RT7VHND16VW`.

Their Admin IDs, automatic periods, candidate windows and tolerances remain unset. Both championship automation flags and the global scheduler remain disabled until the read-only Admin contract and pilot settings are confirmed.

Check the official sites directly for any selected period without a database write:

```powershell
npm run tline:check-sources -- --from 2026-10-01 --to 2027-04-30
```

The checker validates the selected league, unique match IDs and official Volley.ru team IDs, then reports exact/date-only/undefined time counts. Volley.ru future fixtures that contain only a date and city remain `DATE_ONLY`: TLine preserves the source text and does not invent UTC time.

To repeat the database bootstrap explicitly after applying the migration:

```powershell
npm run tline:bootstrap-pilot
```

## Runtime

`scripts/tline-worker.ts` uses the same immutable image as `web`. It claims PostgreSQL jobs with `FOR UPDATE SKIP LOCKED`, maintains a lease/heartbeat, recovers expired jobs and checks cancellation between championships. No worker port is exposed.

Manual runs return HTTP `202`. When the sport already has a queued/running run, the API returns HTTP `200` with that run and `deduplicated: true`.

The persisted Moscow slots are 08:00, 12:00, 16:00 and 22:00. Enabling the scheduler is a separate rollout action; it is not implied by deploying the worker.

## Adding a sport

1. Create or reuse a `Discipline` through `POST /api/tline/sports`.
2. Configure the Admin sport ID, period offsets, candidate window and default tolerance.
3. Create at least one Global Header/Shapka for this sport.
4. Keep `autoEnabled=false` until a manual fixture/read-only pilot passes.

## Adding a championship

1. Register the championship under one TLine sport.
2. Assign a Global Header/Shapka of the same sport.
3. Select an official adapter and enter an allowlisted HTTPS URL plus IANA timezone.
4. Enter the separate read-only Admin championship ID.
5. Import the Shapka team directory from XLSX/Google Sheets, synchronize source teams, run automapping and resolve ambiguous mappings manually.
6. Configure championship-specific tolerance/window overrides when the sport defaults are unsuitable.
7. Run a manual check before enabling scheduled participation.

Mappings are championship-scoped. Existing mappings are never silently reused across championships or seasons.

## Adding an official source

1. Implement `OfficialSourceAdapter` under `backend/src/tline/sources/`.
2. Give the adapter a stable provider key and register it in every runtime registry.
3. Add its exact public HTTPS hosts to the server-side URL allowlist; keep redirects disabled and enforce timeout/response-size limits.
4. Store representative HTML/API fixtures and cover DOM/schema drift, timezone, date-only and special-status cases.
5. Return a fresh snapshot or fail explicitly. Never substitute a previous business snapshot after a failed fresh fetch.

## Deployment gate

Build only from the canonical local Git checkout. Tag the immutable image with the Git SHA, push it through the approved registry flow, apply the migration only after backup/restore rehearsal, then recreate only `web` and `tline-worker`. Do not build from `/root/tdata` on the VDS.

First rollout keeps `TLINE_ENABLED=0` and the scheduler off. Rollback disables TLine, stops only `tline-worker`, and restores the previous web image; nginx, PostgreSQL and unrelated containers remain untouched.
