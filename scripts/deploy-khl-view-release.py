#!/usr/bin/env python3
"""TData web-only KHL view release. Run on server; inspect is the read-only default."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

_spec = importlib.util.spec_from_file_location('khl_view_shared_primitives', Path(__file__).with_name('deploy-khl-release.py'))
shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared)
GuardError = shared.GuardError
BASELINE = 'sha256:15d2e8b81348209fe6d7c8f98a3dac17173b1f509f87284ff280397126aa46be'
OVERLAY = '/root/tdata/backups/khl-20260905-verified-1930/khl-release.override.json'
VIEW_OVERLAY = '/root/tdata/backups/khl-view-20260905-2058/khl-view-release.override.json'
REVIEWED_COMPOSE = {**shared.REVIEWED_COMPOSE,
                    OVERLAY: 'a80d5e7e98fd51296af15a8778dce63eb0fc1be8ca57baa1d8e2b8827bcdf2d3',
                    VIEW_OVERLAY: '6544e7d1b71d1b6449bc0cf1c9512682a1fbdd16eb6cdc5180eef00a7e315411'}
WEB_PORTS = {'3010/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3010'}]}
REVIEWED_DIAGNOSTIC_SCRIPTS = {
    'scripts/verify-khl-identity-browser.ts': '7f41bd70328c87371de3e14b6cbb115e0bc2b1e2ad8070401f1b77f95ca3ad45',
    'scripts/verify-khl-midnight-browser.ts': 'aa36932b928ee81787251f2fd12086da80ade8a85cd7c7c534c3dce7dfd62e0f',
}


def protected_snapshot(items):
    return {name: {'id': item['Id'], 'image': item['Image'], 'startedAt': item['State']['StartedAt']}
            for name, item in items.items() if name != 'tdata-web'}


def assert_protected(expected):
    actual = protected_snapshot(shared.containers())
    if any(actual.get(name) != snapshot for name, snapshot in expected.items()):
        raise GuardError('A protected non-web container changed identity/image/start time')


def configure_shared():
    """Configure a private module instance; never modify the earlier helper file."""
    shared.BASELINE = BASELINE
    shared.REVIEWED_COMPOSE = dict(REVIEWED_COMPOSE)
    shared.protected = protected_snapshot
    shared.assert_protected = assert_protected


def runtime_manifest(image):
    # The view release must not change any backend, worker/runtime script, dependency,
    # or existing static asset. The new deployment helper itself is the sole exclusion.
    script = r"""const fs=require('fs'),path=require('path'),crypto=require('crypto'),out={};
function walk(p){for(const x of fs.readdirSync(p,{withFileTypes:true})){const n=path.posix.join(p,x.name);
if(x.isDirectory())walk(n);else if(x.isFile()&&n!=='scripts/deploy-khl-view-release.py')
out[n]=crypto.createHash('sha256').update(fs.readFileSync(n)).digest('hex');}}
for(const p of ['backend','scripts','frontend/public','data/tessdata','deploy/systemd'])walk(p);
for(const p of ['package.json','package-lock.json','tsconfig.json','frontend/next.config.mjs'])out[p]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
console.log(JSON.stringify(out));"""
    return json.loads(shared.output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', script]))


def validate_runtime(release_id):
    before, after = runtime_manifest(BASELINE), runtime_manifest(release_id)
    for path, checksum in REVIEWED_DIAGNOSTIC_SCRIPTS.items():
        if path in after and after[path] != checksum:
            raise GuardError('Diagnostic-only script differs from its reviewed exact hash')
    comparable = {path: checksum for path, checksum in after.items()
                  if path in before or path not in REVIEWED_DIAGNOSTIC_SCRIPTS}
    if before != comparable:
        raise GuardError('View release changes protected runtime/backend/parser/schema/dependencies/assets')


def validate_image_config(release_id):
    keys = {'Entrypoint', 'Env', 'WorkingDir', 'User', 'Cmd', 'Healthcheck', 'ExposedPorts', 'Volumes'}
    before = shared.docker_json('image', 'inspect', BASELINE)[0]['Config']
    after = shared.docker_json('image', 'inspect', release_id)[0]['Config']
    if {key: before.get(key) for key in keys} != {key: after.get(key) for key in keys}:
        raise GuardError('Protected image configuration changed')


def web_overlay(directory, image, rollback=False):
    path = directory / ('khl-view-rollback.override.json' if rollback else 'khl-view-release.override.json')
    # Override the image's migration-bearing CMD on BOTH deploy and rollback.
    shared.private_json(path, {'services': {'web': {'image': image, 'command': ['npm', 'run', 'start']}}})
    return str(path)


def validate_compose(before, after):
    if set(before['services']) != set(after['services']):
        raise GuardError('Web-only overlay adds/removes services')
    for name, value in before['services'].items():
        if name != 'web' and after['services'][name] != value:
            raise GuardError('Web-only overlay changes a protected service')
    omit = {'image', 'command'}
    if ({k: v for k, v in before['services']['web'].items() if k not in omit}
            != {k: v for k, v in after['services']['web'].items() if k not in omit}):
        raise GuardError('Web-only overlay changes environment/ports/volumes or another setting')
    if after['services']['web'].get('command') != ['npm', 'run', 'start']:
        raise GuardError('Web-only release must start without migrations')


def assert_runtime_env(config, item):
    actual = dict(pair.split('=', 1) for pair in item['Config']['Env'])
    configured = config['services']['web'].get('environment', {})
    image_keys = shared.BASE_ENV | {'NODE_ENV', 'NEXT_TELEMETRY_DISABLED', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'}
    if any(str(configured.get(key)) != actual.get(key) for key in set(configured) | set(actual) if key not in image_keys):
        raise GuardError('Compose does not reproduce the running web environment')


def assert_web(image, env, ports):
    item = shared.containers()['tdata-web']
    if item['Image'] != image or item['HostConfig'].get('PortBindings') != ports:
        raise GuardError('Web image/loopback ports changed unexpectedly')
    if dict(pair.split('=', 1) for pair in item['Config']['Env']) != env:
        raise GuardError('Web runtime environment changed unexpectedly')


def assert_control_unchanged(manifest):
    assert_protected(manifest['protectedContainers'])
    if shared.timer_state() != manifest['timer']:
        raise GuardError('Legacy KHL timer state changed unexpectedly')
    if shared.schema_hash() != manifest['schemaHash'] or shared.migration_rows() != manifest['migrations']:
        raise GuardError('Database schema/migrations changed during web-only release')


def rollback(directory, manifest, env, actual_env):
    if shared.docker_json('image', 'inspect', BASELINE)[0]['Id'] != BASELINE:
        raise GuardError('Previous web image is unavailable; restore its private archive explicitly')
    files = shared.backed_up_chain(directory, manifest) + [web_overlay(directory, BASELINE, True)]
    shared.compose(files, ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'], env)
    shared.wait_for(shared.web_healthy)
    assert_web(BASELINE, actual_env, WEB_PORTS)
    assert_control_unchanged(manifest)


def deploy(directory, manifest, tag, items, env):
    release_id = shared.docker_json('image', 'inspect', tag)[0]['Id']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', release_id):
        raise GuardError('Release image did not resolve to a full immutable ID')
    validate_image_config(release_id)
    validate_runtime(release_id)
    assert_control_unchanged(manifest)
    files = list(manifest['composeFiles'])
    before = json.loads(shared.compose(files, ['config', '--format', 'json'], env))
    assert_runtime_env(before, items['tdata-web'])
    files.append(web_overlay(directory, release_id))
    after = json.loads(shared.compose(files, ['config', '--format', 'json'], env))
    validate_compose(before, after)
    actual_env = dict(pair.split('=', 1) for pair in items['tdata-web']['Config']['Env'])
    manifest.update(releaseImage=tag, releaseImageId=release_id)
    shared.private_json(directory / 'manifest.json', manifest)
    try:
        # No SQL execution, timer operation, worker recreate, compose down, or dependency startup.
        shared.compose(files, ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'], env)
        shared.wait_for(shared.web_healthy)
        assert_web(release_id, actual_env, WEB_PORTS)
        assert_control_unchanged(manifest)
    except Exception:
        try:
            rollback(directory, manifest, env, actual_env)
        except Exception:
            raise GuardError('Web-only deployment failed and rollback needs manual attention') from None
        raise GuardError('Web-only deployment failed; previous web restored without migrations') from None
    manifest['deploymentHealthy'] = True
    shared.private_json(directory / 'manifest.json', manifest)


def inventory(items, files):
    return {'containers': {name: {'id': item['Id'], 'image': item['Image'], 'startedAt': item['State']['StartedAt']}
                           for name, item in items.items()}, 'composeFiles': files,
            'listeningPorts': shared.output(['ss', '-ltn']), 'disk': shared.output(['df', '-h', str(shared.ROOT)]),
            'memory': shared.output(['free', '-m']), 'composeProjects': json.loads(shared.output(['docker', 'compose', 'ls', '--format', 'json'])),
            'webHealthy': shared.web_healthy(), 'legacyTimer': shared.timer_state(),
            'nginx': shared.output(['systemctl', 'is-active', 'nginx'])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['inspect', 'backup', 'deploy', 'rollback'], default='inspect', nargs='?')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--image')
    parser.add_argument('--backup-dir')
    args = parser.parse_args(argv)
    if args.mode != 'inspect' and not args.apply:
        raise GuardError('Mutating modes require --apply')
    configure_shared()
    if not shared.ROOT.is_dir():
        raise GuardError('Run on the canonical TData server')
    items = shared.containers()
    if not {'tdata-web', 'tdata-khl-worker', 'tdata-postgres'} <= set(items):
        raise GuardError('Canonical containers are missing')
    files, env = shared.chain(items), shared.runtime(items)
    print(json.dumps(inventory(items, files), indent=2), flush=True)
    if args.mode == 'inspect':
        return
    if items['tdata-web']['HostConfig'].get('PortBindings') != WEB_PORTS:
        raise GuardError('Unexpected web port ownership')
    if args.mode in {'backup', 'deploy'} and items['tdata-web']['Image'] != BASELINE:
        raise GuardError('Running web differs from this scoped view-release baseline')
    if not args.backup_dir:
        raise GuardError('Explicit unique --backup-dir is required')
    directory = shared.safe_path(args.backup_dir, shared.BACKUPS)
    if args.mode == 'backup':
        shared.BACKUPS.mkdir(mode=0o700, exist_ok=True)
        manifest = shared.backup(directory, items, files)
        manifest['purpose'] = 'khl-web-view-only'
        shared.private_json(directory / 'manifest.json', manifest)
    else:
        manifest = shared.verified_manifest(directory, require_originals=args.mode == 'deploy')
        if manifest.get('purpose') != 'khl-web-view-only':
            raise GuardError('A verified web-only backup is required')
        if args.mode == 'deploy':
            deploy(directory, manifest, shared.immutable_image(args.image), items, env)
        else:
            if items['tdata-web']['Image'] not in {BASELINE, manifest.get('releaseImageId')}:
                raise GuardError('Rollback would overwrite another release')
            actual_env = dict(pair.split('=', 1) for pair in items['tdata-web']['Config']['Env'])
            rollback(directory, manifest, env, actual_env)
    print(json.dumps({'mode': args.mode, 'ok': True, 'backupDirectory': str(directory), 'webOnly': True}))


if __name__ == '__main__':
    try:
        main()
    except GuardError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Web-only deployment error; sensitive details withheld', file=sys.stderr)
        sys.exit(1)
