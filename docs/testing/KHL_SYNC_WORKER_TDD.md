# KHL durable collection — TDD evidence

Scope: the user-approved September 2026 recovery plan. Only KHL collection, its APIs, worker state and tests are changed. Production deployment and the complete quality gate are recorded separately. No intermediate commits were created because the user requires committing only after all gates pass.

## Runtime RED → GREEN

| Guarantee | Test | Observed RED | Observed GREEN |
| --- | --- | --- | --- |
| Raw reaches guarded persistence without roster pre-normalization | `khlAutoSync.test.ts` | Raw persistence callback was never called | Passed |
| Stop between matches and recover saved progress | `khlAutoSync.test.ts` | Zero ingests instead of one; progress hook absent | Passed |
| Reject oversized public sync commands before DB access | `khlSyncRoutes.test.ts` | HTTP 400 instead of bounded-body 413 | Passed |
| Explicit full scan cannot silently reuse a rolling scan | `khlSyncQueuePolicy.test.ts` | Returned `full: false` | Passed |

The initial queue test exercised a missing `syncQueue` module (implementation-absence RED). A preliminary PostgreSQL run passed lease fencing/recovery, immediate enable/pause, and success timestamps. Its parallel enqueue case hit transaction acquisition timeout over the high-latency development SSH tunnel. The final isolated Linux run used PostgreSQL on the test-container network directly and passed the concurrency case without changing production transaction timeouts.

## Locally executed checks

- `node node_modules/tsx/dist/cli.mjs --test tests/khlAutoSync.test.ts tests/khlAutomation.test.ts tests/khlSyncRoutes.test.ts tests/khlIngestRoute.test.ts tests/khlApiAuth.test.ts`: 21/21 passed.
- `node node_modules/tsx/dist/cli.mjs --test tests/khlSyncQueuePolicy.test.ts`: 1/1 passed after the full-scan fix.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: exit 0.
- ESLint for changed sync backend, worker/CLI and test files: exit 0.
- `git diff --check`: exit 0.

## Database verification targets

`khlSyncQueue.test.ts` exercises parallel coalescing, single executor, stale lease takeover/fencing, immediate bootstrap scheduling, persistent pause, manual-after-pause behavior, truthful no-change timestamps, historical retry eligibility and the manual-request/automatic-cancellation race.

`khlSyncWorker.test.ts` exercises real fixture ingestion while paused, repeated ingestion without duplicate snapshots/revisions, bounded transient source retry with per-match isolation, cancellation between matches, shutdown/restart checkpoints with actual persisted matches, and forced historical protocol refresh.

Text selection, a real Admin sender and modifications to other parsers are deliberately outside this change.

## Verified Linux PostgreSQL result

Executed in the dedicated isolated runner (not production DB):

```text
node node_modules/tsx/dist/cli.mjs --test tests/khlSyncQueue.test.ts tests/khlSyncWorker.test.ts tests/khlRepository.test.ts
```

Result: **19 passed, 0 failed, 0 skipped, exit 0**, 10.47 seconds. This includes all eight queue guarantees, all five actual worker/ingestion scenarios, and six raw-fidelity/diagnostic-revision repository tests. The advisory suite lock was released on completion.

Full-suite/build/browser results remain separate integration-gate responsibilities; the above result does not imply those other gates passed.

## Numerical coverage

Executed on the same isolated Linux runner with Node's built-in coverage:

```text
node --import tsx --experimental-test-coverage --test --test-coverage-include=backend/src/results/khl/sync*.ts --test-coverage-include=backend/src/results/khl/autoSync.ts --test-coverage-include=backend/src/results/khl/repository.ts --test-coverage-include=backend/src/results/khl/adminPayload.ts --test-coverage-include=backend/src/sources/results/khl/*.ts tests/khl*.test.ts
```

Result: **131 passed, 0 failed, 0 skipped, exit 0**, 33.04 seconds.

| Module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `adminPayload.ts` | 97.28% | 86.49% | 96.15% |
| `autoSync.ts` | 94.22% | 88.89% | 94.59% |
| `repository.ts` | 97.90% | 87.41% | 91.43% |
| `syncErrors.ts` | 100.00% | 100.00% | 100.00% |
| `syncQueue.ts` | 93.78% | 88.44% | 85.11% |
| `syncRequest.ts` | 100.00% | 95.65% | 100.00% |
| `syncWorker.ts` | 84.11% | 71.43% | 86.36% |
| `client.ts` | 93.72% | 73.81% | 91.30% |
| `normalize.ts` | 97.95% | 83.41% | 98.67% |
| **Selected changed/affected modules combined** | **95.74%** | **84.35%** | **93.11%** |

The aggregate exceeds 80% for lines, branches and functions. This is coverage of the explicitly selected KHL modules, not repository-wide coverage. Client and worker branch coverage individually remain below 80%; the remaining gaps include network/heartbeat failure alternatives and defensive paths. No per-file 80% branch-coverage claim is made.

## Newer rejected protocol must remain visible

Independent integration review found that the matches response preferred an older active protocol even when a newer diagnostic revision existed. Regression tests were updated/added before the fix: the local matches/view-model run produced **6 passes and 3 intended failures**, showing the old protocol, hidden diagnostic roster and misleading validated badge.

The minimal fix selects a newer `REJECTED` revision for display with `LATEST_REJECTED` provenance while preserving active revision metadata and fail-closed delivery behavior. Its view-model badge now identifies the protocol actually shown. The real `901981` fixture proves that all 47 roster slots, including five absent KHL IDs, remain visible even when an older accepted projection exists.

Validation: `node node_modules/tsx/dist/cli.mjs --test tests/khlMatchesView.test.ts tests/khlResultsViewModel.test.ts tests/khlResultsWorkspace.test.ts tests/khlMatchProtocol.test.ts` — **14/14 passed, exit 0**. ESLint for the four changed source/test files also exited 0. This late display-only correction did not run additional Linux processes; the integration owner reruns the final build/gates on the updated snapshot.

## Every worker pass retrieves current source protocols

Browser verification exposed an inherited six-hour cache in general worker runs. The approved ten-minute collection cadence requires actual protocol requests, not merely schedule/DB checks. A new real-PostgreSQL regression first failed with **one detail fetch instead of two** on the second automatic pass (runtime RED, 1 test failed). The worker now explicitly disables the optional low-level recent-fetch cache for every general manual and automatic run. The direct low-level `syncKhlResults` default remains compatible with existing callers.

The regression uses the real `901981` fixture followed by an explicitly synthetic source-ID correction in the isolated DB. It verifies that the next automatic pass sees the correction, activates all 47 players and creates a new revision; a subsequent manual pass actually requests the same protocol and reuses its snapshot/revision. `lastAttemptAt` advances.

An additional runtime RED showed `newlyChanged: 1` for changed raw metadata with an unchanged normalized revision. Both worker ingestion paths now count changed data using revision reuse, not raw snapshot reuse. A fourth direct request changes only ignored source metadata: exact raw evidence is retained as a third snapshot, the revision count stays at two, `newlyChanged` is zero, and `lastChangedAt` stays unchanged.

Final scoped Linux verification: `node node_modules/tsx/dist/cli.mjs --test tests/khlSyncWorker.test.ts tests/khlAutoSync.test.ts` — **17/17 passed, exit 0**, 7.61 seconds. Local TypeScript and ESLint passed. The integration owner reruns full tests, build and browser checks after this correction; production was not modified by these tests.
