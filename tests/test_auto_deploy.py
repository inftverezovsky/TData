"""Offline safety tests for scripts/deploy/auto_deploy.py."""

from __future__ import annotations

import importlib.util
import io
import json
import subprocess
from pathlib import Path
import tarfile
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch


SPEC = importlib.util.spec_from_file_location(
    "auto_deploy", Path(__file__).parents[1] / "scripts" / "deploy" / "auto_deploy.py"
)
auto = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(auto)


def valid_config(temp: Path) -> auto.Config:
    app = Path("/root/tdata")
    return auto.Config(
        {
            "app_dir": str(app),
            "repository": "inftverezovsky/TData",
            "compose_files": [str(app / "docker-compose.yml"), str(app / "deployments/compose/live.yml")],
            "services": ["web", "khl-worker", "tline-worker", "telegram-consultant"],
            "state_dir": str(app / ".deploy/auto"),
            "min_free_gib": 8,
        }
    )


class AutoDeployTests(unittest.TestCase):
    def test_forced_command_allows_only_exact_deploy_sha(self):
        sha = "a" * 40
        self.assertEqual(auto.parse_ssh_command(f"deploy {sha}"), sha)
        for command in [None, "", f"deploy {sha};id", f"deploy {sha.upper()}", f"inspect {sha}", f"deploy {sha} extra"]:
            with self.subTest(command=command), self.assertRaises(auto.GuardError):
                auto.parse_ssh_command(command)

    def test_config_is_canonical_and_nonsecret(self):
        cfg = valid_config(Path("/tmp"))
        self.assertEqual(cfg.repository, "inftverezovsky/TData")
        self.assertEqual(cfg.services, ("web", "khl-worker", "tline-worker", "telegram-consultant"))
        bad = cfg.raw | {"services": ["web"]}
        with self.assertRaisesRegex(auto.GuardError, "unexpected_services"):
            auto.Config(bad)
        with self.assertRaisesRegex(auto.GuardError, "unexpected_repository"):
            auto.Config(cfg.raw | {"repository": "other/repo"})
        with self.assertRaisesRegex(auto.GuardError, "path_escape"):
            auto.Config(cfg.raw | {"state_dir": "/tmp/state"})

    def make_tar(self, path: Path, entries: dict[str, bytes | None]) -> None:
        with tarfile.open(path, "w:gz") as archive:
            for name, data in entries.items():
                info = tarfile.TarInfo(name)
                if data is None:
                    info.type = tarfile.SYMTYPE
                    info.linkname = "/etc/passwd"
                    archive.addfile(info)
                else:
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))

    def test_safe_extract_rejects_traversal_symlinks_and_specials(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            good = root / "good.tar.gz"
            self.make_tar(good, {"TData-abc/package.json": b"{}"})
            destination = root / "out"
            auto.safe_extract_tarball(good, destination)
            self.assertEqual((destination / "package.json").read_bytes(), b"{}")
            for name, data in [
                ("bad-traversal.tar.gz", {"TData-abc/../evil": b"x"}),
                ("bad-root.tar.gz", {"/absolute": b"x"}),
                ("bad-link.tar.gz", {"TData-abc/link": None}),
            ]:
                with self.subTest(name=name):
                    archive = root / name
                    self.make_tar(archive, data)
                    with self.assertRaises(auto.GuardError):
                        auto.safe_extract_tarball(archive, root / f"out-{name}")

    def test_tar_limits_are_enforced(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "large.tar.gz"
            original_limit = auto.SOURCE_EXPANDED_MAX_BYTES
            with patch.object(auto, "SOURCE_EXPANDED_MAX_BYTES", 5):
                self.make_tar(archive, {"TData-abc/a": b"123", "TData-abc/b": b"456"})
                with self.assertRaisesRegex(auto.GuardError, "tar_expanded_too_large"):
                    auto.safe_extract_tarball(archive, root / "out")
            self.assertEqual(original_limit, 200 * 1024 * 1024)

    def test_migration_policy_blocks_failed_unknown_changed_and_unreviewed_pending(self):
        source = {"001_init": "1" * 64, "002_new": "2" * 64}
        policy = {"pending": {"002_new": "2" * 64}, "legacy": {"000_legacy": "0" * 64}}
        rows = [
            {"name": "000_legacy", "checksum": "0" * 64, "finished": True, "rolledBack": False},
            {"name": "001_init", "checksum": "1" * 64, "finished": True, "rolledBack": False},
        ]
        state = auto.validate_migrations(rows, source, policy, {})
        self.assertEqual([item["name"] for item in state["pending"]], ["002_new"])
        with self.assertRaisesRegex(auto.GuardError, "failed_migrations"):
            auto.validate_migrations([{"name": "bad", "checksum": "b", "finished": False, "rolledBack": False}], source, policy, {})
        with self.assertRaisesRegex(auto.GuardError, "checksum"):
            auto.validate_migrations([{"name": "001_init", "checksum": "x", "finished": True, "rolledBack": False}], source, policy, {})
        with self.assertRaisesRegex(auto.GuardError, "pending_migration_without_policy"):
            auto.validate_migrations(rows, source | {"003_extra": "3" * 64}, policy, {})

    def test_policy_file_uses_exact_backward_compatible_schema(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            policy_path = root / auto.MIGRATION_POLICY_RELATIVE_PATH
            policy_path.parent.mkdir(parents=True)
            policy_path.write_text(
                json.dumps({"version": 1, "backward_compatible": {"002_new": "2" * 64}}),
                encoding="utf-8",
            )
            policy = auto.load_migration_policy(root)
            self.assertEqual(policy["pending"], {"002_new": "2" * 64})
            policy_path.write_text(json.dumps({"version": 2, "backward_compatible": {}}), encoding="utf-8")
            with self.assertRaisesRegex(auto.GuardError, "version"):
                auto.load_migration_policy(root)

    def test_container_ownership_and_loopback_ports_are_required(self):
        def container(service: str, name: str, image: str = "sha256:" + "a" * 64):
            return {
                "Name": "/" + name,
                "Image": image,
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": "tdata",
                        "com.docker.compose.service": service,
                        "com.docker.compose.project.working_dir": "/root/tdata",
                    }
                },
                "HostConfig": {"PortBindings": {}},
                "State": {"Running": True},
            }

        containers = {
            name: container(service, name)
            for service, name in auto.EXPECTED_CONTAINERS.items()
        }
        containers["tdata-postgres"] = container("postgres", "tdata-postgres")
        containers["tdata-web"]["HostConfig"]["PortBindings"] = {"3010/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3010"}]}
        containers["tdata-postgres"]["HostConfig"]["PortBindings"] = {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5434"}]}
        cfg = valid_config(Path("/tmp"))
        auto.validate_container_ownership(cfg, containers)
        containers["tdata-web"]["HostConfig"]["PortBindings"]["3010/tcp"][0]["HostIp"] = "0.0.0.0"
        with self.assertRaisesRegex(auto.GuardError, "port_binding"):
            auto.validate_container_ownership(cfg, containers)

    def test_override_updates_only_selected_images_and_sha_environment(self):
        with tempfile.TemporaryDirectory() as raw:
            cfg = valid_config(Path(raw))
            cfg.state_dir = Path(raw) / "state"
            images = {service: f"tdata-ci:{'a' * 40}" for service in auto.EXPECTED_SERVICES}
            path = auto.write_image_override(cfg, images, "a" * 40, current=False)
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertIn("candidates", path.parts)
            self.assertEqual(set(data["services"]), set(auto.EXPECTED_SERVICES))
            for service in auto.EXPECTED_SERVICES:
                self.assertEqual(data["services"][service]["image"], images[service])
                self.assertEqual(data["services"][service]["environment"]["TDATA_GIT_SHA"], "a" * 40)
            current = auto.write_image_override(cfg, images, "a" * 40, current=True)
            self.assertEqual(current.name, "current-image.override.json")

    def test_compose_override_cannot_change_ports_or_unselected_services(self):
        before = {
            "name": "tdata",
            "services": {
                "web": {
                    "image": "old",
                    "container_name": "tdata-web",
                    "ports": [{"host_ip": "127.0.0.1", "published": "3010", "target": 3010}],
                    "environment": {"PORT": "3010"},
                },
                "postgres": {
                    "image": "postgres:16",
                    "container_name": "tdata-postgres",
                    "ports": [{"host_ip": "127.0.0.1", "published": "5434", "target": 5432}],
                },
                "khl-worker": {"image": "old", "container_name": "tdata-khl-worker", "environment": {}},
                "tline-worker": {"image": "old", "container_name": "tdata-tline-worker", "environment": {}},
                "telegram-consultant": {"image": "old", "container_name": "tdata-telegram-consultant", "environment": {}},
            },
        }
        auto.validate_resolved_compose(valid_config(Path("/tmp")), before)
        public = json.loads(json.dumps(before))
        public["services"]["web"]["ports"].append({"host_ip": "0.0.0.0", "published": "80", "target": 3010})
        with self.assertRaisesRegex(auto.GuardError, "compose_port"):
            auto.validate_resolved_compose(valid_config(Path("/tmp")), public)
        worker_port = json.loads(json.dumps(before))
        worker_port["services"]["khl-worker"]["ports"] = [{"host_ip": "127.0.0.1", "published": "3900", "target": 3900}]
        with self.assertRaisesRegex(auto.GuardError, "worker_ports"):
            auto.validate_resolved_compose(valid_config(Path("/tmp")), worker_port)
        after = json.loads(json.dumps(before))
        for service in auto.EXPECTED_SERVICES:
            after["services"][service]["image"] = "new"
            after["services"][service].setdefault("environment", {})["TDATA_GIT_SHA"] = "a" * 40
        auto.validate_compose_override(before, after, "a" * 40)
        after["services"]["web"]["ports"][0]["published"] = "3011"
        with self.assertRaisesRegex(auto.GuardError, "shape"):
            auto.validate_compose_override(before, after, "a" * 40)
        changed = json.loads(json.dumps(before))
        for service in auto.EXPECTED_SERVICES:
            changed["services"][service]["image"] = "new"
            changed["services"][service].setdefault("environment", {})["TDATA_GIT_SHA"] = "a" * 40
        changed["services"]["postgres"]["image"] = "postgres:latest"
        with self.assertRaisesRegex(auto.GuardError, "unselected"):
            auto.validate_compose_override(before, changed, "a" * 40)

    def test_build_uses_revision_build_arg_label_and_inspects_tag(self):
        class FakeRunner:
            def __init__(self):
                self.commands = []

            def run(self, args, **kwargs):
                self.commands.append(args)

            def json(self, args, **kwargs):
                self.commands.append(args)
                return [{"Id": "sha256:" + "b" * 64, "Config": {"Labels": {auto.REVISION_LABEL: "a" * 40}}}]

        runner = FakeRunner()
        tag, image_id = auto.build_image(runner, Path("/tmp/source"), "a" * 40)
        self.assertEqual(tag, "tdata-ci:" + "a" * 40)
        self.assertEqual(image_id, "sha256:" + "b" * 64)
        build = runner.commands[0]
        self.assertIn("--build-arg", build)
        self.assertIn("TDATA_GIT_SHA=" + "a" * 40, build)
        self.assertIn(f"{auto.REVISION_LABEL}=" + "a" * 40, build)

    def test_backup_verification_uses_postgres_container_pg_restore_streams(self):
        test_case = self

        class FakeRunner:
            def __init__(self):
                self.commands = []
                self.stdin_handles = []

            def safe_env(self, env=None):
                return {}

            def run(self, args, **kwargs):
                self.commands.append(args)
                if args[:5] == ["docker", "exec", "-i", auto.POSTGRES_CONTAINER, "pg_restore"]:
                    self.stdin_handles.append(kwargs.get("stdin_handle"))
                    test_case.assertIsNone(kwargs.get("input_bytes"))
                    test_case.assertTrue(kwargs.get("discard"))
                return MagicMock(returncode=0)

        runner = FakeRunner()

        def fake_pg_dump(args, **kwargs):
            kwargs["stdout"].write(b"fixture-dump")
            return MagicMock(returncode=0)

        with tempfile.TemporaryDirectory() as raw, patch.object(auto.subprocess, "run", side_effect=fake_pg_dump):
            cfg = valid_config(Path("/tmp"))
            cfg.state_dir = Path(raw) / "state"
            backup = auto.backup_database(runner, cfg, "a" * 40)
            self.assertEqual(backup.read_bytes(), b"fixture-dump")
        restore_commands = [command for command in runner.commands if command[:5] == ["docker", "exec", "-i", auto.POSTGRES_CONTAINER, "pg_restore"]]
        self.assertEqual(restore_commands, [
            ["docker", "exec", "-i", auto.POSTGRES_CONTAINER, "pg_restore", "--list"],
            ["docker", "exec", "-i", auto.POSTGRES_CONTAINER, "pg_restore", "--file=/dev/null"],
        ])
        self.assertEqual(len(runner.stdin_handles), 2)
        self.assertTrue(all(handle is not None for handle in runner.stdin_handles))

    def test_success_promotes_current_override_with_immutable_image_id(self):
        cfg = valid_config(Path("/tmp"))
        image_id = "sha256:" + "b" * 64
        with ExitStack() as stack:
            runner_type = stack.enter_context(patch.object(auto, "Runner"))
            stack.enter_context(patch.object(auto, "deploy_lock", return_value=MagicMock()))
            stack.enter_context(patch.object(auto, "collect_inventory", return_value=({"freeBytes": 9}, {"x": {}}, {}, {})))
            stack.enter_context(patch.object(auto, "service_image_ids", return_value={service: "old" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "service_revisions", return_value={service: "" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "require_current_main"))
            stack.enter_context(patch.object(auto, "prepare_source", return_value=Path("/tmp/source")))
            stack.enter_context(patch.object(auto, "source_migrations", return_value={}))
            stack.enter_context(patch.object(auto, "load_migration_policy", return_value={"pending": {}, "legacy": {}}))
            stack.enter_context(patch.object(auto, "build_image", return_value=("tdata-ci:" + "a" * 40, image_id)))
            stack.enter_context(patch.object(auto, "compose_json"))
            stack.enter_context(patch.object(auto, "validate_compose_override"))
            stack.enter_context(patch.object(auto, "backup_database", return_value=Path("/root/tdata/.deploy/auto/backups/db.dump")))
            stack.enter_context(patch.object(auto, "migration_rows", return_value=[]))
            stack.enter_context(patch.object(auto, "validate_migrations", return_value={"applied": [], "pending": []}))
            stack.enter_context(patch.object(auto, "compose_run_migrations"))
            stack.enter_context(patch.object(auto, "compose_up"))
            stack.enter_context(patch.object(auto, "wait_until"))
            stack.enter_context(patch.object(auto, "validate_recreated_services"))
            receipt = stack.enter_context(patch.object(auto, "write_receipt"))
            runner_type.return_value.close.return_value = None
            with tempfile.TemporaryDirectory() as raw:
                cfg.state_dir = Path(raw) / "state"
                auto.deploy(cfg, "a" * 40)
                current = json.loads((cfg.state_dir / "current-image.override.json").read_text())["services"]
        self.assertEqual({service: value["image"] for service, value in current.items()}, {service: image_id for service in auto.EXPECTED_SERVICES})
        self.assertEqual(receipt.call_args.args[3], "tdata-ci:" + "a" * 40)
        self.assertEqual(receipt.call_args.args[4], image_id)

    def test_activation_failure_rolls_back_images_without_database_restore(self):
        cfg = valid_config(Path("/tmp"))
        cfg.state_dir = Path("/root/tdata/.deploy/auto")
        old = {service: "sha256:" + str(index) * 64 for index, service in enumerate(auto.EXPECTED_SERVICES, start=1)}
        calls = []
        with ExitStack() as stack:
            runner_type = stack.enter_context(patch.object(auto, "Runner"))
            stack.enter_context(patch.object(auto, "deploy_lock", return_value=MagicMock()))
            stack.enter_context(patch.object(auto, "collect_inventory", return_value=({"freeBytes": 9}, {"x": {}}, {}, {})))
            stack.enter_context(patch.object(auto, "service_image_ids", return_value=old))
            stack.enter_context(patch.object(auto, "service_revisions", return_value={service: "" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "require_current_main"))
            stack.enter_context(patch.object(auto, "prepare_source", return_value=Path("/tmp/source")))
            stack.enter_context(patch.object(auto, "source_migrations", return_value={}))
            stack.enter_context(patch.object(auto, "load_migration_policy", return_value={"pending": {}, "legacy": {}}))
            stack.enter_context(patch.object(auto, "build_image", return_value=("tdata-ci:" + "a" * 40, "sha256:" + "b" * 64)))
            stack.enter_context(patch.object(auto, "compose_json"))
            stack.enter_context(patch.object(auto, "validate_compose_override"))
            stack.enter_context(patch.object(auto, "backup_database", return_value=Path("/root/tdata/.deploy/auto/backups/db.dump")))
            stack.enter_context(patch.object(auto, "migration_rows", return_value=[]))
            stack.enter_context(patch.object(auto, "validate_migrations", return_value={"applied": [], "pending": []}))
            stack.enter_context(patch.object(auto, "compose_run_migrations"))
            stack.enter_context(patch.object(auto, "compose_up", side_effect=lambda runner, cfg, override, compose_env: calls.append(json.loads(override.read_text())["services"])))
            stack.enter_context(patch.object(auto, "wait_until", side_effect=[auto.GuardError("health_timeout"), None]))
            stack.enter_context(patch.object(auto, "validate_recreated_services"))
            stack.enter_context(patch.object(auto, "validate_service_images_running"))
            stack.enter_context(patch.object(auto, "write_receipt"))
            runner_type.return_value.close.return_value = None
            with tempfile.TemporaryDirectory() as raw:
                cfg.state_dir = Path(raw) / "state"
                with self.assertRaisesRegex(auto.GuardError, "activation_failed"):
                    auto.deploy(cfg, "a" * 40)
                current = cfg.state_dir / "current-image.override.json"
                self.assertTrue(current.is_file())
                current_services = json.loads(current.read_text())["services"]
                self.assertEqual({service: value["image"] for service, value in current_services.items()}, old)
        self.assertEqual(len(calls), 2)
        self.assertEqual({service: value["image"] for service, value in calls[1].items()}, old)

    def test_migration_failure_does_not_recreate_or_rollback_services(self):
        cfg = valid_config(Path("/tmp"))
        with ExitStack() as stack:
            runner_type = stack.enter_context(patch.object(auto, "Runner"))
            stack.enter_context(patch.object(auto, "deploy_lock", return_value=MagicMock()))
            stack.enter_context(patch.object(auto, "collect_inventory", return_value=({"freeBytes": 9}, {"x": {}}, {}, {})))
            stack.enter_context(patch.object(auto, "service_image_ids", return_value={service: "old" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "service_revisions", return_value={service: "" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "require_current_main"))
            stack.enter_context(patch.object(auto, "prepare_source", return_value=Path("/tmp/source")))
            stack.enter_context(patch.object(auto, "source_migrations", return_value={}))
            stack.enter_context(patch.object(auto, "load_migration_policy", return_value={"pending": {}, "legacy": {}}))
            stack.enter_context(patch.object(auto, "build_image", return_value=("tdata-ci:" + "a" * 40, "sha256:" + "b" * 64)))
            stack.enter_context(patch.object(auto, "compose_json"))
            stack.enter_context(patch.object(auto, "validate_compose_override"))
            stack.enter_context(patch.object(auto, "backup_database", return_value=Path("/root/tdata/.deploy/auto/backups/db.dump")))
            stack.enter_context(patch.object(auto, "migration_rows", return_value=[]))
            stack.enter_context(patch.object(auto, "validate_migrations", return_value={"applied": [], "pending": []}))
            stack.enter_context(patch.object(auto, "compose_run_migrations", side_effect=auto.GuardError("migration_failed")))
            up = stack.enter_context(patch.object(auto, "compose_up"))
            runner_type.return_value.close.return_value = None
            with tempfile.TemporaryDirectory() as raw:
                cfg.state_dir = Path(raw) / "state"
                with self.assertRaisesRegex(auto.GuardError, "migration_failed"):
                    auto.deploy(cfg, "a" * 40)
                self.assertFalse((cfg.state_dir / "current-image.override.json").exists())
        up.assert_not_called()

    def test_noop_migration_blocks_activation(self):
        cfg = valid_config(Path("/tmp"))
        with ExitStack() as stack:
            runner_type = stack.enter_context(patch.object(auto, "Runner"))
            stack.enter_context(patch.object(auto, "deploy_lock", return_value=MagicMock()))
            stack.enter_context(patch.object(auto, "collect_inventory", return_value=({"freeBytes": 9}, {"x": {}}, {}, {})))
            stack.enter_context(patch.object(auto, "service_image_ids", return_value={service: "old" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "service_revisions", return_value={service: "" for service in auto.EXPECTED_SERVICES}))
            stack.enter_context(patch.object(auto, "require_current_main"))
            stack.enter_context(patch.object(auto, "prepare_source", return_value=Path("/tmp/source")))
            stack.enter_context(patch.object(auto, "source_migrations", return_value={"002_new": "2" * 64}))
            stack.enter_context(patch.object(auto, "load_migration_policy", return_value={"pending": {"002_new": "2" * 64}, "legacy": {}}))
            stack.enter_context(patch.object(auto, "build_image", return_value=("tdata-ci:" + "a" * 40, "sha256:" + "b" * 64)))
            stack.enter_context(patch.object(auto, "compose_json"))
            stack.enter_context(patch.object(auto, "validate_compose_override"))
            stack.enter_context(patch.object(auto, "backup_database", return_value=Path("/root/tdata/.deploy/auto/backups/db.dump")))
            stack.enter_context(patch.object(auto, "migration_rows", return_value=[]))
            stack.enter_context(patch.object(auto, "validate_migrations", return_value={"applied": [], "pending": [{"name": "002_new", "checksum": "2" * 64}]}))
            stack.enter_context(patch.object(auto, "compose_run_migrations"))
            up = stack.enter_context(patch.object(auto, "compose_up"))
            runner_type.return_value.close.return_value = None
            with tempfile.TemporaryDirectory() as raw:
                cfg.state_dir = Path(raw) / "state"
                with self.assertRaisesRegex(auto.GuardError, "migration_not_applied"):
                    auto.deploy(cfg, "a" * 40)
                self.assertFalse((cfg.state_dir / "current-image.override.json").exists())
        up.assert_not_called()

    def test_health_requires_ok_and_exact_source_revision(self):
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return json.dumps({"ok": True, "build": {"sourceRevision": "a" * 40}}).encode()

        with patch.object(auto.urllib.request, "urlopen", return_value=Response()):
            self.assertTrue(auto.health_ok("a" * 40))
            self.assertFalse(auto.health_ok("b" * 40))


class ComposeRuntimeEnvironmentTests(unittest.TestCase):
    @staticmethod
    def containers(values):
        names = [*auto.EXPECTED_CONTAINERS.values(), auto.POSTGRES_CONTAINER]
        return {name: {"Config": {"Env": [f"{key}={value}" for key, value in values.items()]}, "State": {"Running": True}}
                for name in names}

    @staticmethod
    def missing(key):
        return subprocess.CompletedProcess([], 1, b"", f"required variable {key} is missing a value".encode())

    def test_resolves_only_required_agreed_values_and_captures_them_before_recreation(self):
        values = {"LIQUIPEDIA_USER_AGENT": "offline-agent", "DATABASE_URL": "offline-database-value"}
        containers = self.containers({**values, "UNUSED_RUNTIME_SETTING": "must-stay-out"})
        runner = MagicMock()
        runner.run.side_effect = [self.missing(key) for key in values] + [
            subprocess.CompletedProcess([], 0, b'{"name":"tdata","services":{}}', b"")]
        resolved, environment = auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), containers)
        self.assertEqual(resolved["name"], "tdata")
        self.assertEqual(environment, values)
        self.assertEqual(runner.run.call_args_list[0].kwargs["env"], {})
        self.assertEqual(runner.run.call_args_list[-1].kwargs["env"], values)
        containers["tdata-web"]["Config"]["Env"] = ["DATABASE_URL=recreated-different-value"]
        self.assertEqual(environment, values)

    def test_missing_empty_conflicting_or_foreign_container_values_fail_without_leaking(self):
        for case in ["missing", "empty", "conflict", "foreign"]:
            with self.subTest(case=case):
                containers = self.containers({} if case in {"missing", "foreign"} else {"DATABASE_URL": "offline-sensitive-one"})
                if case == "empty":
                    containers["tdata-web"]["Config"]["Env"] = ["DATABASE_URL="]
                if case == "conflict":
                    containers["tdata-web"]["Config"]["Env"] = ["DATABASE_URL=offline-sensitive-two"]
                if case == "foreign":
                    containers["unrelated-app"] = {"Config": {"Env": ["DATABASE_URL=offline-sensitive-one"]}}
                runner = MagicMock()
                runner.run.return_value = self.missing("DATABASE_URL")
                with self.assertRaises(auto.GuardError) as caught:
                    auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), containers)
                self.assertNotIn("offline-sensitive", str(caught.exception))
                self.assertEqual(runner.run.call_count, 1)

    def test_rejects_process_controls_and_unrecognized_errors_before_retry(self):
        keys = ["COMPOSE_FILE", "DOCKER_HOST", "GIT_CONFIG_GLOBAL", "PYTHONPATH", "LD_PRELOAD", "PATH", "HOME"]
        for key in keys:
            with self.subTest(key=key):
                runner = MagicMock()
                runner.run.return_value = self.missing(key)
                with self.assertRaises(auto.GuardError):
                    auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), self.containers({key: "offline-sensitive"}))
                self.assertEqual(runner.run.call_count, 1)
        runner = MagicMock()
        runner.run.return_value = subprocess.CompletedProcess([], 1, b"", b"unrelated error with offline-sensitive-value")
        with self.assertRaises(auto.GuardError) as caught:
            auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), self.containers({}))
        self.assertNotIn("offline-sensitive", str(caught.exception))

    def test_fallback_limit_and_repeated_missing_key_cannot_loop(self):
        values = {f"SETTING_{index}": f"offline-{index}" for index in range(3)}
        runner = MagicMock()
        runner.run.side_effect = [self.missing(key) for key in values]
        with patch.object(auto, "MAX_COMPOSE_ENV_FALLBACKS", 2), self.assertRaises(auto.GuardError):
            auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), self.containers(values))
        self.assertEqual(runner.run.call_count, 3)
        runner = MagicMock()
        runner.run.return_value = self.missing("DATABASE_URL")
        with self.assertRaises(auto.GuardError):
            auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), self.containers({"DATABASE_URL": "offline-value"}))
        self.assertEqual(runner.run.call_count, 2)

    def test_runtime_values_reach_only_canonical_compose_commands_and_never_logs_or_build(self):
        cfg = valid_config(Path("/tmp"))
        environment = {"DATABASE_URL": "offline-sensitive-database"}
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, b"{}", b"")

        with tempfile.TemporaryDirectory() as raw, patch.object(auto.subprocess, "run", side_effect=fake_run), ExitStack() as cleanup:
            cfg.state_dir = Path(raw) / "state"
            log = Path(raw) / "engine.log"
            runner = auto.Runner(log)
            cleanup.callback(runner.close)
            override = auto.write_image_override(cfg, {service: "sha256:" + "a" * 64 for service in auto.EXPECTED_SERVICES}, "b" * 40, current=False)
            auto.compose_json(runner, cfg, compose_env=environment)
            auto.compose_run_migrations(runner, cfg, override, environment)
            auto.compose_up(runner, cfg, override, environment)
            auto.compose_up(runner, cfg, override, environment)
            runner.run(["docker", "build", "."], env=environment, log_output=True)
            runner.run(["git", "ls-remote", "https://github.com/inftverezovsky/TData.git"], env=environment)
            for args, kwargs in calls[:4]:
                self.assertEqual(kwargs["env"]["DATABASE_URL"], environment["DATABASE_URL"])
                self.assertNotIn(environment["DATABASE_URL"], " ".join(args))
            self.assertTrue(all("DATABASE_URL" not in kwargs["env"] for _, kwargs in calls[4:]))
            with self.assertRaises(auto.GuardError):
                runner.run(["docker", "compose", "run", "web", "sh"], compose_config=cfg, env=environment)
            with self.assertRaises(auto.GuardError):
                runner.run(auto.docker_compose_base(cfg) + ["config", "--format", "json"], compose_config=cfg, env=environment, log_output=True)
            runner.close()
            self.assertNotIn(environment["DATABASE_URL"], log.read_text())

    def test_successful_initial_compose_never_adds_unrequested_runtime_values(self):
        runner = MagicMock()
        runner.run.return_value = subprocess.CompletedProcess([], 0, b'{"services":{}}', b"")
        _, environment = auto.resolve_compose_environment(runner, valid_config(Path("/tmp")), self.containers({"DATABASE_URL": "offline-value"}))
        self.assertEqual(environment, {})
        self.assertEqual(runner.run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
