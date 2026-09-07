#!/usr/bin/env bash
# Обновить только существующий TData: inventory → ownership → backup → image → health.
# Схема должна быть уже совместима с образом. Миграции требуют отдельного окна и плана восстановления БД.
set -Eeuo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ ${TDATA_DEPLOY_DIR:-} == /root/tdata ]] || fail 'Unexpected application directory.'
[[ ${TDATA_DEPLOY_IMAGE:-} =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$ ]] || fail 'An immutable image digest is required.'
[[ ${TDATA_DEPLOY_TIMEOUT:-} =~ ^[0-9]+$ ]] || fail 'Invalid health deadline.'

# До любого изменения сервера показываем только несекретные сведения.
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' || fail 'Container inventory failed.'
docker compose ls || fail 'Compose inventory failed.'
ss -ltn || fail 'Port inventory failed.'
df -h "$TDATA_DEPLOY_DIR" || fail 'Disk inventory failed.'
stat -c '%A %U %n' "$TDATA_DEPLOY_DIR" || fail 'Target inventory failed.'
[[ $(realpath -- "$TDATA_DEPLOY_DIR") == "$TDATA_DEPLOY_DIR" ]] || fail 'Application directory must not be a symlink.'
cd -- "$TDATA_DEPLOY_DIR"
[[ -f docker-compose.yml && -f .env ]] || fail 'Canonical compose and runtime environment are required.'
[[ ! -L .deploy-backups && ! -L .deploy.lock && ! -L .deploy-image.env ]] || fail 'Deployment state must not use symlinks.'
exec 9>.deploy.lock
flock -n 9 || fail 'Another TData deployment is active.'
compose() { docker compose -p tdata -f docker-compose.yml "$@"; }
owned_container() {
  local cid
  cid=$(compose ps -q "$1")
  [[ -n "$cid" && "$cid" != *$'\n'* ]] || fail 'Exactly one existing target container is required.'
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$cid") == tdata ]] || fail 'Container belongs to another project.'
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid") == "$TDATA_DEPLOY_DIR" ]] || fail 'Container belongs to another directory.'
  printf '%s' "$cid"
}
web_id=$(owned_container web)
worker_id=$(owned_container tline-worker)
db_id=$(owned_container postgres)
[[ $(docker inspect --format '{{(index (index .HostConfig.PortBindings "3010/tcp") 0).HostIp}}:{{(index (index .HostConfig.PortBindings "3010/tcp") 0).HostPort}}' "$web_id") == 127.0.0.1:3010 ]] || fail 'Unexpected frontend port ownership.'
old_image=$(docker inspect --format '{{.Image}}' "$web_id")
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cannot identify rollback image.'
[[ $(docker inspect --format '{{.Image}}' "$worker_id") == "$old_image" ]] || fail 'Web and worker must share a known rollback image.'
export TDATA_IMAGE="$TDATA_DEPLOY_IMAGE"
compose config --quiet >/dev/null 2>&1 || fail 'Compose validation failed.'
docker pull "$TDATA_IMAGE" >/dev/null 2>&1 || fail 'Image pull failed.'
expected_image=$(docker image inspect --format '{{.Id}}' "$TDATA_IMAGE")
[[ "$expected_image" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cannot identify downloaded image.'
compose config --format json 2>/dev/null | docker run --rm -i --network none --entrypoint node "$TDATA_IMAGE" -e '
  let input=""; process.stdin.on("data", chunk=>input+=chunk).on("end",()=>{
    try { const c=JSON.parse(input), w=c.services.web, p=w.ports;
      const worker=c.services["tline-worker"], image=process.argv[1];
      process.exit(c.name==="tdata" && p.length===1 && p[0].host_ip==="127.0.0.1" && String(p[0].published)==="3010" && p[0].target===3010 && w.container_name==="tdata-web" && worker.container_name==="tdata-tline-worker" && w.image===image && worker.image===image ? 0 : 1);
    } catch { process.exit(1); }
  });' "$TDATA_IMAGE" >/dev/null 2>&1 || fail 'Compose image, target or published ports differ from the canonical project.'
# migrate status читает историю; pending/failed migrations останавливают выкладку до остановки приложения.
compose run --rm --no-deps web npm run db:migrate:status >/dev/null 2>&1 || fail 'Schema is not ready. Apply reviewed migrations in a separate maintenance window first.'
mkdir -p -- .deploy-backups
backup=".deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
docker exec "$db_id" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup" 2>/dev/null || fail 'Database backup failed; service unchanged.'
[[ -s "$backup" ]] || fail 'Database backup is empty; service unchanged.'
docker exec -i "$db_id" pg_restore --list < "$backup" >/dev/null 2>&1 || fail 'Backup verification failed; service unchanged.'

healthy() {
  local deadline=$((SECONDS + TDATA_DEPLOY_TIMEOUT)) cid worker
  while (( SECONDS < deadline )); do
    cid=$(compose ps -q web) || return 1
    worker=$(compose ps -q tline-worker) || return 1
    if [[ -n "$cid" && -n "$worker" ]] &&
      [[ $(docker inspect --format '{{.Image}}' "$cid") == "$expected_image" ]] &&
      [[ $(docker inspect --format '{{.Image}}' "$worker") == "$expected_image" ]] &&
      [[ $(docker inspect --format '{{.State.Running}}' "$worker") == true ]] &&
      docker exec "$cid" node -e 'fetch("http://127.0.0.1:3010/api/health",{signal:AbortSignal.timeout(5000)}).then(async r=>process.exit(r.ok&&(await r.json()).ok===true?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}
rollback() {
  trap - ERR
  export TDATA_IMAGE="$old_image"
  expected_image="$old_image"
  if compose up -d --no-deps --no-build --pull never --force-recreate web tline-worker >/dev/null 2>&1 && healthy; then
    printf 'TDATA_IMAGE=%s\n' "$old_image" > .deploy-image.env
    fail 'Deployment failed; previous web and worker images restored and healthy.'
  fi
  fail 'Deployment and image rollback failed. Database backup retained; operator intervention required.'
}
trap rollback ERR
if ! compose up -d --no-deps --no-build --pull never --force-recreate web tline-worker >/dev/null 2>&1; then rollback; fi
if ! healthy; then rollback; fi
printf 'TDATA_IMAGE=%s\n' "$TDATA_IMAGE" > .deploy-image.env
trap - ERR
printf 'TData web and worker healthy. Immutable image recorded; verified database backup retained.\n'
