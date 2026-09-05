# KHL diagnostic roster and ingest evidence checks

Date: 2026-09-05. Intent: retain complete official protocols when an upstream player ID is unavailable, without creating invented identities or permitting delivery.

The public fixture `tests/fixtures/khl/missing-player-ids-901981.json` was downloaded directly, without JSON reserialization, from `https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=3000063&stage_id=407&locale=ru`. SHA-256: `c63c8c516221faa06556d3737ce54c35e7ef6d1e538b007de37316addb742cab`. It contains 47 roster slots, five zero KHL player IDs, a regulation score of 3:3 and official score of 4:3 after overtime.

## RED / GREEN evidence

| Guarantee | RED observed before implementation | GREEN test |
| --- | --- | --- |
| All roster rows remain visible with missing IDs, points stay with their source API identities | Four diagnostic-roster tests failed: missing-ID schema exceptions and duplicate API identity accepted | `tests/khlDiagnosticRoster.test.ts` |
| Hard schema failures retain exact raw bytes; mismatched response identity never attaches to a match; expired worker cannot commit evidence | Four evidence tests failed: no retained snapshot, missing boundary checks, missing lease guard | `tests/khlIngestEvidence.test.ts` |
| An unresolved player cannot enter payload even with forged successful validation metadata | New payload regression failed with “Missing expected exception” | `tests/khlAdminPayload.test.ts` |
| Malformed JSON, malformed wrappers and invalid UTF-8 reach the repository as exact raw evidence | Three client-to-ingest tests failed before raw envelopes were preserved; a stricter UTF-8 regression also failed before fatal decoding was added | `tests/khlClientEvidence.test.ts` |
| Manual ingest uses the persistent worker queue, with no source HTTP in the request handler | Queue-route test returned 502 instead of 202 and performed a source request | `tests/khlIngestRoute.test.ts` |

Command actually run after implementation:

```sh
node node_modules/tsx/dist/cli.mjs --test tests/khlDiagnosticRoster.test.ts tests/khlIngestEvidence.test.ts tests/khlAdminPayload.test.ts tests/khlNormalize.test.ts tests/khlMatchProtocol.test.ts tests/khlResultsViewModel.test.ts
```

Result: 29 tests passed, no failures. Existing in-game penalty-shot, regulation-only player totals, shootout, overtime and qualifying-penalty rules are covered. Rendering checks count all 47 player rows and five missing-ID labels.

The same target with `--experimental-test-coverage` passed with aggregate 80.84% line and 80.34% branch coverage. Parser coverage was 97.57% lines / 82.14% branches. This focused run does not establish complete repository integration coverage.

Latest expanded target after the raw-client and queued-route changes:

```sh
node node_modules/tsx/dist/cli.mjs --test tests/khlClientEvidence.test.ts tests/khlClient.test.ts tests/khlDiagnosticRoster.test.ts tests/khlIngestEvidence.test.ts tests/khlIngestRoute.test.ts tests/khlAdminPayload.test.ts tests/khlNormalize.test.ts tests/khlMatchProtocol.test.ts tests/khlResultsViewModel.test.ts
```

Result: 44 tests passed, no failures. The same expanded target reported 79.30% aggregate line coverage and 81.52% branch coverage; it imports additional queue/automation paths not exercised by this parser-focused run. Parser coverage was 97.57% lines / 82.88% branches. These figures are not a claim that the complete project's coverage threshold has passed.

Targeted ESLint over modified parser/repository/client/payload/protocol/route/UI/tests passed with exit 0. Whole-project `node node_modules/typescript/bin/tsc --noEmit --incremental false` subsequently passed with exit 0 after concurrent queue changes and Prisma client generation completed. The final consolidated lint, build and test gates are recorded by the coordinating implementation task.

## Database integration handoff

`tests/khlRepository.test.ts` adds real rejected-roster persistence/idempotency, later positive-ID correction, preservation of confirmed player mappings, raw-failure idempotency and transaction ownership checks.

First run used a new isolated PostgreSQL database through an SSH tunnel and failed on the pre-existing five-second interactive transaction timeout (P2028; individual source snapshot operations exceeded 9–33 seconds). The lease-loss check passed. Those timing failures are not counted as successful integration verification. The coordinating task will run this suite inside the isolated server network and record its final result.

The first isolated Linux run reported 9/10 combined repository/queue tests passed. The remaining corrected-source test reused an earlier fixture's unique API event ID; the test now supplies distinct game, API event and source match identifiers. The rerun is required before declaring this database gate passed.

No checkpoint commits were created: the user's requested workflow defers commits until all verification gates pass.
