"""Offline safety checks; never connect to Docker, SSH, or production."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('khl_deploy', Path(__file__).parents[1] / 'scripts' / 'deploy-khl-release.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class DeploymentSafetyTests(unittest.TestCase):
    def test_mutations_require_apply_before_inspection(self):
        for mode in ['backup', 'deploy', 'rollback']:
            with self.subTest(mode=mode), patch.object(deploy, 'containers') as inspect:
                with self.assertRaisesRegex(deploy.GuardError, '--apply'):
                    deploy.main([mode])
                inspect.assert_not_called()

    def test_paths_reject_parent_and_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp).resolve()
            for value in [str(base), str(base / '..' / 'outside'), 'relative/path']:
                with self.subTest(value=value), self.assertRaises(deploy.GuardError):
                    deploy.safe_path(value, base)
            self.assertEqual(deploy.safe_path(str(base / 'unique'), base), base / 'unique')

    def test_mutable_or_argument_images_are_rejected(self):
        for value in [None, 'tdata:latest', 'tdata:main', 'tdata:test;evil', '--help', 'tdata@sha256:abc']:
            with self.subTest(value=value), self.assertRaises(deploy.GuardError):
                deploy.immutable_image(value)
        self.assertEqual(deploy.immutable_image('tdata-khl:abcdef012345'), 'tdata-khl:abcdef012345')

    def test_runtime_environment_stays_in_memory_and_preserves_password(self):
        names = ['tdata-postgres', 'tdata-telegram-consultant', 'tdata-tline-worker', 'tdata-web']
        items = {name: {'Config': {'Env': ['PATH=container-path', 'DATABASE_URL=not-a-real-secret; $x']}} for name in names}
        with patch.dict(deploy.os.environ, {'PATH': 'host-path'}, clear=True):
            env = deploy.runtime(items)
        self.assertEqual(env['PATH'], 'host-path')
        self.assertEqual(env['DATABASE_URL'], 'not-a-real-secret; $x')

    def test_subprocess_error_does_not_print_stderr_or_arguments(self):
        result = subprocess.CompletedProcess([], 1, b'secret-out', b'secret-error')
        with patch.object(deploy.subprocess, 'run', return_value=result):
            with self.assertRaises(deploy.GuardError) as raised:
                deploy.run(['docker', 'not-real-secret-argument'])
        message = str(raised.exception)
        self.assertNotIn('secret', message)
        self.assertIn('exit 1', message)

    def test_overlay_contains_references_not_runtime_secrets(self):
        captured = {}
        with tempfile.TemporaryDirectory() as temp, patch.object(deploy, 'private_json', side_effect=lambda p, v: captured.update(v)):
            deploy.overlay(Path(temp), 'tdata-khl:abcdef012345', True)
        self.assertEqual(set(captured['services']), {'web', 'khl-worker'})
        worker = captured['services']['khl-worker']
        self.assertNotIn('ports', worker)
        self.assertNotIn('volumes', worker)
        self.assertEqual(worker['environment']['DATABASE_URL'], '${DATABASE_URL:?Existing runtime DATABASE_URL required}')
        self.assertEqual(worker['command'], ['npm', 'run', 'worker:khl-results'])

    def test_protected_containers_exclude_only_authorized_services(self):
        items = {name: {'Id': name + '-id'} for name in ['tdata-web', 'tdata-khl-worker', 'tdata-postgres', 'tdata-tline-worker', 'unrelated']}
        self.assertEqual(set(deploy.protected(items)), {'tdata-postgres', 'tdata-tline-worker', 'unrelated'})
        with patch.object(deploy, 'containers', return_value={}):
            with self.assertRaises(deploy.GuardError):
                deploy.assert_protected({'unrelated': 'unchanged-id'})

    def test_unknown_pending_migration_is_rejected(self):
        files = {'unexpected_migration': {'hash': 'hash', 'sql': 'CREATE TABLE "Other" ();'}}
        with patch.object(deploy, 'output', return_value=json.dumps(files)), patch.object(deploy, 'migration_rows', return_value={}):
            with self.assertRaisesRegex(deploy.GuardError, 'Pending migrations'):
                deploy.validate_release('tdata-khl:abcdef012345')

    def test_allowed_migrations_cannot_delete_existing_tables(self):
        files = {name: {'hash': 'hash', 'sql': 'DROP TABLE "KhlMatch";'} for name in deploy.MIGRATIONS}
        with patch.object(deploy, 'output', return_value=json.dumps(files)), patch.object(deploy, 'migration_rows', return_value={}):
            with self.assertRaisesRegex(deploy.GuardError, 'reviewed checksum'):
                deploy.validate_release('tdata-khl:abcdef012345')

    def test_actual_reviewed_migrations_are_accepted(self):
        base = Path(__file__).parents[1] / 'backend' / 'prisma' / 'migrations'
        files = {name: {'hash': hashlib.sha256((base / name / 'migration.sql').read_bytes()).hexdigest(),
                        'sql': (base / name / 'migration.sql').read_bytes().decode('utf-8')} for name in deploy.MIGRATIONS}
        with patch.object(deploy, 'output', return_value=json.dumps(files)), patch.object(deploy, 'migration_rows', return_value={}):
            deploy.validate_release('tdata-khl:abcdef012345')

    def test_reported_hash_cannot_hide_modified_sql(self):
        files = {name: {'hash': checksum, 'sql': 'CREATE TABLE "KhlSyncUnexpected" ();'}
                 for name, checksum in deploy.MIGRATIONS.items()}
        with patch.object(deploy, 'output', return_value=json.dumps(files)), patch.object(deploy, 'migration_rows', return_value={}):
            with self.assertRaisesRegex(deploy.GuardError, 'reviewed checksum'):
                deploy.validate_release('sha256:' + 'a' * 64)

    def test_deploy_pins_once_even_if_tag_is_retargeted(self):
        pinned = 'sha256:' + 'a' * 64
        changed = 'sha256:' + 'b' * 64
        tag = 'tdata-khl:abcdef012345'
        manifest = {'schemaHash': 'schema', 'composeFiles': {'original.yml': 'checksum'}, 'protectedContainers': {}}
        items = {'tdata-web': {'Config': {'Env': []}}}
        config = {'services': {'web': {'environment': {}}}}
        written = {}

        def record_json(path, value):
            written[path.name] = json.loads(json.dumps(value))

        with tempfile.TemporaryDirectory() as temp, \
                patch.object(deploy, 'docker_json', side_effect=[[{'Id': pinned}], [{'Id': changed}]]) as inspect, \
                patch.object(deploy, 'schema_hash', return_value='schema'), \
                patch.object(deploy, 'validate_release') as validate, \
                patch.object(deploy, 'compose', return_value=json.dumps(config)), \
                patch.object(deploy, 'private_json', side_effect=record_json), \
                patch.object(deploy, 'assert_protected'), \
                patch.object(deploy, 'wait_for'), \
                patch.object(deploy, 'containers', return_value={'tdata-web': {'Image': pinned}}), \
                patch.object(deploy, 'run') as execute:
            deploy.deploy(Path(temp), manifest, tag, items, {})

        inspect.assert_called_once_with('image', 'inspect', tag)
        validate.assert_called_once_with(pinned)
        services = written['khl-release.override.json']['services']
        self.assertEqual(services['web']['image'], pinned)
        self.assertEqual(services['khl-worker']['image'], pinned)
        commands = [call.args[0] for call in execute.call_args_list]
        migration = next(command for command in commands if 'db:migrate:deploy' in command)
        self.assertIn(pinned, migration)
        self.assertNotIn(tag, migration)
        self.assertEqual(written['manifest.json']['releaseImage'], tag)
        self.assertEqual(written['manifest.json']['releaseImageId'], pinned)

    def test_compose_backup_is_exact_and_rollback_does_not_need_originals(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source = root / 'docker-compose.yml'
            source.write_bytes(b'services:\n  web:\n    environment:\n      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?required}\n')
            checksum = hashlib.sha256(source.read_bytes()).hexdigest()
            directory = root / 'backup'
            directory.mkdir()
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'REVIEWED_COMPOSE', {str(source): checksum}, create=True):
                records = deploy.copy_compose(directory, [str(source)], {'ADMIN_PASSWORD': 'fake-private-value'})
                copied = directory / records[0]['file']
                self.assertEqual(copied.read_bytes(), source.read_bytes())
                self.assertEqual(records[0]['sha256'], checksum)
                source.unlink()
                manifest = {'composeFiles': {str(source): checksum}, 'composeBackup': records}
                self.assertEqual(deploy.backed_up_chain(directory, manifest), [str(copied)])
                if os.name != 'nt':
                    self.assertEqual(copied.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(copied.parent.stat().st_mode & 0o777, 0o700)

    def test_compose_secret_or_source_drift_is_rejected_before_copy(self):
        for body in [b'ADMIN_PASSWORD: literal-private-value\n',
                     b'ADMIN_PASSWORD: ${ADMIN_PASSWORD:-literal-private-value}\n',
                     b'OTHER_SETTING: literal-private-value\n']:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                source = root / 'docker-compose.yml'
                source.write_bytes(body)
                checksum = hashlib.sha256(body).hexdigest()
                directory = root / 'backup'
                directory.mkdir()
                with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'REVIEWED_COMPOSE', {str(source): checksum}, create=True):
                    with self.assertRaises(deploy.GuardError):
                        deploy.copy_compose(directory, [str(source)], {'ADMIN_PASSWORD': 'literal-private-value'})
                self.assertFalse((directory / 'compose').exists())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source = root / 'docker-compose.yml'
            source.write_bytes(b'services: {}\n')
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'REVIEWED_COMPOSE', {str(source): '0' * 64}, create=True):
                with self.assertRaisesRegex(deploy.GuardError, 'reviewed'):
                    deploy.copy_compose(root, [str(source)], {})

    def test_compose_backup_rejects_changed_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp).resolve()
            original = str(directory / 'original.yml')
            copied = directory / 'compose' / '00-original.yml'
            copied.parent.mkdir()
            copied.write_bytes(b'changed')
            manifest = {'composeFiles': {original: '0' * 64}, 'composeBackup': [
                {'original': original, 'file': 'compose/00-original.yml', 'sha256': '0' * 64, 'bytes': 7}]}
            with patch.object(deploy, 'REVIEWED_COMPOSE', {original: '0' * 64}, create=True):
                with self.assertRaises(deploy.GuardError):
                    deploy.backed_up_chain(directory, manifest)


if __name__ == '__main__':
    unittest.main()
