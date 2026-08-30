# TData KHL Results — Hermes handoff

Generated: 2026-08-21T07:03:55Z

## First instruction for the receiving Hermes Agent

Read this file completely, then inspect the repository and continue from the **remaining work** section. Do not assume this recovered checkout is the canonical production source. Do not execute any Admin result write or production deployment until the stated blockers are resolved.

## Repository state

- Branch: `khl-results`
- Baseline HEAD: `3da33d62208c2e9bc25e9f8e9ab29ec897780da9`
- Baseline commit: `chore: establish verified recovered TData baseline`
- Origin: forensic reconstruction from local sources and a BuildKit snapshot.
- Git remote: absent at handoff time.
- Feature work: intentionally uncommitted but fully staged in the transfer archive, so the receiving machine can run final gates before creating the feature commit.
- Production application, production database and Admin result endpoint have not been modified or called.

## Implemented vertical slice

- First-party source only: `https://khl.api.webcaster.pro/api/khl_mobile`.
- KHL API client with exact response-text preservation and bounded pagination.
- Raw snapshots persisted as PostgreSQL `bytea` with deterministic SHA-256.
- Immutable normalized revisions keyed by normalized hash + parser/rules versions.
- String external KHL identifiers at API/persistence boundaries.
- Explicit confirmed team, match, player and target-stat mappings.
- Fail-closed readiness: missing, unconfirmed or ambiguous mappings block staging.
- Regulation-only Admin totals (`P1`–`P3`); overtime excluded.
- Player goals/assists/points exclude OT and shootout.
- PIM includes only 2- or 4-minute penalties and Admin total uses regulation only.
- All listed players are retained, including zero-stat players.
- Shootout represented separately as `SO` and not counted as ordinary player goals.
- Canonical Admin payload and deterministic payload hash.
- Idempotent persistent delivery staging with serializable transaction retries.
- No Admin HTTP sender and no network transport from staging.
- Delivery diff states: `BLOCKED`, `NEW`, `UNCHANGED`, `CHANGED`.
- Protected operator API namespace under `/api/results/khl/**`; every operational route uses server-side `requireAdmin`.
- Operator page `/results/khl`, `/results` redirect and Navbar entry “Результаты”.
- UI supports ingest, team/match/target mappings, canonical preview, diff and local staging without sending.

## Non-negotiable business rules

1. Team totals sent to Admin contain only `P1`, `P2`, `P3`.
2. OT must not leak into team total or player goals/assists/points.
3. PIM sums only penalty durations exactly `2` and `4`; other durations are excluded.
4. All listed players, including zeros, must be represented.
5. No automatic delivery based on names/fuzzy matching.
6. Delivery requires confirmed mappings and exactly one Admin match.
7. Raw snapshot hash, normalized revision hash and payload hash are separate.
8. Unchanged inputs/payloads must be reused rather than duplicated.
9. `SettingsPasswordGate` is UX only; `requireAdmin` is the security boundary.
10. Real Admin transport remains forbidden until endpoint/method/payload/response/idempotency semantics are proven.

## Fixtures

- Regulation: game `901973`, event `2986031`, stage `395`.
- OT2: game `901952`, event `2979935`, stage `395`.
- Shootout: game `897491`, event `2783714`, stage `370`.
- Historical four-minute penalty: game `877124`, event `1423965`, stage `197`.
- Modern excluded penalties: game `901702`, event `2953963`, stage `395`.

## Verification already observed on the source machine

- Prisma schema validation and generation: passed.
- Additive migration applied to a clean isolated PostgreSQL database: passed.
- Eight KHL targeted suites: passed before the final diff/staging UI increment.
- Latest `tests/khlPreview.test.ts` after diff/concurrency changes: passed.
- Latest `tests/khlApiAuth.test.ts` after adding diff/staging routes: passed (2/2).
- Latest full `npm run typecheck`: passed.
- Latest full `npm run lint`: passed.
- Latest canonical `npm run build`: passed with Next.js 16.2.6; routes `/api/results/khl/diff` and `/api/results/khl/delivery/stage` were present in build output.
- Live first-party fetch → ingest → duplicate ingest: passed; duplicate reused snapshot/revision and did not reactivate.
- Earlier browser E2E passed for redirect, gate, ingest, team/match/target mappings and READY preview with no console errors.
- Browser E2E for the latest diff/staging UI is still required.
- A previous full corpus run passed on an isolated DB before the latest increment; a later run had environment/state contamination. A fresh full corpus after the latest increment is mandatory.

## Remaining work on the main PC

### 1. Inspect and verify the transfer

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --check
git diff --cached --stat
```

Expected branch is `khl-results`, baseline HEAD starts with `3da33d6`, and feature files are staged but uncommitted.

### 2. Install dependencies

Use Node.js 24 as declared in `package.json`:

```bash
npm ci
npm run prisma:generate
```

WSL2 or Linux is recommended on Windows because production and the current test flow are Linux-based.

### 3. Create a brand-new isolated PostgreSQL test container

Do not reuse or delete an existing database. Have Hermes create a uniquely named Docker network, container and database, generate a local-only password, and keep the DSN outside Git. Apply migrations only to this fresh DB:

```bash
npm run db:migrate:deploy
npx prisma validate --schema=backend/prisma/schema.prisma
```

Set both `DATABASE_URL` and `TEST_DATABASE_URL` to that isolated DB for tests. Never point them at production.

### 4. Run gates in this order

```bash
npx tsx --test \
  tests/khlNormalize.test.ts \
  tests/khlClient.test.ts \
  tests/khlAdminPayload.test.ts \
  tests/khlRepository.test.ts \
  tests/khlMatchResolver.test.ts \
  tests/khlBindings.test.ts \
  tests/khlPreview.test.ts \
  tests/khlApiAuth.test.ts

npm test
npm run lint
npm run typecheck
npm run build
```

If the machine has less than ~3 GiB available RAM, create temporary swap or reduce concurrent workloads. Do not interpret `exit 137` as a code failure; inspect OOM evidence and rerun after fixing capacity.

### 5. Repeat live verification

```bash
npx tsx scripts/verify-khl-live.ts
```

Expected duplicate ingest behaviour: snapshot/revision reused and `activated: false` on the duplicate.

### 6. Run latest production-mode browser E2E

On an isolated DB and test-only admin credentials:

1. `/results` redirects to `/results/khl`.
2. Unauthenticated API calls return 401 before validation/network access.
3. Ingest game `901973`.
4. Before mappings, preview is `BLOCKED`.
5. Confirm test-only team and match mappings.
6. Load and save test-only team/player target mappings.
7. Reload target template and verify confirmed IDs are prefilled.
8. Preview becomes `READY` and shows canonical payload/hash.
9. Diff before staging is `NEW`.
10. Stage once; response states `transportExecuted: false`.
11. Diff becomes `UNCHANGED`.
12. Stage concurrently/twice; exactly one `KhlDelivery` remains and no `KhlDeliveryAttempt` is created.
13. Browser console has no JavaScript errors.

Never use real Admin identifiers during this E2E.

### 7. Independent review and commit

Review the complete staged diff for security, business rules, migration/schema parity and UI behaviour. Fix findings and rerun affected gates. Then create a single feature commit, for example:

```bash
git commit -m "feat: add fail-closed KHL results workflow"
```

### 8. Resolve production provenance before deployment

The source machine could not prove the canonical production checkout or authenticated deployment channel. On the main PC:

1. Locate the actual production repository/image/Portainer stack.
2. Compare it read-only with baseline HEAD/recovery provenance.
3. If it differs, transplant the KHL feature commit onto canonical source; do not overwrite production with the recovered checkout.
4. Compare the additive migration against actual production schema read-only.
5. Capture application/image and PostgreSQL backups.
6. Record exact rollback: previous image/app revision first; additive KHL tables may remain inert. Use DB restore rather than ad-hoc destructive SQL if schema rollback is required.
7. Deploy with Admin sender still absent.
8. Smoke-test `/results`, `/results/khl`, auth, stages/schedule, ingest and fail-closed preview.

## Current blockers that must not be bypassed

- No proven canonical Git remote/source for production.
- No authenticated production SSH/Portainer/registry channel on the source machine.
- Actual Admin results endpoint, HTTP method, wire payload, responses and idempotency semantics are unknown.
- Therefore no real Admin results sender may be implemented or enabled yet.

## Files added by the final increment

- `backend/src/results/khl/diff.ts`
- `frontend/src/app/api/results/khl/diff/route.ts`
- `frontend/src/app/api/results/khl/delivery/stage/route.ts`
- Diff/staging/payload UI additions in `KhlResultsClient.tsx`
- Concurrency and diff assertions in `tests/khlPreview.test.ts`
- Explicit unauthenticated checks for the new routes in `tests/khlApiAuth.test.ts`

## Secret handling

No production credentials, tokens, connection strings, private keys or database dumps are included in the handoff archive. Generate test secrets locally and never commit them.
