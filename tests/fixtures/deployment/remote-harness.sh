#!/usr/bin/env bash
# Локальная модель Docker/SSH окружения: ни одна команда не обращается к daemon или сети.
set -eu
scenario=$1
script=$2
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
touch "$fixture/docker-compose.yml" "$fixture/.env"
export TDATA_DEPLOY_DIR=/root/tdata
export TDATA_DEPLOY_IMAGE="fixture/tdata@sha256:$(printf 'a%.0s' {1..64})"
export TDATA_DEPLOY_TIMEOUT=1
old="sha256:$(printf 'b%.0s' {1..64})"
new="sha256:$(printf 'c%.0s' {1..64})"
printf '%s' "$old" > "$fixture/active-image"
cd() { builtin cd -- "$fixture"; }
ss() { printf 'ports inventoried\n'; }
df() { printf 'disk inventoried\n'; }
stat() { printf 'target inventoried\n'; }
realpath() { printf /root/tdata; }
sleep() { SECONDS=$((SECONDS + 10)); }
docker() {
  printf '%s\n' "$*" >> "$fixture/commands"
  case "$*" in
    'ps -a --format '*|'compose ls') return 0;;
    'compose -p tdata -f docker-compose.yml ps -q '*) printf '%s' "${*: -1}"; return 0;;
    'inspect --format '*com.docker.compose.project.working_dir*) printf /root/tdata; return 0;;
    'inspect --format '*com.docker.compose.project*)
      if [[ $scenario == foreign ]]; then printf other; else printf tdata; fi; return 0;;
    'inspect --format '*HostConfig.PortBindings*)
      if [[ $scenario == port ]]; then printf 0.0.0.0:80; else printf 127.0.0.1:3010; fi; return 0;;
    'inspect --format {{.Image}} '*) cat "$fixture/active-image"; return 0;;
    'image inspect --format {{.Id}} '*) printf '%s' "$new"; return 0;;
    'inspect --format {{.State.Running}} '*) printf true; return 0;;
    'compose -p tdata -f docker-compose.yml config --quiet'|'pull '*) return 0;;
    'compose -p tdata -f docker-compose.yml config --format json') printf '{}'; return 0;;
    'run --rm -i --network none --entrypoint node '*) cat >/dev/null; [[ $scenario != configport && $scenario != configimage ]]; return;;
    'compose -p tdata -f docker-compose.yml run --rm --no-deps web npm run db:migrate:status') [[ $scenario != migration ]]; return;;
    'exec postgres sh -c '*) [[ $scenario != backup ]] || return 1; printf 'fixture backup'; return 0;;
    'exec -i postgres pg_restore --list') return 0;;
    'compose -p tdata -f docker-compose.yml up -d --no-deps --no-build --pull never --force-recreate web tline-worker')
      [[ $scenario != rollbackfail ]] || return 1
      [[ $scenario != upfail || $TDATA_IMAGE == "$old" ]] || return 1
      if [[ $TDATA_IMAGE == "$old" || $scenario == wrongimage ]]; then printf '%s' "$old" > "$fixture/active-image"; else printf '%s' "$new" > "$fixture/active-image"; fi
      printf 'recreated=%s\n' "$TDATA_IMAGE"; return 0;;
    'exec web node -e '*) [[ $scenario != healthfail || $TDATA_IMAGE == "$old" ]]; return;;
    *) printf 'UNEXPECTED COMMAND: %s\n' "$*" >&2; return 99;;
  esac
}
set +e
(source "$script")
status=$?
set -e
case "$scenario" in
  success) [[ $status == 0 ]]; grep -q "TDATA_IMAGE=$TDATA_DEPLOY_IMAGE" "$fixture/.deploy-image.env";;
  foreign|port|configport|configimage|migration|backup)
    [[ $status != 0 ]]; ! grep -q 'force-recreate' "$fixture/commands";;
  upfail|healthfail|wrongimage)
    [[ $status != 0 ]]; grep -q "TDATA_IMAGE=$old" "$fixture/.deploy-image.env";;
  rollbackfail) [[ $status != 0 ]]; [[ ! -f "$fixture/.deploy-image.env" ]];;
  *) exit 99;;
esac
printf 'Verified scenario: %s\n' "$scenario"
