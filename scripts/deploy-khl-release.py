#!/usr/bin/env python3
"""Run ON the TData server. Default inspect is read-only; no secrets are serialized."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path('/root/tdata')
BACKUPS = ROOT / 'backups'
BASELINE = 'sha256:098cc0985c054f5fb84ca560a702ab1a8af6a39669cd7c5f7926964f85debe0b'
TIMER = 'tdata-khl-results-sync.timer'
MIGRATIONS = {
    '20260905173000_khl_sync_worker': '01cdd0b9a981d1d3c9d89a9da28fabc0d15482dbf2df7961642391b7173489aa',
    '20260905180000_khl_sync_source_identity': '844063c815f0b23d76695fbd414037943801987197ea20d12f613a24a5d5331d',
}
EXTRA_MIGRATION = '20260528210000_manual_import_team_mapping'
BASE_ENV = {'PATH', 'HOME', 'HOSTNAME', 'LANG', 'LC_ALL', 'PGDATA'}
KHL_ENV = {'KHL_RESULTS_AUTO_SYNC_ENABLED', 'KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES'}
# Exact source files classified read-only: sensitive values are interpolation references only.
REVIEWED_COMPOSE = {
    '/root/tdata/docker-compose.yml': 'c47ee9d1d6bff6d97e50003352fe6c8b6043070fd658dbad2e1a1b999cf45c74',
    '/root/tdata/deployments/compose/tdata-public-1d87c8a.override.yml': 'e0ba3d16c314df40f2f1c590a878c45e7211f95f73a190ad8bb97ae14fbcaf75',
    '/root/tdata/deployments/compose/tdata-hltv-d1498b7.override.yml': 'c934fa58c68fa63cbb689811414124b927b69927fdf150291216cb6449ff8b95',
    '/root/tdata/deployments/compose/tdata-parser-7eccac5.override.yml': 'a7d251a221c5270b29b40a23b859301041049e2906e2c15838ade5591c2e353d',
    '/root/tdata/deployments/compose/tdata-telegram-8cf699a.override.yml': '746981cee731778960b69c8a2471652edfaf1e7aea1bdbec348b170563f83c44',
    '/root/tdata/deployments/compose/tdata-consultant-3cf1078.override.yml': 'c45937f3874d8550cb1ea460b0979521ba0626f08986fda756f8aa1239e8d3af',
}
SENSITIVE_KEY = re.compile(r'(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|API_KEY_VALUE|ARCCODEX_API_KEY)$', re.I)


class GuardError(Exception):
    pass


def run(args, *, env=None, stdin=None, stdout=None, timeout=1800, allow_failure=False):
    """Never include subprocess output/arguments in errors: they may contain secrets."""
    try:
        result = subprocess.run(args, env=env, stdin=stdin, stdout=stdout or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GuardError('Subprocess unavailable or timed out: ' + str(args[0])) from None
    if result.returncode and not allow_failure:
        raise GuardError(f'{args[0]} failed (exit {result.returncode}); output withheld')
    return result


def output(args, **kwargs):
    return run(args, **kwargs).stdout.decode('utf-8').strip()


def docker_json(*args):
    return json.loads(output(['docker', *args]))


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hash_stream(handle)


def hash_stream(handle):
    value = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()


def safe_path(value, base):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path == base:
        raise GuardError('An explicit child path is required')
    resolved = path.resolve()
    if base.resolve() not in resolved.parents or resolved != path:
        raise GuardError('Path escapes its permitted directory or uses a symlink')
    return path


def immutable_image(value):
    if not value or not re.fullmatch(r'[a-z0-9][a-z0-9./_-]*:[a-z0-9_-]*[0-9a-f]{12,40}', value):
        raise GuardError('Image must be a local immutable tag ending in a commit hash (12-40 hex)')
    return value


def containers():
    ids = output(['docker', 'ps', '-aq']).split()
    return {item['Name'].lstrip('/'): item for item in docker_json('inspect', *ids)}


def protected(items):
    return {name: item['Id'] for name, item in items.items()
            if name not in {'tdata-web', 'tdata-khl-worker'}}


def assert_protected(expected):
    actual = containers()
    if any(name not in actual or actual[name]['Id'] != cid for name, cid in expected.items()):
        raise GuardError('A protected container changed; manual investigation required')


def runtime(items):
    env = dict(os.environ)
    for name in ['tdata-postgres', 'tdata-telegram-consultant', 'tdata-tline-worker', 'tdata-web']:
        for pair in items[name]['Config']['Env']:
            key, value = pair.split('=', 1)
            if key not in BASE_ENV:
                env[key] = value
    return env


def chain(items):
    labels = items['tdata-web']['Config']['Labels']
    if labels.get('com.docker.compose.project') != 'tdata':
        raise GuardError('Unexpected Compose ownership')
    files = labels['com.docker.compose.project.config_files'].split(',')
    for file in files:
        safe_path(file, ROOT)
    return files


def compose(files, args, env):
    command = ['docker', 'compose', '--project-directory', str(ROOT), '-p', 'tdata']
    for file in files:
        command += ['-f', str(file)]
    return output(command + args, env=env)


def psql(sql, container='tdata-postgres'):
    command = ['docker', 'exec', '-i', container, 'sh', '-c',
               'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At']
    # SQL is fixed metadata only. The DB credentials remain inside the container.
    # subprocess stdin must be a real pipe; do not create a credential-bearing file.
    try:
        result = subprocess.run(command, input=sql.encode(), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        raise GuardError('PostgreSQL metadata inspection failed') from None
    if result.returncode:
        raise GuardError('PostgreSQL metadata inspection failed; output withheld')
    return result.stdout.decode().strip()


def schema_hash(container='tdata-postgres'):
    sql = """SELECT json_build_object(
      'columns',(SELECT json_agg(t ORDER BY t.table_name,t.ordinal_position) FROM
        (SELECT table_name,ordinal_position,column_name,udt_name,is_nullable,column_default,character_maximum_length
         FROM information_schema.columns WHERE table_schema='public') t),
      'constraints',(SELECT json_agg(t ORDER BY t.relname,t.conname) FROM
        (SELECT c.relname,x.conname,pg_get_constraintdef(x.oid) AS definition FROM pg_constraint x
         JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') t),
      'indexes',(SELECT json_agg(t ORDER BY t.tablename,t.indexname) FROM
        (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') t),
      'enums',(SELECT json_agg(t ORDER BY t.typname,t.enumsortorder) FROM
        (SELECT y.typname,e.enumsortorder,e.enumlabel FROM pg_enum e JOIN pg_type y ON y.oid=e.enumtypid
         JOIN pg_namespace n ON n.oid=y.typnamespace WHERE n.nspname='public') t));"""
    return hashlib.sha256(psql(sql, container).encode()).hexdigest()


def migration_rows(container='tdata-postgres'):
    return json.loads(psql('SELECT coalesce(json_object_agg(migration_name,checksum),\'{}\'::json) '
                           'FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;', container))


def timer_state():
    return {key: run(['systemctl', command, TIMER], allow_failure=True).returncode == 0
            for key, command in [('enabled', 'is-enabled'), ('active', 'is-active')]}


def private_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def checked_compose_bytes(data, checksum, env):
    if hashlib.sha256(data).hexdigest() != checksum:
        raise GuardError('Compose source differs from its reviewed checksum')
    text = data.decode('utf-8')
    for key, value in env.items():
        if SENSITIVE_KEY.search(key) and value and value.encode('utf-8') in data:
            raise GuardError('Runtime credential material detected in Compose source; nothing copied')
    for line in text.splitlines():
        match = re.match(r'\s*(?:-\s*)?([A-Z][A-Z0-9_]*)\s*[:=]\s*(.*?)\s*$', line)
        if not match or not SENSITIVE_KEY.search(match[1]):
            continue
        key, value = match[1], match[2].strip().strip('\"\'')
        if value in {'', 'null', '~'}:
            continue
        tokens = re.findall(r'\$\{[^}]+\}', value)
        masked = re.sub(r'\$\{[^}]+\}', '__ENV__', value)
        if not tokens or (masked != '__ENV__' and not (key == 'DATABASE_URL' and re.fullmatch(
                r'postgres(?:ql)?://__ENV__:__ENV__@[A-Za-z0-9_.:-]+/__ENV__(?:\?[A-Za-z0-9_=&.-]+)?', masked))):
            raise GuardError('Literal or unrecognized sensitive Compose field; nothing copied')
        for token in tokens:
            parsed = re.fullmatch(r'\$\{([A-Z][A-Z0-9_]*)(?:(:?[-?])(.*))?\}', token)
            if not parsed or (SENSITIVE_KEY.search(parsed[1]) and parsed[2] in {'-', ':-'} and parsed[3]):
                raise GuardError('Unsafe credential fallback in Compose source; nothing copied')
    return data


def copy_compose(directory, files, env):
    if list(files) != list(REVIEWED_COMPOSE):
        raise GuardError('Compose source chain differs from the reviewed ordered chain')
    # Validate every byte BEFORE creating any copy; reuse these bytes to avoid read/copy TOCTOU.
    sources = [(file, checked_compose_bytes(safe_path(file, ROOT).read_bytes(), REVIEWED_COMPOSE[file], env))
               for file in files]
    target = directory / 'compose'
    target.mkdir(mode=0o700, exist_ok=False)
    records = []
    for index, (original, data) in enumerate(sources):
        path = target / f'{index:02d}-{Path(original).name}'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        records.append({'original': original, 'file': path.relative_to(directory).as_posix(),
                        'sha256': REVIEWED_COMPOSE[original], 'bytes': len(data)})
    return records


def backed_up_chain(directory, manifest):
    records = manifest.get('composeBackup', [])
    if (manifest.get('composeFiles') != REVIEWED_COMPOSE
            or [record.get('original') for record in records] != list(REVIEWED_COMPOSE)):
        raise GuardError('Verified exact Compose copies are missing from backup')
    files = []
    for record in records:
        path = safe_path(str(directory / record['file']), directory)
        if os.name == 'posix' and (path.stat().st_mode & 0o077 or path.parent.stat().st_mode & 0o077):
            raise GuardError('Compose backup permissions must remain private')
        if record['sha256'] != REVIEWED_COMPOSE[record['original']] or path.stat().st_size != record['bytes']:
            raise GuardError('Compose backup manifest does not match reviewed source')
        checked_compose_bytes(path.read_bytes(), record['sha256'], {})
        files.append(str(path))
    return files


def wait_for(check, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if check():
            return
        time.sleep(2)
    raise GuardError('Health/readiness deadline exceeded')


def web_healthy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3010/api/health', timeout=5) as response:
            return response.status == 200 and json.load(response).get('ok') is True
    except Exception:
        return False


def restore_ready(container):
    # Official PostgreSQL starts a temporary Unix-socket server during initdb.
    # Wait for entrypoint exec -> PID 1 postgres AND the real DB over authenticated TCP.
    result = run(['docker', 'exec', container, 'sh', '-c',
                  'test "$(cat /proc/1/comm)" = postgres && '
                  'PGCONNECT_TIMEOUT=3 PGPASSWORD="$POSTGRES_PASSWORD" '
                  'psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 '
                  '-U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT 1"'],
                 allow_failure=True, timeout=15)
    return result.returncode == 0 and result.stdout.strip() == b'1'


def backup(directory, items, files):
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    previous = items['tdata-web']
    copied = copy_compose(directory, files, runtime(items))
    manifest = {'baselineImageId': previous['Image'], 'previousImage': previous['Config']['Image'],
                'composeFiles': {record['original']: record['sha256'] for record in copied}, 'composeBackup': copied,
                'protectedContainers': protected(items), 'timer': timer_state(),
                'schemaHash': schema_hash(), 'migrations': migration_rows(), 'restoreVerified': False}
    dump = directory / 'postgres.dump'
    with dump.open('xb') as handle:
        os.chmod(dump, 0o600)
        run(['docker', 'exec', 'tdata-postgres', 'sh', '-c',
             'exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], stdout=handle)
    image = directory / 'previous-image.tar'
    with image.open('xb') as handle:
        os.chmod(image, 0o600)
        run(['docker', 'image', 'save', previous['Image']], stdout=handle)
    token = uuid.uuid4().hex
    name = 'tdata-khl-restore-' + token
    network = name + '-net'
    own_network = own_container = False
    try:
        run(['docker', 'network', 'create', '--internal', '--label', 'tdata.khl.restore=' + token, network])
        own_network = True
        env = dict(os.environ, POSTGRES_PASSWORD=secrets.token_urlsafe(36))
        run(['docker', 'run', '-d', '--name', name, '--network', network, '--label', 'tdata.khl.restore=' + token,
             '--memory', '768m', '--cpus', '1', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=khl_restore',
             '-e', 'POSTGRES_DB=khl_restore', 'postgres:16'], env=env)
        own_container = True
        wait_for(lambda: restore_ready(name))
        with dump.open('rb') as handle:
            run(['docker', 'exec', '-i', name, 'pg_restore', '--list'], stdin=handle)
        with dump.open('rb') as handle:
            run(['docker', 'exec', '-i', name, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
                 '-U', 'khl_restore', '-d', 'khl_restore'], stdin=handle)
        if schema_hash(name) != manifest['schemaHash'] or migration_rows(name) != manifest['migrations']:
            raise GuardError('Restored schema or migration records differ')
        manifest['restoredCounts'] = json.loads(psql('SELECT json_build_object(\'matches\',(SELECT count(*) FROM "KhlMatch"),'
                                                    '\'snapshots\',(SELECT count(*) FROM "KhlRawSnapshot"),'
                                                    '\'revisions\',(SELECT count(*) FROM "KhlMatchRevision"));', name))
        manifest['restoreVerified'] = True
    finally:
        if own_container:
            owned = docker_json('inspect', name)[0]
            if owned['Config']['Labels'].get('tdata.khl.restore') == token:
                run(['docker', 'rm', '-fv', name])
        if own_network:
            run(['docker', 'network', 'rm', network])
    manifest['artifacts'] = {path.name: {'sha256': digest(path), 'bytes': path.stat().st_size} for path in [dump, image]}
    assert_protected(manifest['protectedContainers'])
    private_json(directory / 'manifest.json', manifest)
    return manifest


def verified_manifest(directory, require_originals=True):
    if directory.stat().st_mode & 0o077:
        raise GuardError('Backup directory must be private (0700)')
    manifest_path = safe_path(str(directory / 'manifest.json'), directory)
    manifest = json.loads(manifest_path.read_text())
    if not manifest.get('restoreVerified') or manifest.get('baselineImageId') != BASELINE:
        raise GuardError('A verified baseline backup is required')
    for name in ['postgres.dump', 'previous-image.tar']:
        path = safe_path(str(directory / name), directory)
        if path.stat().st_mode & 0o077 or digest(path) != manifest['artifacts'][name]['sha256']:
            raise GuardError('Backup artifact permissions/checksum verification failed')
    backed_up_chain(directory, manifest)
    if require_originals:
        for file, checksum in manifest['composeFiles'].items():
            if digest(safe_path(file, ROOT)) != checksum:
                raise GuardError('Original Compose configuration changed since backup')
    return manifest


def validate_release(image):
    script = "const fs=require('fs'),crypto=require('crypto');const p='backend/prisma/migrations';console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(p).filter(n=>fs.existsSync(p+'/'+n+'/migration.sql')).map(n=>{const sql=fs.readFileSync(p+'/'+n+'/migration.sql','utf8');return[n,{hash:crypto.createHash('sha256').update(sql).digest('hex'),sql}]}))))"
    files = json.loads(output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', script]))
    current = migration_rows()
    if set(current) - set(files) - {EXTRA_MIGRATION}:
        raise GuardError('Unknown applied migration missing from release')
    for name in set(current) & set(files):
        if current[name] != files[name]['hash']:
            raise GuardError('Release changed an applied migration')
    pending = set(files) - set(current)
    if pending != set(MIGRATIONS):
        raise GuardError('Pending migrations differ from the reviewed two KHL migrations')
    for name in pending:
        actual_hash = hashlib.sha256(files[name]['sql'].encode('utf-8')).hexdigest()
        if files[name]['hash'] != MIGRATIONS[name] or actual_hash != MIGRATIONS[name]:
            raise GuardError('Migration differs from its reviewed checksum')
        sql = re.sub(r'--[^\n]*', '', files[name]['sql'])
        allowed = r'^(CREATE (TYPE|TABLE) "KhlSync\w+"|CREATE (UNIQUE )?INDEX "KhlSync\w+" ON "KhlSync\w+"|ALTER TABLE "KhlSync\w+" ADD (COLUMN|CONSTRAINT))(\s|\()'
        if any(not re.match(allowed, statement.strip(), re.I)
               for statement in sql.split(';') if statement.strip()):
            raise GuardError('Unexpected migration statement outside additive KHL-sync DDL')
        if re.search(r'\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|RENAME)\b', sql, re.I):
            # The reviewed FK contains ON UPDATE CASCADE, not a data UPDATE.
            if re.search(r'\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|RENAME)\b',
                         re.sub(r'ON (DELETE RESTRICT|UPDATE CASCADE)', '', sql, flags=re.I), re.I):
                raise GuardError('Unexpected non-additive migration statement')
        if re.search(r'(?:ALTER|CREATE) TABLE\s+"(?!KhlSync)', sql, re.I):
            raise GuardError('Migration touches non-KHL-sync table')


def overlay(directory, image, worker):
    path = directory / ('khl-release.override.json' if worker else 'khl-rollback.override.json')
    service = {'image': image}
    services = {'web': service}
    if worker:
        service['environment'] = {'KHL_RESULTS_AUTO_SYNC_ENABLED': '1', 'KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES': '10'}
        services['khl-worker'] = {'image': image, 'container_name': 'tdata-khl-worker', 'restart': 'unless-stopped',
                                 'command': ['npm', 'run', 'worker:khl-results'], 'networks': ['default'],
                                 'environment': dict(service['environment'], DATABASE_URL='${DATABASE_URL:?Existing runtime DATABASE_URL required}')}
    private_json(path, {'services': services})
    return str(path)


def restore_timer(state):
    run(['systemctl', 'enable' if state['enabled'] else 'disable', TIMER])
    run(['systemctl', 'start' if state['active'] else 'stop', TIMER])


def rollback(directory, manifest, env):
    current = containers()
    if 'tdata-khl-worker' in current:
        item = current['tdata-khl-worker']
        labels = item['Config'].get('Labels', {})
        if labels.get('com.docker.compose.project') != 'tdata' or labels.get('com.docker.compose.service') != 'khl-worker':
            raise GuardError('Unexpected KHL worker ownership')
        run(['docker', 'stop', 'tdata-khl-worker'])
    image = manifest['baselineImageId']
    if docker_json('image', 'inspect', image)[0]['Id'] != manifest['baselineImageId']:
        raise GuardError('Previous image ID is unavailable; restore its archived image explicitly')
    files = backed_up_chain(directory, manifest) + [overlay(directory, image, False)]
    compose(files, ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'], env)
    wait_for(web_healthy)
    if containers()['tdata-web']['Image'] != manifest['baselineImageId']:
        raise GuardError('Rollback image identity mismatch')
    restore_timer(manifest['timer'])
    assert_protected(manifest['protectedContainers'])


def deploy(directory, manifest, image, items, env):
    # Resolve the user-facing tag once. No subsequent runtime command may use it.
    release_id = docker_json('image', 'inspect', image)[0]['Id']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', release_id):
        raise GuardError('Docker did not resolve a full immutable image ID')
    if schema_hash() != manifest['schemaHash']:
        raise GuardError('Production schema changed after verified backup')
    validate_release(release_id)
    files = list(manifest['composeFiles'])
    before = json.loads(compose(files, ['config', '--format', 'json'], env))
    files.append(overlay(directory, release_id, True))
    after = json.loads(compose(files, ['config', '--format', 'json'], env))
    for name, config in before['services'].items():
        if name != 'web' and after['services'].get(name) != config:
            raise GuardError('Overlay changes an unrelated service')
    before_env = before['services']['web'].get('environment', {})
    after_env = after['services']['web'].get('environment', {})
    actual_env = dict(pair.split('=', 1) for pair in items['tdata-web']['Config']['Env'])
    base_image_env = BASE_ENV | {'NODE_ENV', 'NEXT_TELEMETRY_DISABLED', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'}
    if any(str(before_env.get(key)) != actual_env.get(key)
           for key in set(before_env) | set(actual_env) if key not in base_image_env):
        raise GuardError('Original Compose does not reproduce the running web environment')
    if any(before_env.get(key) != after_env.get(key) for key in set(before_env) | set(after_env) if key not in KHL_ENV):
        raise GuardError('Overlay changes an unrelated web environment key')
    assert_protected(manifest['protectedContainers'])
    manifest['releaseImage'] = image
    manifest['releaseImageId'] = release_id
    # Persist only non-secret rollback identity before any deployment side effect.
    private_json(directory / 'manifest.json', manifest)
    try:
        run(['systemctl', 'disable', '--now', TIMER])
        wait_for(lambda: run(['systemctl', 'is-active', 'tdata-khl-results-sync.service'], allow_failure=True).returncode != 0, 60)
        run(['docker', 'run', '--rm', '--network', 'tdata_default', '-e', 'DATABASE_URL',
             '--entrypoint', 'npm', release_id, 'run', 'db:migrate:deploy'], env=env)
        compose(files, ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'], env)
        wait_for(web_healthy)
        if containers()['tdata-web']['Image'] != release_id:
            raise GuardError('Release image identity mismatch')
        compose(files, ['up', '-d', '--no-deps', '--no-build', 'khl-worker'], env)
        wait_for(lambda: psql('SELECT count(*) FROM "KhlSyncControl" WHERE "workerHeartbeatAt" > now() - interval \'30 seconds\';') == '1', 90)
        assert_protected(manifest['protectedContainers'])
    except Exception:
        try:
            rollback(directory, manifest, env)
        except Exception:
            raise GuardError('Deployment failed AND automatic rollback failed; manual recovery required') from None
        raise GuardError('Deployment failed; previous web/timer restored; additive schema retained') from None
    manifest['deploymentHealthy'] = True
    private_json(directory / 'manifest.json', manifest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['inspect', 'backup', 'deploy', 'rollback'], nargs='?', default='inspect')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--image')
    parser.add_argument('--backup-dir')
    args = parser.parse_args(argv)
    if args.mode != 'inspect' and not args.apply:
        raise GuardError('Mutating modes require --apply')
    if not ROOT.is_dir():
        raise GuardError('Run on the verified TData server')
    items = containers()
    if 'tdata-web' not in items or 'tdata-postgres' not in items:
        raise GuardError('Canonical containers are missing')
    files, env = chain(items), runtime(items)
    # Read-only inventory is always performed before any mutation.
    inventory = {'containers': {name: {'id': item['Id'], 'image': item['Image']} for name, item in items.items()},
                 'composeFiles': files, 'timer': timer_state(), 'webHealthy': web_healthy(),
                 'disk': output(['df', '-h', str(ROOT)]), 'memory': output(['free', '-m']),
                 'listeningPorts': output(['ss', '-ltn']), 'composeProjects': json.loads(output(['docker', 'compose', 'ls', '--format', 'json']))}
    print(json.dumps(inventory, indent=2), flush=True)
    if args.mode == 'inspect':
        return
    if args.mode in {'backup', 'deploy'} and items['tdata-web']['Image'] != BASELINE:
        raise GuardError('Running web differs from the verified baseline')
    if not args.backup_dir:
        raise GuardError('An explicit unique --backup-dir is required')
    directory = safe_path(args.backup_dir, BACKUPS)
    if args.mode == 'backup':
        BACKUPS.mkdir(mode=0o700, exist_ok=True)
        backup(directory, items, files)
    else:
        manifest = verified_manifest(directory, require_originals=args.mode == 'deploy')
        if args.mode == 'deploy':
            deploy(directory, manifest, immutable_image(args.image), items, env)
        else:
            if items['tdata-web']['Image'] not in {BASELINE, manifest.get('releaseImageId')}:
                raise GuardError('Rollback would overwrite a different subsequent release')
            rollback(directory, manifest, env)
    print(json.dumps({'mode': args.mode, 'ok': True, 'backupDirectory': str(directory)}))


if __name__ == '__main__':
    try:
        main()
    except GuardError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Unexpected deployment error; details withheld to protect runtime secrets', file=sys.stderr)
        sys.exit(1)
