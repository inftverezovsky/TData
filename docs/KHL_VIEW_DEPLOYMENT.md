# KHL protocol view-only release

This scoped follow-up fixes frontend hydration across the Moscow day boundary after the diagnostic protocol view release. It does not modify parsing, normalized revisions, bindings, the database schema, collection settings, or the KHL worker. Real Admin delivery remains disabled.

## Verified starting point

Read-only post-cutover inventory on 2026-09-05 at approximately 21:03 UTC confirmed:

- Canonical checkout: `TData-parser-reliability`; source baseline `5af21ff0542d22f3b944d8cf8b563b5479540a27`.
- Server SSH alias `tdata-server`; Compose project `tdata`; project directory `/root/tdata`.
- Web image ID `sha256:15d2e8b81348209fe6d7c8f98a3dac17173b1f509f87284ff280397126aa46be`; started `2026-09-05T20:56:53.617041616Z`; loopback `127.0.0.1:3010`; `/api/health` healthy; nginx active.
- KHL worker ID `00eeea3f059059dde2b2fbb8e876d3c3aba2f00f8b8694ced6a1c882fff6b23f`, started `2026-09-05T19:50:28.657611866Z`, image `sha256:51c6e42e9505693da76ee611e2d7347543dac8a5cbad619a22ed8e12a05c3e7d`, no published ports. The worker must remain running without restart; its image is intentionally different from the current web baseline.
- All ten pre-existing non-web containers, the schema, 17 applied migration records and confirmed binding fingerprint were unchanged; delivery and attempt counts remained zero. A standalone automatic cycle completed at `21:02:55.481Z` after checking six matches, with only the known persisted diagnostic identity issue.
- Recheck disk and RAM before creating another full backup or build.

The effective Compose chain consists of the six reviewed files documented in `KHL_SYNC_DEPLOYMENT.md`, followed by `/root/tdata/backups/khl-20260905-verified-1930/khl-release.override.json` (SHA-256 `a80d5e7e98fd51296af15a8778dce63eb0fc1be8ca57baa1d8e2b8827bcdf2d3`) and `/root/tdata/backups/khl-view-20260905-2058/khl-view-release.override.json` (SHA-256 `6544e7d1b71d1b6449bc0cf1c9512682a1fbdd16eb6cdc5180eef00a7e315411`). Do not edit any of these eight originals or previous backup manifests. Earlier rollouts are complete; do not rerun their deployment procedures.

## Release and backup gates

Use `scripts/deploy-khl-view-release.py`, keeping the unchanged `scripts/deploy-khl-release.py` beside it: the new helper imports the earlier tested backup and safety primitives into a private module. Do not execute the older helper's mutating modes for this release.

Build a unique image from the exact reviewed feature commit, verify source archive/file hashes, and retain the previous image. Do not use a mutable test-container filesystem as source. The helper resolves the release tag once to its full `sha256:` ID and uses that ID for validation and cutover. It rejects changes to image runtime configuration, backend files, scripts, Prisma schema/migrations, dependencies, systemd units, TypeScript/Next configuration, and existing static assets. The only script exceptions are this deployment helper and the standalone read-only `scripts/verify-khl-identity-browser.ts` / `scripts/verify-khl-midnight-browser.ts`, each at its exact reviewed SHA-256 pinned in the helper. The existing identity verifier must remain unchanged. No filename wildcard exception exists; any diagnostic script edit requires renewed review and an explicit hash update before deployment. Runtime-file comparison is not a substitute for the exact Git archive/source review of the compiled frontend.

Before cutover, create a **new** unique private backup directory. The helper saves the full PostgreSQL custom-format dump, previous image archive, and exact copies of all eight reviewed non-secret Compose files. It records hashes and permissions, restores the dump into a newly created private PostgreSQL container/network with no published ports, and compares schema/migration metadata. It removes only its own labelled restore resources afterwards. Do not point an application or worker at the restored production-data clone. Existing databases are never reused or removed. Upload this baseline-specific helper and its unchanged shared dependency into a new private tools directory; retain earlier tool directories so their exact previous rollback procedures remain available.

All credentials stay in existing runtime environment or process memory. No `.env` copy, resolved Compose file, credential-bearing command argument, or runtime-environment serialization is allowed. Backups remain server-local, outside Git and web paths, with directory mode `0700` and file mode `0600`.

The follow-up backup `/root/tdata/backups/khl-view-20260905-2106` was actually restored and verified before cutover: dump SHA-256 `799d7ac80368b44c2fd3e89e9a3f2556102b7ecd0a973ab427f1c1dc80ff6429` (7,297,440 bytes); previous image archive SHA-256 `a57a9fc0388f2d4215353cca9ea4efd6a2063a192f8f007fabae01b0926885d9` (3,499,082,752 bytes). Restored schema and all 17 migration records matched production; confirmed bindings, zero delivery/attempt counts, and web/non-web identities and start times were preserved. The clone contained 17 matches, 88 raw snapshots and 28 revisions; ongoing collection may increase source-data counts afterwards. The private manifest and `view-backup-verification.json` contain the detailed non-secret evidence. This backup does not itself mean the follow-up has been deployed.

## Commands on the server

Run from the directory containing the two reviewed scripts, substituting a genuinely new backup directory and the reviewed commit tag:

```text
python3 deploy-khl-view-release.py inspect
python3 deploy-khl-view-release.py backup --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC>
python3 deploy-khl-view-release.py deploy --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC> --image tdata-khl-view:<full-commit>
python3 deploy-khl-view-release.py rollback --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC>
```

The default mode is read-only. Production mutations require the reviewed release gates, explicit `--apply`, and a verified backup manifest for this exact baseline.

The preceding release's read-only preflight verified its seven source-file hashes and credential-reference checks, reproduced the running web environment in memory, and confirmed the exact web baseline and loopback port. The follow-up must repeat these checks for the current eight-file chain. The legacy KHL timer remains disabled and inactive.

Deploy and rollback append an overlay containing **only** the web image and `command: ["npm", "run", "start"]`. This explicitly bypasses the image's migration-bearing default command. They recreate only `web`, using `--no-deps --no-build`, preserving its complete runtime environment and loopback port. No migrations or timer operations run. Worker/database/nginx/other containers are not stopped or recreated; every pre-existing non-web container is checked by ID, image ID and start time before and after cutover. Database schema and applied migration metadata must remain identical.

A failed cutover automatically restores the previous web image, again without running migrations. Standalone rollback consumes verified backup Compose copies with `--project-directory /root/tdata`, preserving relative production paths without overwriting originals. The previous image must still be present; if not, explicitly load its verified private image archive first. Database restore is not part of web rollback.

After deployment, verify the actual browser protocol display, including all diagnostic roster rows without confirmed KHL IDs, existing team/player statistics, and staging remaining blocked for unresolved identities. Confirm the KHL worker ID/start time, automatic collection status, binding fingerprints and delivery-attempt count remain unchanged. Health HTTP 200 alone is not completion evidence.

Offline safety tests (no Docker or production access):

```text
python -m unittest discover -s tests -p test_deploy_khl_view_release.py -v
python -m unittest discover -s tests -p test_deploy_khl_release.py -v
```

Set `PYTHONDONTWRITEBYTECODE=1` in the test process environment. Offline tests do not substitute for verified backup/restore and browser smoke checks.
