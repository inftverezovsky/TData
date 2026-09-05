# KHL sync recovery: deployment and rollback

## Verified baseline (2026-09-05)

- Canonical source: `TData-parser-reliability`, baseline `3cf1078ebd9d2e502cd90aeeb63632be1b122cb6`.
- SSH alias: `tdata-server`; target `/root/tdata`; Compose project `tdata`.
- Web: `tdata-web`, `127.0.0.1:3010`, health `/api/health`, Node `24.15.0`.
- Previous image: `inftverezovsky/tdata-web:tline-3cf1078ebd9d2e502cd90aeeb63632be1b122cb6`.
- Previous image ID: `sha256:098cc0985c054f5fb84ca560a702ab1a8af6a39669cd7c5f7926964f85debe0b`.
- PostgreSQL: `tdata-postgres`, PostgreSQL 16, network `tdata_default`.
- All 14 repository migration checksums match production's applied records. Production also has historical applied record `20260528210000_manual_import_team_mapping` (checksum `9f7d8826ce2efd788db7101d8d548fd1976d9d3f8f6dcde95d7724360d2c0ae9`), absent from the current image/source. Do not delete or otherwise reconcile that unrelated record during KHL rollout.
- Read-only PostgreSQL inspection confirms KHL raw bodies are `bytea`, hashes are `character(64)`, external IDs are text, and KHL indexes/foreign keys match the existing KHL migrations.
- A subsequent actual read-only catalog comparison against clean migration-built test database `tdata_khl_browser_20260905_1815` in isolated container `tdata-khl-test-20260905-1739` found **zero differences** for existing KHL objects: 152 columns (including `format_type`, defaults and nullability), 30 constraints, 58 indexes, and 25 enum labels. Both canonical metadata SHA-256 values were `439a30c080384cfb5d1aec4e15aff001041b9a6079db016c7797963fd4dec5a3`. The only excluded new objects were tables `KhlSyncRun`/`KhlSyncControl` and enums `KhlSyncRunStatus`/`KhlSyncTrigger`. This used PostgreSQL catalogs only, not Prisma migrate-diff, and read no business rows.
- The legacy `tdata-khl-results-sync.timer` is active, but its service reports `NOT_CONFIGURED` and `paused:true`.

Re-inventory immediately before applying. The baseline is evidence, not permission to assume external state stayed unchanged.

## Isolation and release artifact

Never run the generic `deploy-all.ps1`/`ssh-redeploy.ps1` unchanged: the former pushes an image; the latter omits the effective production overlays. Do not replace `/root/tdata` with a recovered checkout. Do not use `docker compose down`, broad `up`, prune, or restart databases/nginx/other workers.

After tests and review, create a scoped commit. Build from a `git archive` of that exact commit, not the working directory. Upload the archive to a unique `/root/tdata/deployments/builds/khl-<commit>/` directory and verify its SHA-256. Build a distinct local server image tag, for example `tdata-khl:<commit>`, using the existing Dockerfile. Do not push to a registry. Do not overwrite the previous image tag. Building an image does not authorize starting its default migration command.

Preserve the container IDs and image IDs of `tdata-tline-worker`, `tdata-telegram-consultant`, `tdata-postgres`, Portainer, and all `betcity-shift-scheduler` services. Verify they remain unchanged after rollout.

## Effective environment and additive overlay

The server's `.env` alone cannot reproduce production: Compose interpolation fails for required variables. Never print `docker inspect` wholesale, save resolved Compose JSON, export environment contents to files, or place secrets in an overlay.

Load the running containers' environment dictionaries **only in process memory**, in this order: `tdata-postgres`, `tdata-telegram-consultant`, `tdata-tline-worker`, `tdata-web`. Exclude base-image keys `PATH`, `HOME`, `HOSTNAME`, `LANG`, `LC_ALL`, `PGDATA`. Pass the merged dictionary as the child process environment, not arguments. The full current Compose chain then reproduces the running web environment exactly; this was checked without printing values.

Read the effective file chain from `tdata-web` label `com.docker.compose.project.config_files`. The verified chain is:

1. `/root/tdata/docker-compose.yml`
2. `/root/tdata/deployments/compose/tdata-public-1d87c8a.override.yml`
3. `/root/tdata/deployments/compose/tdata-hltv-d1498b7.override.yml`
4. `/root/tdata/deployments/compose/tdata-parser-7eccac5.override.yml`
5. `/root/tdata/deployments/compose/tdata-telegram-8cf699a.override.yml`
6. `/root/tdata/deployments/compose/tdata-consultant-3cf1078.override.yml`

Append one uniquely named non-secret overlay; do not edit those six files:

```yaml
services:
  web:
    image: ${KHL_RELEASE_IMAGE:?KHL_RELEASE_IMAGE required}
    environment:
      KHL_RESULTS_AUTO_SYNC_ENABLED: "1"
      KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES: "10"
  khl-worker:
    image: ${KHL_RELEASE_IMAGE:?KHL_RELEASE_IMAGE required}
    container_name: tdata-khl-worker
    restart: unless-stopped
    command: ["npm", "run", "worker:khl-results"]
    environment:
      DATABASE_URL: ${DATABASE_URL:?Existing web DATABASE_URL required}
      KHL_RESULTS_AUTO_SYNC_ENABLED: "1"
      KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES: "10"
    networks: [default]
```

Set `KHL_RELEASE_IMAGE` in the deployment process only. It is a non-secret immutable tag. `DATABASE_URL` comes from the existing web runtime, never from a stored resolved overlay. Before applying, capture `docker compose ... config --format json` in memory, compare existing web environment values, and allow changes only to the two KHL keys above. Compare existing unrelated service images and definitions; reject unintended changes. Print only differing key names, never values.

The deployment helper must retain its environment dictionary while it runs Compose, including rollback; replacing web must not lose the previous runtime configuration. This also avoids shell interpolation of password characters.

## Schema and verified backups

Use a root-only directory such as `/root/tdata/backups/khl-<UTC>-<commit>/` with mode `0700` and artifacts `0600`. Keep all backups on the server, outside Git and web-served paths.

1. Save the previous image with `docker image save`, its image ID, exact byte copies of the six **reviewed non-secret source** Compose files, container IDs, KHL timer state, and a non-secret rollback command description. The helper requires the reviewed ordered file chain and pinned source SHA-256 values, rejects inline credential fields/credential defaults and occurrences of existing runtime secrets, and validates all source bytes before creating copies. Store copies in `compose/` (`0700`) as numbered files (`0600`) with original path, relative backup path, length and SHA-256 in the manifest. Existing secret files stay in their existing secure storage; do not serialize runtime environment values or copy `.env`.
2. Produce a complete custom-format PostgreSQL backup with `pg_dump -Fc --no-owner --no-acl` executed inside `tdata-postgres`, reading the existing `POSTGRES_USER` and `POSTGRES_DB` there. Redirect its binary stream only to the private server backup file. Fail on a nonzero exit; record size and SHA-256.
3. Verify `pg_restore --list`, then restore into a **new uniquely named database in an isolated PostgreSQL test container**, never into production or the active application test database. Wait until PID 1 is the final `postgres` process and an authenticated TCP `SELECT 1` succeeds against the requested database. Unix-socket `pg_isready` alone can accept PostgreSQL's temporary initialization server and is not sufficient. Use `--exit-on-error --no-owner --no-acl`. Do not point any app, worker, or automated test at this restored production backup.
4. Check restored schema, migration records, and representative table counts without printing rows or identifiers. The helper then removes only its newly created, ownership-labelled restore container/anonymous volume/network so the private production-data clone does not remain running. No existing database may be removed or reused.
5. Compare production and a clean migration-built test DB using ordered `pg_catalog` projections: columns with `format_type`/nullability/defaults, `pg_get_constraintdef`, enum labels, and `pg_indexes`. For the pre-existing KHL objects, require equality; review new KHL queue objects separately. Do not run Prisma migrate-diff against production.
6. Confirm the release introduces only the intended additive KHL migration. Apply it only after backup restore verification succeeds. Do not modify the old historical migration record.

## Cutover and rollback

After all local/test gates and backups pass:

1. Stop/disable **only** `tdata-khl-results-sync.timer`; ensure its oneshot service has completed before starting the new worker. Record whether it had been enabled and active.
2. Using the complete Compose chain plus KHL overlay and preserved in-memory environment, recreate **only web** with `up -d --no-deps --no-build --force-recreate web`. Wait for health; verify new image ID/source hashes.
3. Start **only khl-worker** with `up -d --no-deps --no-build khl-worker`. Confirm worker heartbeat and database-backed status, not just container existence. Enable automatic collection through the normal application control if it remains paused.
4. Verify a manual run, protocol display, pause/resume, and one unattended automatic interval. Confirm last-check timestamps advance even when source content is unchanged. Recheck preserved unrelated container IDs.

On a failed smoke check: stop only `khl-worker` and recreate web alone with the verified previous image ID and backed-up source Compose chain. The helper verifies copied bytes/permissions independently of whether originals still exist; it does not overwrite original files. `--project-directory /root/tdata` keeps relative certificate/volume paths anchored to the production project rather than the backup directory. Confirm the previous image ID and health. Restore the legacy timer to its recorded state. Leave unused additive KHL tables intact. Database restore is a separate emergency procedure requiring the validated backup and a deliberate production outage; do not improvise destructive schema rollback.

Deployment success requires observed data ingestion and a completed automatic cycle, not merely HTTP 200 or a healthy container. No Admin results sender, result HTTP write, or delivery attempt is part of this rollout.

## Scoped helper

`scripts/deploy-khl-release.py` uses only Python's standard library and runs **on the server**. Its default mode is read-only `inspect`. All mutations require `--apply`; `backup` requires a new direct child of `/root/tdata/backups`, and `deploy`/`rollback` require that backup's verified manifest and artifact hashes. The manifest contains non-secret metadata only. The helper writes a JSON-format Compose overlay (valid Compose YAML) inside the private backup directory; no resolved database URL or other secret is written there.

The exact Compose-copy preflight was also executed read-only against all six production source files: their reviewed hashes and credential-reference checks passed; no copies, backups or deployment changes were created by that preflight. Deploy still requires unchanged original Compose files. Rollback instead consumes the verified backup copies, so missing or changed originals do not prevent recovery.

```text
python3 scripts/deploy-khl-release.py inspect
python3 scripts/deploy-khl-release.py backup --apply --backup-dir /root/tdata/backups/khl-<unique-UTC>
python3 scripts/deploy-khl-release.py deploy --apply --backup-dir /root/tdata/backups/khl-<unique-UTC> --image tdata-khl:<full-commit>
python3 scripts/deploy-khl-release.py rollback --apply --backup-dir /root/tdata/backups/khl-<unique-UTC>
```

The release must have exactly the reviewed pending migrations `20260905173000_khl_sync_worker` and `20260905180000_khl_sync_source_identity`, with their exact SHA-256 values pinned in the helper. It recomputes SQL hashes instead of trusting reported hashes. Existing migration checksums must still match. The release tag is resolved once at entry; validation, the migration runner, and both web/worker overlays use that same immutable `sha256:` image ID. The tag is kept only as a manifest label, so retagging cannot substitute a different image between validation and execution. Rollback also uses the backed-up image ID rather than a mutable tag.

Deploy verifies the original schema fingerprint is unchanged since backup, stops only the old KHL timer, uses a one-shot migration runner, recreates web alone, starts the KHL worker, and checks its fresh database heartbeat. Automatic rollback restores the previous image and recorded timer state on a failed cutover. Schema changes remain additive. A different subsequent release cannot be overwritten by the standalone rollback mode.

Run offline helper safety tests with `PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -p test_deploy_khl_release.py -v` (set the environment variable separately in PowerShell). These tests do not contact Docker or production; they do not substitute for actual backup/restore and browser verification.
