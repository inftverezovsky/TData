# KHL identity-only display readiness

## Scope and journeys

The user requested a site fix after game 901981 (SKA–Lada) was excluded from daily statistics because five official roster rows have `khl_id=0`.

- Show coherent match/team/player statistics before Admin mappings, including every zero-value player.
- Treat missing source identity as a display warning, not as permission to activate or deliver a revision.
- Keep unknown, mixed, numerical and ambiguous-identity failures out of aggregate totals.
- Preserve source bytes, immutable revisions, mappings, worker behavior and all unrelated parsers.

The initial display release changes only four frontend files: the new `khlProtocolReadiness.ts` classifier and the existing results view model, workspace and protocol component. The midnight follow-up below adds a frontend clock. Backend/parser/schema/migrations and delivery code remain byte-identical to the previous release.

## Policy and guarantees

The display classifier returns `VALIDATED`, `IDENTITY_WARNING` or `BLOCKED`. The exception requires an exact one-to-one set of canonical missing-ID messages matching actual null-ID roster rows; valid distinct side/API identities and resolved KHL identities; coherent points; complete P1–P3 values and known metric codes. Latest/displayed revision metadata must agree. Arbitrary text containing "missing" is not accepted.

Unresolved players retain `khlPlayerId: null`. Their display-only row key uses match, side and API ID; it is never persisted as a KHL ID or used for Admin mappings. Known players aggregate by team and KHL ID. Repeated input for a match is not double-counted. Archive badges describe eligibility rather than falsely claiming inclusion in today's totals.

| Guarantee | Evidence |
|---|---|
| Real 901981 contributes both teams and all 47 players, including five unresolved identities | `tests/khlIdentityReadiness.test.ts` |
| Regulation score is 3:3, OT remains excluded, metric totals and zero players retained | Same real fixture test |
| Opposite-side and cross-match API IDs do not merge | Scoped row-key regression |
| Later genuine IDs replace warning rows without rewriting diagnostic input | Source-correction regression |
| Unknown/mixed/incomplete warnings, duplicate identities, inconsistent numbers and stale displayed revisions remain blocked | Negative matrix and metric integrity regressions |
| Amber badges, human-readable names and daily eligibility agree | SSR component and browser assertions |
| Activation/payload guards still reject missing IDs | Existing diagnostic roster and Admin payload tests, unchanged backend |
| Only web may restart; worker, schema, migrations, environment and other services are protected | 12 new deployment-helper safety tests, plus 17 existing helper tests |

## RED / GREEN evidence

1. `npx tsx --test tests/khlIdentityReadiness.test.ts`: valid RED after correcting the fixture wrapper; 8 tests, 2 passed and 6 failed on the intended exclusion/new presentation behavior. Checkpoint `6e02a68`.
2. Minimal frontend fix: 28/28 targeted tests passed; scoped lint and typecheck exited 0. Checkpoint `2c06f8a`. The test's final backend guard assertion was corrected to call the existing `requireResolvedKhlPlayers`; production backend was not modified.
3. Independent review identified archive wording; additional defense-in-depth tests covered unknown metric codes and duplicate period rows. RED: 10 tests, 7 passed and 3 failed. Checkpoint `a4b5f27`.
4. Same tests GREEN, 21/21 combined projection/component tests passed. Checkpoint `0d82ff7`.

Coverage command:

```text
npx tsx --test --experimental-test-coverage --test-coverage-include=frontend/src/components/results/khl/khlProtocolReadiness.ts --test-coverage-include=frontend/src/components/results/khl/khlResultsViewModel.ts --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=80 tests/khlIdentityReadiness.test.ts tests/khlResultsViewModel.test.ts tests/khlResultsWorkspace.test.ts tests/khlMatchProtocol.test.ts
```

Actual final coverage: **98.43% lines, 93.94% branches, 96.92% functions**. The new classifier has 100% line/function coverage. This is scoped coverage, not a claim about the whole repository.

## Current release gates

- New isolated PostgreSQL `tdata_khl_view_test_20260905_2054`: migrations and Prisma validation passed.
- `npx tsx --test tests/khl*.test.ts`: **145 passed, zero failed/skipped**.
- `npm test`: **951 total, 948 passed, zero failed, three existing optional tests skipped**; 84.46 seconds.
- Lint/typecheck/production build: exit 0. Lint retains one pre-existing warning at `frontend/src/app/error.tsx:40`.
- Fixture production-mode browser: 47 roster rows, five missing-ID warnings, exact daily values for 47 players and both teams; zero JS errors and zero non-GET requests. Browser clock explicitly controlled to 2026-09-05 23:00 Moscow.
- Deployment helper tests: **29/29 passed**. Independent code/security review: no unclosed confirmed high/medium findings.
- `npm audit` still reports three pre-existing transitive findings (one low, one moderate, one high). Dependencies were not changed.

Initial QA setup attempts hit existing database-name guards. The guards were kept intact and new uniquely named databases were created; no existing database was deleted or repurposed. Browser staging verification uses a separate fresh `tdata_khl_browser_view_20260905_2100` database. No production database is used by automated tests.

Reviewed release source is `5af21ff0542d22f3b944d8cf8b563b5479540a27`. All 670 exported source files matched Git with zero extras. Image ID is `sha256:15d2e8b81348209fe6d7c8f98a3dac17173b1f509f87284ff280397126aa46be`. Exact protected runtime hashes and image configuration were verified against the previous image. See `../KHL_VIEW_DEPLOYMENT.md` for the scoped backup/rollback procedure.

## Final staging browser

The current production-mode application and worker passed `scripts/verify-khl-browser.ts` against the separate new `tdata_khl_browser_view_20260905_2100` database (exit 0). The scenario exercised BLOCKED → READY → NEW → staging → UNCHANGED, target prefill, repeat/concurrent staging and automatic/manual/pause controls, including a closed page.

- Game: `901973`.
- Payload SHA-256: `e472f2b72bf4364e5dc4154f0d08322ae7785dfa82b8dc8c24c4eefacb9053d3`.
- One delivery; zero delivery attempts; `transportExecuted: false`; final diff `UNCHANGED`.
- Two player/team groups; zero browser console errors.
- Evidence: test runner `/tmp/khl-view-gates-final/browser-staging-final.log`.

## Production cutover

The scoped web-only deployment helper completed with exit 0 and returned `{"mode":"deploy","ok":true,"backupDirectory":"/root/tdata/backups/khl-view-20260905-2058","webOnly":true}`. The deployed code/image is the exact `5af21ff` release identified above; this evidence document is a subsequent documentation-only commit.

Before cutover, the PostgreSQL backup was actually restored to a new private isolated PostgreSQL instance and its schema/migrations verified. The previous image and seven Compose inputs were preserved. The web command explicitly bypasses startup migration; neither this deployment nor rollback runs a production migration. The helper enforces unchanged non-web containers, runtime environment, schema/migrations and legacy timer state.

- Verified private rollback package: `/root/tdata/backups/khl-view-20260905-2058`.
- Durable rollback helper: `/root/tdata/deployments/builds/khl-5af21ff0542d22f3b944d8cf8b563b5479540a27/scripts/deploy-khl-view-release.py`.
- Rollback command: `python3 <helper> rollback --apply --backup-dir /root/tdata/backups/khl-view-20260905-2058`.

The post-cutover read-only audit confirmed the expected web image and unchanged ten non-web containers, schema, 17 migration records and confirmed-binding fingerprint; delivery and attempt counts stayed zero. A standalone automatic cycle ran at 21:02:52–21:02:55 UTC: six checked, six ingested, six reused revisions, zero changed. It retained the known diagnostic identity warning, not a network/queue failure.

## Midnight follow-up discovered by live acceptance

The initial public browser reached all 47 player/five-warning/team-stat assertions but correctly failed its final zero-console-error gate. A separate real wall-clock, GET-only browser reproduced React hydration error #418: static HTML showed 5 September while the hydrated browser showed 6 September after Moscow midnight. This was an existing render-time `new Date()` issue, not evidence of failed collection. It was not suppressed or declared a passing live gate.

Two independent regression cases then failed on the old production-mode test build: next-day initial hydration and a same-page midnight transition without new HTTP responses. A unit SSR comparison likewise failed before the fix (one failure, three passes).

The follow-up adds `khlResultsClock.ts`: a `useSyncExternalStore` clock with a deterministic null server/initial-hydration snapshot, stable 15-second non-future time buckets and timer/focus/visibility subscriptions with cleanup. The workspace uses that same snapshot for partitioning, headings and daily statistics; a date change updates the existing page even when no new match data arrives. No hydration-warning suppression, backend change, migration or worker restart is needed.

- Follow-up local targeted component/view-model tests: 25/25 passed; lint and typecheck exited 0.
- Clock-specific scoped coverage: 96.67% lines, 95.24% branches, 100% functions.
- Independent clock review: no high/medium findings; same-day future-start filtering and subscription cleanup are covered.
- Isolated Linux follow-up KHL tests: 149 passed, no failures/skips.
- Isolated Linux full suite: 955 total, 952 passed, zero failed, three existing optional skips; 119.53 seconds.

Follow-up lint, typecheck and production build exited 0. Both production-mode fixture browser verifiers passed:

- Identity: 47 roster/player-stat rows, five missing IDs, both team-stat rows; 37 GETs, zero non-GET attempts, zero browser errors.
- Midnight: both next-day initial hydration and same-page transition passed. The transition delivered exactly one initial matches response; two later read attempts were deliberately held before network transmission, zero extra responses refreshed state. Dates, player/team aggregates and today/archive membership changed within 15 seconds; zero browser errors and zero non-GET attempts. Test clocks are explicitly controlled, not wall-clock evidence.
- Helper safety tests were repeated: 29/29 passed, including exact hashes for both read-only diagnostic scripts.

A second new private backup `/root/tdata/backups/khl-view-20260905-2106` was actually restore-verified against the current `15d2e8b` web baseline. It contains eight exact Compose inputs, the previous image and PostgreSQL dump. The restored clone had 17 matches, 88 raw snapshots and 28 revisions; schema and 17 migration records matched. Original databases and earlier rollback packages were retained. The standalone worker and all other non-web containers remained unchanged.

The full staging browser was repeated again on the exact follow-up production build in a further new database, `tdata_khl_browser_midnight_20260905_2116`; migrations and the browser exited 0. It passed BLOCKED → READY → NEW → staging → UNCHANGED, repeated/concurrent staging, prefill and manual/forced/automatic/closed-page/persisted-pause scenarios. There was one delivery, zero attempts, `transportExecuted: false` and zero browser console errors. Payload SHA-256 in this separate test binding set: `f650c8ed1023adf49f29bedd64410c409bc88f3273933b4a3fd5e60c8774f411`.

That test worker's automatic 14-day pass fetched six protocols after the page closed, reused all six revisions and changed none. Its partial status reflected the persisted 901981 diagnostic identity warning (`retryRequired: false`), not a stopped collector. The broader first test pass also retained 901956's genuine upstream numerical conflict; this release intentionally does not waive conflicting statistics.

The exact follow-up code/image identity and final public acceptance are recorded after cutover.
