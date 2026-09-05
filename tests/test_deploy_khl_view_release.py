"""Offline safety tests for the web-only KHL view deployment helper."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('khl_view_deploy', Path(__file__).parents[1] / 'scripts' / 'deploy-khl-view-release.py')
view = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(view)


class ViewDeploymentTests(unittest.TestCase):
    def test_mutation_requires_apply_before_any_inspection(self):
        for mode in ['backup', 'deploy', 'rollback']:
            with patch.object(view.shared, 'containers') as inspect:
                with self.assertRaisesRegex(view.GuardError, '--apply'):
                    view.main([mode])
                inspect.assert_not_called()

    def test_worker_is_protected_by_id_image_and_start_time(self):
        items = {name: {'Id': name, 'Image': 'image', 'State': {'StartedAt': 'before'}}
                 for name in ['tdata-web', 'tdata-khl-worker', 'other']}
        expected = view.protected_snapshot(items)
        self.assertEqual(set(expected), {'tdata-khl-worker', 'other'})
        items['tdata-khl-worker']['State']['StartedAt'] = 'after'
        with patch.object(view.shared, 'containers', return_value=items):
            with self.assertRaisesRegex(view.GuardError, 'protected'):
                view.assert_protected(expected)

    def test_overlay_changes_only_web_and_never_runs_migrations(self):
        written = {}
        with tempfile.TemporaryDirectory() as temp, patch.object(view.shared, 'private_json', side_effect=lambda p, v: written.update(v)):
            view.web_overlay(Path(temp), 'sha256:' + 'a' * 64)
        self.assertEqual(set(written['services']), {'web'})
        self.assertEqual(written['services']['web'], {'image': 'sha256:' + 'a' * 64, 'command': ['npm', 'run', 'start']})

    def test_backend_or_worker_or_schema_change_is_rejected(self):
        for path in ['backend/src/sources/results/khl/normalize.ts', 'scripts/khl-results-worker.ts',
                     'backend/prisma/schema.prisma', 'frontend/public/example.png']:
            with patch.object(view, 'runtime_manifest', side_effect=[{path: 'old'}, {path: 'new'}]):
                with self.assertRaisesRegex(view.GuardError, 'runtime'):
                    view.validate_runtime('sha256:' + 'a' * 64)

    def test_missing_runtime_file_is_rejected(self):
        with patch.object(view, 'runtime_manifest', side_effect=[{'backend/important.ts': 'old'}, {}]):
            with self.assertRaises(view.GuardError):
                view.validate_runtime('sha256:' + 'a' * 64)

    def test_matching_runtime_is_accepted(self):
        with patch.object(view, 'runtime_manifest', return_value={'backend/important.ts': 'same'}):
            view.validate_runtime('sha256:' + 'a' * 64)

    def test_only_exact_reviewed_diagnostic_script_is_allowed(self):
        path = 'scripts/verify-khl-identity-browser.ts'
        checksum = view.REVIEWED_DIAGNOSTIC_SCRIPTS[path]
        before = {'backend/important.ts': 'same'}
        with patch.object(view, 'runtime_manifest', side_effect=[before, {**before, path: checksum}]):
            view.validate_runtime('sha256:' + 'a' * 64)
        for extra in [{path: 'modified'}, {'scripts/verify-other-browser.ts': checksum}]:
            with patch.object(view, 'runtime_manifest', side_effect=[before, {**before, **extra}]):
                with self.assertRaises(view.GuardError):
                    view.validate_runtime('sha256:' + 'a' * 64)

    def test_compose_web_environment_or_ports_cannot_change(self):
        original = {'services': {'web': {'image': 'old', 'environment': {'PORT': '3010'}, 'ports': ['127.0.0.1:3010:3010']},
                                 'khl-worker': {'image': 'old-worker'}}}
        changed = json.loads(json.dumps(original))
        changed['services']['web'].update(image='new', command=['npm', 'run', 'start'])
        view.validate_compose(original, changed)
        changed['services']['web']['environment']['PORT'] = '3011'
        with self.assertRaises(view.GuardError):
            view.validate_compose(original, changed)
        changed = json.loads(json.dumps(original))
        changed['services']['khl-worker']['image'] = 'new-worker'
        with self.assertRaises(view.GuardError):
            view.validate_compose(original, changed)

    def test_shared_backup_primitives_use_new_baseline_and_seven_file_chain(self):
        view.configure_shared()
        self.assertEqual(view.shared.BASELINE, view.BASELINE)
        self.assertEqual(len(view.shared.REVIEWED_COMPOSE), 7)
        self.assertIs(view.shared.protected, view.protected_snapshot)
        self.assertIs(view.shared.assert_protected, view.assert_protected)

    def test_image_entrypoint_or_environment_changes_are_rejected(self):
        for key in ['Entrypoint', 'Env', 'WorkingDir', 'User', 'Cmd']:
            with patch.object(view.shared, 'docker_json', side_effect=[
                    [{'Config': {key: 'before'}}], [{'Config': {key: 'after'}}]]):
                with self.assertRaisesRegex(view.GuardError, 'image configuration'):
                    view.validate_image_config('sha256:' + 'a' * 64)

    def test_cutover_resolves_tag_once_and_never_mutates_worker_database_or_timer(self):
        pinned = 'sha256:' + 'a' * 64
        tag = 'tdata-khl:' + 'b' * 40
        config = {'services': {'web': {'image': view.BASELINE, 'environment': {'PORT': '3010'}},
                               'khl-worker': {'image': view.BASELINE}}}
        after = json.loads(json.dumps(config))
        after['services']['web'].update(image=pinned, command=['npm', 'run', 'start'])
        items = {'tdata-web': {'Config': {'Env': ['PORT=3010']}}}
        manifest = {'composeFiles': {file: checksum for file, checksum in view.REVIEWED_COMPOSE.items()}}
        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            inspect = stack.enter_context(patch.object(view.shared, 'docker_json', return_value=[{'Id': pinned}]))
            validate = stack.enter_context(patch.object(view, 'validate_runtime'))
            stack.enter_context(patch.object(view, 'validate_image_config'))
            stack.enter_context(patch.object(view, 'assert_control_unchanged'))
            stack.enter_context(patch.object(view, 'assert_web'))
            stack.enter_context(patch.object(view.shared, 'private_json'))
            stack.enter_context(patch.object(view.shared, 'wait_for'))
            compose = stack.enter_context(patch.object(view.shared, 'compose', side_effect=[json.dumps(config), json.dumps(after), '']))
            dangerous = stack.enter_context(patch.object(view.shared, 'run', side_effect=AssertionError('Unexpected external mutation')))
            view.deploy(Path(temp), manifest, tag, items, {'PORT': '3010'})
        inspect.assert_called_once_with('image', 'inspect', tag)
        validate.assert_called_once_with(pinned)
        dangerous.assert_not_called()
        self.assertEqual(compose.call_args_list[-1].args[1], ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'])
        self.assertEqual(manifest['releaseImageId'], pinned)

    def test_rollback_only_recreates_pinned_web_without_migrations(self):
        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            stack.enter_context(patch.object(view.shared, 'docker_json', return_value=[{'Id': view.BASELINE}]))
            stack.enter_context(patch.object(view.shared, 'backed_up_chain', return_value=['copy.yml']))
            stack.enter_context(patch.object(view.shared, 'private_json'))
            stack.enter_context(patch.object(view.shared, 'wait_for'))
            stack.enter_context(patch.object(view, 'assert_control_unchanged'))
            web = stack.enter_context(patch.object(view, 'assert_web'))
            compose = stack.enter_context(patch.object(view.shared, 'compose'))
            dangerous = stack.enter_context(patch.object(view.shared, 'run', side_effect=AssertionError('Unexpected external mutation')))
            view.rollback(Path(temp), {}, {'PORT': '3010'}, {'PORT': '3010'})
        compose.assert_called_once()
        self.assertEqual(compose.call_args.args[1], ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'])
        web.assert_called_once_with(view.BASELINE, {'PORT': '3010'}, view.WEB_PORTS)
        dangerous.assert_not_called()


if __name__ == '__main__':
    unittest.main()
