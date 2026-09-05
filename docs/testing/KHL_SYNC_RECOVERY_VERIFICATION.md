# KHL sync recovery integration verification

Canonical checkout: `TData-parser-reliability`, based on production `3cf1078ebd9d2e502cd90aeeb63632be1b122cb6`. Verification date: 2026-09-05.

## Isolation

Node 24.15.0 and PostgreSQL 16. Local Docker Desktop could not start, so a new uniquely named, resource-limited PostgreSQL container/network and a separate runner were created on the server. No production database was used by tests. Database credentials were generated at runtime and were not written to repository files or logs.

The primary database is `tdata_khl_test_20260905_1739`. Each browser attempt uses a new `tdata_khl_browser_*` database; existing databases are not deleted or reused. The browser wrapper explicitly supplies its loopback `TDATA_PUBLIC_BASE_URL`; same-origin protection remains enabled.

## Evidence established before final refresh-policy regression

- Clean dependency installation, explicit Prisma generation and validation passed. All 16 migrations applied to clean isolated databases. Prisma schema comparison against the isolated migration-built database reported no difference.
- The initial KHL suite passed 131/131, including real PostgreSQL queue/worker/repository tests. Selected-module coverage is documented in `KHL_SYNC_WORKER_TDD.md`.
- The full suite after the diagnostic-display correction passed 936/939, with 0 failures and 3 explicitly optional, non-KHL PostgreSQL concurrency tests skipped. These require separate database-name guards and opt-in flags; they are not reported as passed.
- Linux lint and typecheck passed. Lint retains one existing warning in `frontend/src/app/error.tsx` about `window.location.href`; unrelated code was not changed.
- Linux production build passed.
- Live official game 901973 ingest preserved 200234 exact response bytes, verified against the stored bytea value and SHA-256. Repeating the same bytes reused snapshot and revision without reactivation. Normalized hash: `3d296b831eb79c75e81958ef718b5cc26ea58220105956df32d0f7245f33c6ba`.
- Production-mode browser verification passed: public redirect/navigation, protocol before mappings, BLOCKED → READY → NEW → staging → UNCHANGED, repeated and parallel idempotent staging, persistent bindings/template prefill, manual/forced collection, immediate automatic run after page closure, and persisted pause. One delivery, zero delivery attempts, `transportExecuted:false`, zero browser console/JavaScript errors.
- The real collection stored 901979 with 44 players and a validated revision; 901981 with all 47 players, five missing KHL IDs and a rejected diagnostic revision.
- Read-only production/test KHL schema equality and deployment safeguards are documented in `../KHL_SYNC_DEPLOYMENT.md`.

The browser run exposed the inherited six-hour protocol refresh cache and overlapping changed/unchanged counters. Both were corrected with failing regressions first: the worker now fetches eligible protocols each pass and counts normalized revisions separately from raw-only changes. Final gates were repeated after those corrections, as recorded below.

## Dependency audit

`npm audit` reported three existing transitive findings (browserslist, selector-parser and xmldom); it was not clean. Independent review found the vulnerable prerequisites outside the KHL runtime paths being changed. No unrelated dependency update was included. This is not a claim that the entire application has no dependency risk.

## Final release gates

- `npm test`: **941 total, 938 passed, 0 failed, 3 optional non-KHL tests skipped**, exit 0, 83.66 seconds.
- Targeted `tests/khl*.test.ts`: **135 passed, 0 failed, 0 skipped**, exit 0, 28.38 seconds.
- Linux lint: exit 0, the one pre-existing warning noted above. Typecheck: exit 0. Production build: exit 0.
- Repeated live verification: exact raw bytea/hash match, stable normalized hash, snapshot/revision reuse and no duplicate activation; exit 0. Source bytes may contain changing metadata, so raw hashes legitimately differ between independent source requests.
- Final production-mode browser run on new `tdata_khl_browser_20260905_e2e3`: exit 0, all binding/staging/control assertions passed, zero browser errors, one delivery, zero attempts, `transportExecuted:false`, final diff `UNCHANGED`.
- The automatic pass after page closure fetched **6/6 protocols**, ingested 6, reused 6 normalized revisions, reported 0 normalized changes and 0 recently-fetched skips. It completed `PARTIAL` solely because 901981 remains a persisted rejected diagnostic revision; `retryRequired:false`. The other matches were processed normally. Pause persisted after reload.
- Independent final review: no unclosed confirmed high/medium findings. Deployment helper: 15/15 offline tests; latest auto-sync checks: 11/11. Actual backup restore and production observation are separate deployment acceptance checks, not implied by those offline tests.

The release commit is created only after these pre-deployment gates. Deployment acceptance must additionally verify the private backup/restore manifest, pinned image, protected container identities and one unattended ten-minute production cycle. Those live observations belong to the deployment record; this pre-deployment test report does not itself claim production rollout.
