# KHL protocol view-only release

This scoped release changes the frontend presentation of diagnostic protocols only. It does not modify parsing, normalized revisions, bindings, the database schema, collection settings, or the KHL worker. Real Admin delivery remains disabled.

## Verified starting point

Read-only inventory on 2026-09-05 at approximately 20:31 UTC confirmed:

- Canonical checkout: `TData-parser-reliability`; source baseline `7b7a7297fa8c13e7bf0e01d3cfe60ea367736d42`.
- Server SSH alias `tdata-server`; Compose project `tdata`; project directory `/root/tdata`.
- Web image ID `sha256:51c6e42e9505693da76ee611e2d7347543dac8a5cbad619a22ed8e12a05c3e7d`; loopback `127.0.0.1:3010`; `/api/health` healthy; nginx active.
- KHL worker ID `00eeea3f059059dde2b2fbb8e876d3c3aba2f00f8b8694ced6a1c882fff6b23f`, started `2026-09-05T19:50:28.657611866Z`, same image as web, no published ports. The worker must remain running without restart.
- About 32 GiB disk space and 9.7 GiB available RAM. Recheck before building/backing up.

The effective Compose chain consists of the six reviewed files documented in `KHL_SYNC_DEPLOYMENT.md`, followed by `/root/tdata/backups/khl-20260905-verified-1930/khl-release.override.json`. The seventh file's SHA-256 is `a80d5e7e98fd51296af15a8778dce63eb0fc1be8ca57baa1d8e2b8827bcdf2d3`. Do not edit any of these originals. The first worker rollout is already complete; do not rerun the old deployment procedure.

## Release and backup gates

Use `scripts/deploy-khl-view-release.py`, keeping the unchanged `scripts/deploy-khl-release.py` beside it: the new helper imports the earlier tested backup and safety primitives into a private module. Do not execute the older helper's mutating modes for this release.

Build a unique image from the exact reviewed feature commit, verify source archive/file hashes, and retain the previous image. Do not use a mutable test-container filesystem as source. The helper resolves the release tag once to its full `sha256:` ID and uses that ID for validation and cutover. It rejects changes to image runtime configuration, backend files, scripts, Prisma schema/migrations, dependencies, systemd units, TypeScript/Next configuration, and existing static assets. The only script additions allowed are this deployment helper and the standalone read-only `scripts/verify-khl-identity-browser.ts` at its exact reviewed SHA-256 pinned in the helper. No filename wildcard exception exists; any diagnostic script edit requires renewed review and an explicit hash update before deployment. Runtime-file comparison is not a substitute for the exact Git archive/source review of the compiled frontend.

Before cutover, create a **new** unique private backup directory. The helper saves the full PostgreSQL custom-format dump, previous image archive, and exact copies of all seven reviewed non-secret Compose files. It records hashes and permissions, restores the dump into a newly created private PostgreSQL container/network with no published ports, and compares schema/migration metadata. It removes only its own labelled restore resources afterwards. Do not point an application or worker at the restored production-data clone. Existing databases are never reused or removed.

All credentials stay in existing runtime environment or process memory. No `.env` copy, resolved Compose file, credential-bearing command argument, or runtime-environment serialization is allowed. Backups remain server-local, outside Git and web paths, with directory mode `0700` and file mode `0600`.

## Commands on the server

Run from the directory containing the two reviewed scripts, substituting a genuinely new backup directory and the reviewed commit tag:

```text
python3 deploy-khl-view-release.py inspect
python3 deploy-khl-view-release.py backup --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC>
python3 deploy-khl-view-release.py deploy --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC> --image tdata-khl-view:<full-commit>
python3 deploy-khl-view-release.py rollback --apply --backup-dir /root/tdata/backups/khl-view-<unique-UTC>
```

The default mode is read-only. Production mutations require the reviewed release gates, explicit `--apply`, and a verified backup manifest for this exact baseline.

A subsequent read-only preflight verified all seven source-file hashes and credential-reference checks, reproduced the running web environment in memory, and confirmed the exact web baseline and loopback port. Ten pre-existing non-web containers, including the unchanged KHL worker, were identified for protection. The legacy KHL timer was disabled and inactive. No backup, file copy or deployment mutation was performed by that preflight.

Deploy and rollback append an overlay containing **only** the web image and `command: ["npm", "run", "start"]`. This explicitly bypasses the image's migration-bearing default command. They recreate only `web`, using `--no-deps --no-build`, preserving its complete runtime environment and loopback port. No migrations or timer operations run. Worker/database/nginx/other containers are not stopped or recreated; every pre-existing non-web container is checked by ID, image ID and start time before and after cutover. Database schema and applied migration metadata must remain identical.

A failed cutover automatically restores the previous web image, again without running migrations. Standalone rollback consumes verified backup Compose copies with `--project-directory /root/tdata`, preserving relative production paths without overwriting originals. The previous image must still be present; if not, explicitly load its verified private image archive first. Database restore is not part of web rollback.

After deployment, verify the actual browser protocol display, including all diagnostic roster rows without confirmed KHL IDs, existing team/player statistics, and staging remaining blocked for unresolved identities. Confirm the KHL worker ID/start time, automatic collection status, binding fingerprints and delivery-attempt count remain unchanged. Health HTTP 200 alone is not completion evidence.

Offline safety tests (no Docker or production access):

```text
python -m unittest discover -s tests -p test_deploy_khl_view_release.py -v
python -m unittest discover -s tests -p test_deploy_khl_release.py -v
```

Set `PYTHONDONTWRITEBYTECODE=1` in the test process environment. Offline tests do not substitute for verified backup/restore and browser smoke checks.
