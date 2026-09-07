"""Offline boundaries for installing the restricted production deploy key."""

import base64
import ast
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import stat
import sys
import tempfile
import types
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/deploy/configure_autodeploy.py"
SPEC = importlib.util.spec_from_file_location("configure_autodeploy_under_test", SCRIPT)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


def canonical_profile():
    return {
        "repository": "inftverezovsky/TData",
        "app_dir": "/root/tdata",
        "state_dir": "/root/tdata/.deploy/auto",
        "compose_files": ["/root/tdata/docker-compose.yml"],
        "services": ["web", "khl-worker", "tline-worker", "telegram-consultant"],
        "minimum_free_bytes": 8 * 1024**3,
        "health_url": "http://127.0.0.1:3010/api/health",
        "health_timeout": 180,
        "legacy_migrations": {},
    }


def public_fixture():
    algorithm = b"ssh-ed25519"
    blob = struct.pack(">I", len(algorithm)) + algorithm + struct.pack(">I", 32) + bytes(32)
    return algorithm + b" " + base64.b64encode(blob)


class ProfileBoundaries(unittest.TestCase):
    def test_accepts_only_the_inventoried_target_and_four_application_services(self):
        profile = canonical_profile()
        self.assertEqual(installer.validate_profile(profile), profile)

    def test_rejects_noncanonical_targets_and_secret_bearing_extra_fields(self):
        invalid = [
            {"repository": "other/repository"},
            {"app_dir": "/root/another-app"},
            {"state_dir": "/tmp/releases"},
            {"health_url": "http://127.0.0.1:8082/api/health"},
            {"services": ["web", "khl-worker", "tline-worker", "postgres"]},
            {"services": ["web", "khl-worker", "tline-worker", "telegram-consultant", "web"]},
            {"minimum_free_bytes": 7 * 1024**3},
            {"health_timeout": 29},
            {"legacy_migrations": {"../migration": "0" * 64}},
            {"legacy_migrations": {"20260907190000_fixture": "invalid"}},
            {"DATABASE_URL": "synthetic-value-must-not-enter-profile"},
            {"ssh_private_key": "synthetic-value-must-not-enter-profile"},
        ]
        for mutation in invalid:
            with self.subTest(fields=list(mutation)):
                with self.assertRaises(ValueError):
                    installer.validate_profile({**canonical_profile(), **mutation})

    def test_rejects_compose_paths_that_escape_or_split_the_canonical_target(self):
        paths = [
            "docker-compose.yml",
            "/root/tdata/../unrelated/docker-compose.yml",
            "/root/tdata-other/docker-compose.yml",
            "/etc/docker-compose.yml",
            "/root/tdata/config\nsecond.yml",
            "/root/tdata/config\rsecond.yml",
            "/root/tdata/config\0second.yml",
        ]
        for candidate in paths:
            with self.subTest(path=repr(candidate)):
                with self.assertRaises(ValueError):
                    installer.validate_profile({**canonical_profile(), "compose_files": [candidate]})
        with self.assertRaises(ValueError):
            installer.validate_profile({**canonical_profile(), "compose_files": []})
        with self.assertRaises(ValueError):
            installer.validate_profile({**canonical_profile(), "compose_files": [paths[0], paths[0]]})


class InstallationBoundaries(unittest.TestCase):
    def test_every_remote_action_is_valid_python_before_it_reaches_ssh(self):
        payloads = [
            {"action": "install", "config": canonical_profile(), "sources": {"auto_deploy.py": "pass\n"},
             "entry": public_fixture().decode(), "marker": installer.KEY_MARKER + "0" * 32},
            {"action": "remove_new_key", "marker": installer.KEY_MARKER + "0" * 32},
            {"action": "retire_old_keys", "marker": installer.KEY_MARKER + "0" * 32},
        ]
        for payload in payloads:
            with self.subTest(action=payload["action"]):
                compile(installer.remote_script(payload), "remote-install", "exec")

    def test_remote_target_guard_rejects_writable_or_unowned_ancestors_and_links(self):
        function = next(node for node in ast.parse(installer.REMOTE_INSTALL).body
                        if isinstance(node, ast.FunctionDef) and node.name == "regular")
        compiled = compile(ast.Module(body=[function], type_ignores=[]), "remote-path-guard", "exec")
        target = "/usr/local/lib/tdata-autodeploy/auto_deploy.py"

        def check(overrides):
            class GuardPath:
                def __init__(self, value):
                    self.value = str(value)

                @property
                def parents(self):
                    return tuple(GuardPath(parent) for parent in installer.PurePosixPath(self.value).parents)

                def is_symlink(self):
                    return overrides.get(self.value, {}).get("symlink", False)

                def exists(self):
                    return True

                def stat(self):
                    state = overrides.get(self.value, {})
                    return types.SimpleNamespace(st_uid=state.get("uid", 0),
                                                 st_mode=stat.S_IFDIR | state.get("mode", 0o755))

            namespace = {"pathlib": types.SimpleNamespace(Path=GuardPath), "stat": stat}
            exec(compiled, namespace)
            return namespace["regular"](target)

        self.assertEqual(check({}).value, target)
        for path in [target, "/usr/local/lib/tdata-autodeploy", "/usr/local/lib", "/usr"]:
            for state in [{"mode": 0o777}, {"mode": 0o775}, {"uid": 1000}, {"symlink": True}]:
                with self.subTest(path=path, state=state):
                    with self.assertRaises(RuntimeError):
                        check({path: state})

    @contextlib.contextmanager
    def invocation(self, *, apply=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = root / "profile.json"
            hosts = root / "known_hosts"
            operator_key = root / "operator-placeholder"
            profile.write_text(json.dumps(canonical_profile()), encoding="utf-8")
            hosts.write_bytes(b"82.147.67.231 " + public_fixture() + b"\n")
            operator_key.write_text("offline placeholder", encoding="utf-8")
            args = [str(SCRIPT), "--profile", str(profile), "--known-hosts", str(hosts),
                    "--ssh-key", str(operator_key)]
            if apply:
                args.append("--apply")
            with mock.patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()):
                yield root

    def test_dry_run_does_not_generate_a_key_or_run_any_external_command(self):
        with self.invocation(), mock.patch.object(installer.subprocess, "run") as external:
            installer.main()
            external.assert_not_called()

    def fake_crypto(self, private_material):
        public = types.SimpleNamespace(public_bytes=lambda *_args, **_kwargs: public_fixture())
        private = types.SimpleNamespace(
            private_bytes=lambda *_args, **_kwargs: private_material,
            public_key=lambda: public,
        )
        return {
            "cryptography.hazmat.primitives.asymmetric.ed25519": types.SimpleNamespace(
                Ed25519PrivateKey=types.SimpleNamespace(generate=lambda: private)),
            "cryptography.hazmat.primitives.serialization": types.SimpleNamespace(
                Encoding=types.SimpleNamespace(PEM="PEM", OpenSSH="OpenSSH"),
                NoEncryption=lambda: None,
                PrivateFormat=types.SimpleNamespace(OpenSSH="OpenSSH"),
                PublicFormat=types.SimpleNamespace(OpenSSH="OpenSSH")),
        }

    def test_new_private_material_is_sent_only_to_github_secret_stdin(self):
        private_material = b"offline-private-fixture"
        calls = []

        def fake_run(command, *, data=None):
            calls.append((command, data))
            return b""

        with self.invocation(apply=True) as directory, \
                mock.patch.dict(sys.modules, self.fake_crypto(private_material)), \
                mock.patch.object(installer, "github_production_environment"), \
                mock.patch.object(installer, "run", side_effect=fake_run):
            installer.main()
            private_transfers = [command for command, data in calls if data == private_material]
            self.assertEqual(private_transfers, [["gh", "secret", "set", "TDATA_DEPLOY_SSH_KEY",
                                                 "--repo", installer.REPOSITORY, "--env", "production"]])
            for command, data in calls:
                self.assertNotIn(private_material.decode(), " ".join(command))
                if command[0] == "ssh":
                    self.assertNotIn(private_material, data)
            for file in directory.iterdir():
                self.assertNotIn(private_material, file.read_bytes())

    def test_failed_secret_upload_removes_only_the_new_key_and_does_not_retire_old_keys(self):
        scripts = []

        def fake_run(command, *, data=None):
            if command[:4] == ["gh", "secret", "set", "TDATA_DEPLOY_SSH_KEY"]:
                raise RuntimeError("offline upload failure")
            if command[0] == "ssh":
                scripts.append(data)
            return b""

        with self.invocation(apply=True), \
                mock.patch.dict(sys.modules, self.fake_crypto(b"offline-private-fixture")), \
                mock.patch.object(installer, "github_production_environment"), \
                mock.patch.object(installer, "run", side_effect=fake_run), \
                mock.patch.object(installer, "remote_script", side_effect=lambda payload: json.dumps(payload).encode()):
            with self.assertRaises(RuntimeError):
                installer.main()
        actions = [json.loads(script)["action"] for script in scripts if script.startswith(b"{")]
        self.assertEqual(actions, ["install", "remove_new_key"])


class GithubEnvironmentBoundaries(unittest.TestCase):
    @staticmethod
    def production(**changes):
        return {"name": "production", "protection_rules": [],
                "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
                **changes}

    def call_with(self, environments, branches):
        calls = []

        def fake_run(command, *, data=None):
            calls.append((command, data))
            if command[-1].endswith("/environments"):
                return json.dumps({"environments": environments}).encode()
            if command[-1].endswith("/deployment-branch-policies"):
                return json.dumps({"branch_policies": branches}).encode()
            return b"{}"

        return calls, mock.patch.object(installer, "run", side_effect=fake_run)

    def test_existing_reviewer_or_branch_protections_are_not_mutated_on_refusal(self):
        scenarios = [
            ([self.production(protection_rules=[{"type": "required_reviewers"}])], []),
            ([self.production(protection_rules=[{"type": "wait_timer"}])], []),
            ([self.production(protection_rules=[{"type": "branch_policy"}, {"type": "required_reviewers"}])], []),
            ([self.production(protection_rules=[{"type": "unknown_protection"}])], []),
            ([self.production(protection_rules={"type": "branch_policy"})], []),
            ([self.production(deployment_branch_policy=None)], []),
            ([self.production()], [{"name": "*", "type": "branch"}]),
            ([self.production()], [{"name": "main", "type": "tag"}]),
        ]
        for environments, branches in scenarios:
            with self.subTest(branches=branches):
                calls, fake = self.call_with(environments, branches)
                with fake, self.assertRaises(RuntimeError):
                    installer.github_production_environment()
                self.assertTrue(all("--method" not in command for command, _ in calls))

    def test_existing_main_only_environment_needs_no_write(self):
        calls, fake = self.call_with([self.production()], [{"name": "main", "type": "branch"}])
        with fake:
            installer.github_production_environment()
        self.assertTrue(all("--method" not in command for command, _ in calls))

    def test_github_branch_policy_protection_rule_allows_idempotent_installation(self):
        existing = self.production(protection_rules=[{
            "type": "branch_policy", "id": 123, "node_id": "fixture-policy-node",
        }])
        calls, fake = self.call_with([existing], [{"name": "main", "type": "branch"}])
        with fake:
            installer.github_production_environment()
        self.assertTrue(all("--method" not in command for command, _ in calls))

    def test_new_environment_is_created_with_only_the_main_branch_policy(self):
        calls, fake = self.call_with([], [])
        with fake:
            installer.github_production_environment()
        mutations = [(command, json.loads(data)) for command, data in calls if "--method" in command]
        self.assertEqual(len(mutations), 2)
        self.assertEqual(mutations[0][1], {"deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True}})
        self.assertEqual(mutations[1][1], {"name": "main", "type": "branch"})


if __name__ == "__main__":
    unittest.main()
