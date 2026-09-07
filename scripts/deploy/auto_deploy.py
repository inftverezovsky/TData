#!/usr/bin/env python3
"""Restricted TData auto-deploy engine for the production host.

The forced SSH command must invoke this script and pass the original command in
SSH_ORIGINAL_COMMAND. The only mutating command accepted is:

    deploy <40-hex-git-sha>

The script prints only stages and sanitized error classes. Runtime environment,
resolved Compose config, database URLs, and secret-bearing command output are
never printed or persisted.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import uuid
import urllib.request


CONFIG_PATH = Path("/etc/tdata-autodeploy.json")
EXPECTED_PROJECT = "tdata"
EXPECTED_REPOSITORY = "inftverezovsky/TData"
EXPECTED_SERVICES = ("web", "khl-worker", "tline-worker", "telegram-consultant")
EXPECTED_CONTAINERS = {
    "web": "tdata-web",
    "khl-worker": "tdata-khl-worker",
    "tline-worker": "tdata-tline-worker",
    "telegram-consultant": "tdata-telegram-consultant",
}
POSTGRES_CONTAINER = "tdata-postgres"
REVISION_LABEL = "org.opencontainers.image.revision"
SOURCE_TARBALL_MAX_BYTES = 100 * 1024 * 1024
SOURCE_EXPANDED_MAX_BYTES = 200 * 1024 * 1024
SOURCE_MAX_FILES = 10_000
MIN_FREE_DEFAULT_BYTES = 8 * 1024 * 1024 * 1024
MIGRATION_POLICY_RELATIVE_PATH = Path("scripts/deploy/migration-policy.json")
COMMAND_RE = re.compile(r"\Adeploy ([0-9a-f]{40})\Z")
SHA_RE = re.compile(r"\A[0-9a-f]{40}\Z")
SAFE_ENV_KEYS = ("PATH", "LANG", "LC_ALL", "HOME", "TERM")
COMPOSE_ENV_DENY_RE = re.compile(r"\A(?:COMPOSE_|DOCKER_|GIT_|PYTHON|LD_|DYLD_|SSH_|XDG_)", re.I)
COMPOSE_ENV_ALLOW_RE = re.compile(r"\A[A-Z][A-Z0-9_]*\Z")
COMPOSE_ENV_CONTROL_KEYS = {*SAFE_ENV_KEYS, "ENV", "BASH_ENV", "SHELLOPTS", "CDPATH", "GCONV_PATH", "LOCPATH"}
MAX_COMPOSE_ENV_FALLBACKS = 30


class GuardError(Exception):
    """A safe, user-facing deployment refusal."""


def stage(name: str) -> None:
    print(json.dumps({"stage": name}, separators=(",", ":")), flush=True)


def fail(error_class: str) -> None:
    print(json.dumps({"error": error_class}, separators=(",", ":")), file=sys.stderr, flush=True)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mode_private(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except PermissionError as exc:
        raise GuardError("permission_error") from exc


def write_private_json(path: Path, value: object, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode_private(path.parent, 0o700)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def ensure_child(path: Path, parent: Path) -> Path:
    if not path.is_absolute() and not path.as_posix().startswith("/"):
        raise GuardError("path_not_absolute")
    try:
        resolved = path.resolve(strict=False)
        root = parent.resolve(strict=False)
    except OSError as exc:
        raise GuardError("path_resolution_failed") from exc
    if resolved == root or root not in resolved.parents:
        raise GuardError("path_escape")
    return resolved


def server_path(path: Path) -> str:
    return path.as_posix()


def parse_ssh_command(value: str | None) -> str:
    match = COMMAND_RE.fullmatch(value or "")
    if not match:
        raise GuardError("invalid_forced_command")
    return match.group(1)


class Runner:
    def __init__(self, log_path: Path | None = None):
        self.log_path = log_path
        self._log_handle = None
        self.base_env = {key: os.environ[key] for key in SAFE_ENV_KEYS if key in os.environ}
        if "PATH" not in self.base_env:
            self.base_env["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        if log_path is not None:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            mode_private(log_path.parent, 0o700)
            fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            self._log_handle = os.fdopen(fd, "ab")

    def close(self) -> None:
        if self._log_handle is not None:
            self._log_handle.close()

    def run(
        self,
        args: list[str],
        *,
        input_bytes: bytes | None = None,
        stdin_handle=None,
        capture: bool = False,
        env: dict[str, str] | None = None,
        timeout: int = 1800,
        allow_failure: bool = False,
        log_output: bool = False,
        discard: bool = False,
        compose_config: Config | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        process_env = self.safe_env(env)
        if compose_config is not None:
            # Runtime-секреты разрешены лишь точным командам Compose; сборка и утилиты их не наследуют.
            validate_compose_command(args, compose_config)
            if log_output:
                raise GuardError("compose_runtime_logging_forbidden")
            for key, value in (env or {}).items():
                validate_compose_env_key(key)
                if not isinstance(value, str) or not value.strip() or "\0" in value:
                    raise GuardError("compose_env_value_invalid")
            process_env = {**self.safe_env(), **(env or {})}
        stdout_target = subprocess.PIPE
        stderr_target = subprocess.PIPE
        stdin_target = stdin_handle
        if log_output:
            if self._log_handle is None:
                raise GuardError("log_not_configured")
            stdout_target = self._log_handle
            stderr_target = self._log_handle
        if discard:
            stdout_target = subprocess.DEVNULL
            stderr_target = subprocess.DEVNULL
        try:
            kwargs = {
                "stdout": stdout_target,
                "stderr": stderr_target,
                "env": process_env,
                "timeout": timeout,
                "check": False,
            }
            if input_bytes is not None:
                kwargs["input"] = input_bytes
            elif stdin_target is not None:
                kwargs["stdin"] = stdin_target
            result = subprocess.run(args, **kwargs)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise GuardError(f"command_unavailable:{Path(args[0]).name}") from exc
        if result.returncode and not allow_failure:
            raise GuardError(f"command_failed:{Path(args[0]).name}")
        if capture:
            return result
        return result

    def safe_env(self, env: dict[str, str] | None = None) -> dict[str, str]:
        clean = dict(self.base_env)
        if env:
            for key, value in env.items():
                if key in SAFE_ENV_KEYS:
                    clean[key] = value
        return clean

    def text(self, args: list[str], **kwargs: object) -> str:
        return self.run(args, capture=True, **kwargs).stdout.decode("utf-8", "replace").strip()

    def json(self, args: list[str], **kwargs: object) -> object:
        text = self.text(args, **kwargs)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise GuardError(f"invalid_json:{Path(args[0]).name}") from exc


class Config:
    def __init__(self, raw: dict[str, object]):
        self.raw = raw
        self.app_dir = Path(self._string("app_dir"))
        self.repository = self._string("repository")
        self.compose_files = [Path(value) for value in self._string_list("compose_files")]
        self.services = tuple(self._string_list("services"))
        self.state_dir = Path(self._string("state_dir"))
        self.health_url = str(raw.get("health_url") or "http://127.0.0.1:3010/api/health")
        self.health_timeout = int(raw.get("health_timeout") or 180)
        self.min_free_bytes = int(
            raw.get("minimum_free_bytes") or raw.get("min_free_bytes") or raw.get("min_free") or MIN_FREE_DEFAULT_BYTES
        )
        self.legacy_migrations = dict(raw.get("legacy_migrations") or {})
        if "min_free_gib" in raw:
            self.min_free_bytes = int(float(raw["min_free_gib"]) * 1024 * 1024 * 1024)
        self.validate()

    def _string(self, name: str) -> str:
        value = self.raw.get(name)
        if not isinstance(value, str) or not value:
            raise GuardError(f"config_missing:{name}")
        return value

    def _string_list(self, name: str) -> list[str]:
        value = self.raw.get(name)
        if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
            raise GuardError(f"config_missing:{name}")
        return list(value)

    def validate(self) -> None:
        if self.repository != EXPECTED_REPOSITORY:
            raise GuardError("unexpected_repository")
        if self.app_dir != Path("/root/tdata"):
            raise GuardError("unexpected_app_dir")
        if self.services != EXPECTED_SERVICES:
            raise GuardError("unexpected_services")
        if self.min_free_bytes < MIN_FREE_DEFAULT_BYTES:
            raise GuardError("min_free_too_low")
        if self.health_url != "http://127.0.0.1:3010/api/health":
            raise GuardError("unexpected_health_url")
        if self.health_timeout < 30 or self.health_timeout > 600:
            raise GuardError("unexpected_health_timeout")
        ensure_child(self.state_dir, self.app_dir)
        for compose_file in self.compose_files:
            ensure_child(compose_file, self.app_dir)
        if any(not re.fullmatch(r"[A-Za-z0-9_./-]+", key) for key in self.legacy_migrations):
            raise GuardError("invalid_legacy_migration_name")
        if any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in self.legacy_migrations.values()):
            raise GuardError("invalid_legacy_migration_hash")


def load_config(path: Path = CONFIG_PATH) -> Config:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise GuardError("config_unreadable") from exc
    except json.JSONDecodeError as exc:
        raise GuardError("config_invalid_json") from exc
    if not isinstance(raw, dict):
        raise GuardError("config_invalid")
    return Config(raw)


def git_remote_main_sha(runner: Runner, repository: str) -> str:
    url = f"https://github.com/{repository}.git"
    output = runner.text(["git", "ls-remote", "--heads", url, "refs/heads/main"], timeout=60)
    parts = output.split()
    if len(parts) != 2 or parts[1] != "refs/heads/main" or not SHA_RE.fullmatch(parts[0]):
        raise GuardError("github_main_unverified")
    return parts[0]


def require_current_main(runner: Runner, config: Config, sha: str) -> None:
    if git_remote_main_sha(runner, config.repository) != sha:
        raise GuardError("sha_is_not_current_main")


def docker_compose_base(config: Config) -> list[str]:
    args = ["docker", "compose", "--project-directory", server_path(config.app_dir), "-p", EXPECTED_PROJECT]
    for compose_file in config.compose_files:
        args.extend(["-f", server_path(compose_file)])
    return args


def validate_compose_command(args: list[str], config: Config) -> None:
    base = docker_compose_base(config)
    if args[:len(base)] != base:
        raise GuardError("noncanonical_compose_command")
    operation = args[len(base):]
    if operation[:1] == ["-f"]:
        if len(operation) < 2:
            raise GuardError("noncanonical_compose_command")
        override = Path(operation[1])
        ensure_child(override, config.state_dir)
        current = config.state_dir / "current-image.override.json"
        candidate = override.parent == config.state_dir / "candidates" and re.fullmatch(
            r"image-[a-f0-9]{32}\.override\.json", override.name)
        if override != current and not candidate:
            raise GuardError("noncanonical_compose_override")
        operation = operation[2:]
    allowed = [
        ["config", "--format", "json"],
        ["up", "-d", "--no-deps", "--no-build", "--force-recreate", *EXPECTED_SERVICES],
        ["run", "--rm", "--no-deps", "--entrypoint", "npm", "web", "run", "db:migrate:deploy"],
    ]
    if operation not in allowed:
        raise GuardError("noncanonical_compose_command")


def compose_json(
    runner: Runner,
    config: Config,
    extra_files: list[Path] | None = None,
    compose_env: dict[str, str] | None = None,
) -> dict[str, object]:
    args = docker_compose_base(config)
    for compose_file in extra_files or []:
        args.extend(["-f", str(compose_file)])
    value = runner.json(args + ["config", "--format", "json"], env=compose_env, compose_config=config)
    if not isinstance(value, dict):
        raise GuardError("compose_config_invalid")
    return value


def validate_resolved_compose(config: Config, resolved: dict[str, object]) -> None:
    if resolved.get("name") != EXPECTED_PROJECT:
        raise GuardError("compose_project_mismatch")
    services = resolved.get("services")
    if not isinstance(services, dict):
        raise GuardError("compose_services_invalid")
    required = {"postgres", *config.services}
    if not required <= set(services):
        raise GuardError("compose_required_services_missing")
    for service in config.services:
        service_config = services[service]
        if not isinstance(service_config, dict):
            raise GuardError("compose_service_invalid")
        if service_config.get("container_name") != EXPECTED_CONTAINERS[service]:
            raise GuardError("compose_container_name_mismatch")
        if service != "web" and service_config.get("ports"):
            raise GuardError("compose_worker_ports_forbidden")
    postgres = services["postgres"]
    if not isinstance(postgres, dict) or postgres.get("container_name") != POSTGRES_CONTAINER:
        raise GuardError("compose_container_name_mismatch")
    assert_compose_exact_port(services["web"], "127.0.0.1", "3010", 3010)
    assert_compose_exact_port(services["postgres"], "127.0.0.1", "5434", 5432)


def assert_compose_exact_port(service: object, host_ip: str, published: str, target: int) -> None:
    if not isinstance(service, dict):
        raise GuardError("compose_service_invalid")
    ports = service.get("ports")
    if not isinstance(ports, list) or len(ports) != 1:
        raise GuardError("compose_port_missing")
    item = ports[0]
    if isinstance(item, dict):
        try:
            actual_target = int(item.get("target"))
        except (TypeError, ValueError):
            actual_target = -1
        if item.get("host_ip") == host_ip and str(item.get("published")) == published and actual_target == target:
            return
    elif isinstance(item, str) and item == f"{host_ip}:{published}:{target}":
        return
    raise GuardError("compose_port_mismatch")


def validate_compose_override(base: dict[str, object], changed: dict[str, object], sha: str) -> None:
    base_services = base.get("services")
    changed_services = changed.get("services")
    if not isinstance(base_services, dict) or not isinstance(changed_services, dict):
        raise GuardError("compose_services_invalid")
    if set(base_services) != set(changed_services):
        raise GuardError("compose_services_changed")
    for name, before in base_services.items():
        after = changed_services[name]
        if name not in EXPECTED_SERVICES:
            if after != before:
                raise GuardError("compose_unselected_service_changed")
            continue
        if not isinstance(before, dict) or not isinstance(after, dict):
            raise GuardError("compose_service_invalid")
        before_clean = {key: value for key, value in before.items() if key not in {"image", "environment"}}
        after_clean = {key: value for key, value in after.items() if key not in {"image", "environment"}}
        if before_clean != after_clean:
            raise GuardError("compose_selected_service_shape_changed")
        before_env = before.get("environment") or {}
        after_env = after.get("environment") or {}
        if not isinstance(before_env, dict) or not isinstance(after_env, dict):
            raise GuardError("compose_environment_invalid")
        allowed_env = dict(before_env)
        allowed_env["TDATA_GIT_SHA"] = sha
        if after_env != allowed_env:
            raise GuardError("compose_environment_changed")


def parse_docker_ps_json(lines: str) -> list[dict[str, object]]:
    rows = []
    for line in lines.splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise GuardError("docker_ps_invalid")
        rows.append(value)
    return rows


def inspect_containers(runner: Runner) -> dict[str, dict[str, object]]:
    ids = runner.text(["docker", "ps", "-aq"]).split()
    if not ids:
        raise GuardError("no_containers")
    value = runner.json(["docker", "inspect", *ids])
    if not isinstance(value, list):
        raise GuardError("docker_inspect_invalid")
    containers = {}
    for item in value:
        if not isinstance(item, dict):
            raise GuardError("docker_inspect_invalid")
        name = str(item.get("Name", "")).lstrip("/")
        containers[name] = item
    return containers


def validate_compose_env_key(key: str) -> None:
    if (not COMPOSE_ENV_ALLOW_RE.fullmatch(key) or COMPOSE_ENV_DENY_RE.match(key)
            or key in COMPOSE_ENV_CONTROL_KEYS):
        raise GuardError("compose_env_key_forbidden")


def agreed_compose_env_value(containers: dict[str, dict[str, object]], key: str) -> str:
    validate_compose_env_key(key)
    values = set()
    selected = [*EXPECTED_CONTAINERS.values(), POSTGRES_CONTAINER]
    for name in selected:
        container = containers.get(name)
        if not container:
            raise GuardError("compose_env_container_missing")
        if not isinstance(container.get("State"), dict) or container["State"].get("Running") is not True:
            raise GuardError("compose_env_container_not_running")
        config = container.get("Config")
        pairs = config.get("Env") if isinstance(config, dict) else []
        if not isinstance(pairs, list):
            raise GuardError("compose_env_invalid")
        for pair in pairs:
            if not isinstance(pair, str) or "=" not in pair:
                continue
            pair_key, value = pair.split("=", 1)
            if pair_key == key:
                if not value.strip() or "\0" in value:
                    raise GuardError("compose_env_value_missing")
                values.add(value)
    if not values:
        raise GuardError("compose_env_value_missing")
    if len(values) != 1:
        raise GuardError("compose_env_value_conflict")
    return next(iter(values))


def resolve_compose_environment(
    runner: Runner, config: Config, containers: dict[str, dict[str, object]],
) -> tuple[dict[str, object], dict[str, str]]:
    # Только readonly config может запросить fallback. Никакую мутацию после ошибки не повторяем.
    environment: dict[str, str] = {}
    while True:
        result = runner.run(
            docker_compose_base(config) + ["config", "--format", "json"],
            env=environment, compose_config=config, allow_failure=True, capture=True, timeout=60,
        )
        if result.returncode == 0:
            try:
                resolved = json.loads(result.stdout)
            except (ValueError, TypeError):
                raise GuardError("compose_config_invalid") from None
            if not isinstance(resolved, dict):
                raise GuardError("compose_config_invalid")
            return resolved, dict(environment)
        # stderr остаётся в памяти; наружу попадает только фиксированный класс отказа.
        missing = set(re.findall(r"required variable ([A-Z][A-Z0-9_]*)", result.stderr.decode("utf-8", "replace")))
        if len(missing) != 1 or len(environment) >= MAX_COMPOSE_ENV_FALLBACKS:
            raise GuardError("compose_environment_unresolved")
        key = next(iter(missing))
        if key in environment:
            raise GuardError("compose_environment_unresolved")
        environment = {**environment, key: agreed_compose_env_value(containers, key)}


def container_labels(container: dict[str, object]) -> dict[str, str]:
    config = container.get("Config")
    if not isinstance(config, dict):
        return {}
    labels = config.get("Labels") or {}
    if not isinstance(labels, dict):
        return {}
    return {str(key): str(value) for key, value in labels.items()}


def validate_container_ownership(config: Config, containers: dict[str, dict[str, object]]) -> None:
    expected = {POSTGRES_CONTAINER, *EXPECTED_CONTAINERS.values()}
    if not expected <= set(containers):
        raise GuardError("canonical_containers_missing")
    for service, name in EXPECTED_CONTAINERS.items():
        labels = container_labels(containers[name])
        if labels.get("com.docker.compose.project") != EXPECTED_PROJECT:
            raise GuardError("service_project_mismatch")
        if labels.get("com.docker.compose.service") != service:
            raise GuardError("service_name_mismatch")
        if labels.get("com.docker.compose.project.working_dir") != server_path(config.app_dir):
            raise GuardError("service_dir_mismatch")
    labels = container_labels(containers[POSTGRES_CONTAINER])
    if labels.get("com.docker.compose.project") != EXPECTED_PROJECT:
        raise GuardError("postgres_project_mismatch")
    if labels.get("com.docker.compose.project.working_dir") != server_path(config.app_dir):
        raise GuardError("postgres_dir_mismatch")
    assert_port(containers["tdata-web"], "3010/tcp", "127.0.0.1", "3010")
    assert_port(containers[POSTGRES_CONTAINER], "5432/tcp", "127.0.0.1", "5434")


def assert_port(container: dict[str, object], port: str, host_ip: str, host_port: str) -> None:
    host_config = container.get("HostConfig")
    bindings = host_config.get("PortBindings") if isinstance(host_config, dict) else None
    actual = bindings.get(port) if isinstance(bindings, dict) else None
    if not isinstance(actual, list) or len(actual) != 1:
        raise GuardError("port_binding_mismatch")
    binding = actual[0]
    if not isinstance(binding, dict) or binding.get("HostIp") != host_ip or binding.get("HostPort") != host_port:
        raise GuardError("port_binding_mismatch")


def free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def collect_inventory(
    runner: Runner,
    config: Config,
) -> tuple[dict[str, object], dict[str, dict[str, object]], dict[str, object], dict[str, str]]:
    containers = inspect_containers(runner)
    validate_container_ownership(config, containers)
    resolved, compose_env = resolve_compose_environment(runner, config, containers)
    validate_resolved_compose(config, resolved)
    inventory = {
        "containerNames": sorted(containers),
        "selectedServices": list(config.services),
        "composeFiles": [server_path(path) for path in config.compose_files],
        "composeProjects": runner.json(["docker", "compose", "ls", "--format", "json"]),
        "listeningPorts": runner.text(["ss", "-ltn"], timeout=30),
        "appDir": runner.text(["stat", "-c", "%A %U %G %n", server_path(config.app_dir)], timeout=30),
        "freeBytes": free_bytes(config.app_dir),
    }
    if inventory["freeBytes"] < config.min_free_bytes:
        raise GuardError("insufficient_free_space")
    return inventory, containers, resolved, compose_env


def safe_tar_members(path: Path) -> list[tarfile.TarInfo]:
    members = []
    total = 0
    seen = set()
    count = 0
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            count += 1
            if count > SOURCE_MAX_FILES:
                raise GuardError("tar_too_many_files")
            if member.isdir():
                continue
            if not member.isfile():
                raise GuardError("tar_special_member")
            pure = PurePosixPath(member.name)
            if pure.is_absolute() or ".." in pure.parts or len(pure.parts) < 2:
                raise GuardError("tar_path_escape")
            relative = PurePosixPath(*pure.parts[1:])
            if relative in seen:
                raise GuardError("tar_duplicate_path")
            seen.add(relative)
            total += member.size
            if total > SOURCE_EXPANDED_MAX_BYTES:
                raise GuardError("tar_expanded_too_large")
            members.append(member)
    return members


def safe_extract_tarball(path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    members = safe_tar_members(path)
    with tarfile.open(path, "r:gz") as archive:
        for member in members:
            relative = Path(*PurePosixPath(member.name).parts[1:])
            target = ensure_child(destination / relative, destination)
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise GuardError("tar_extract_failed")
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                shutil.copyfileobj(source, handle)
            if member.mode & stat.S_IXUSR:
                mode_private(target, 0o700)


def download_source_archive(runner: Runner, config: Config, sha: str, target: Path) -> None:
    url = f"https://codeload.github.com/{config.repository}/tar.gz/{sha}"
    runner.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--max-filesize",
            str(SOURCE_TARBALL_MAX_BYTES),
            "--output",
            str(target),
            url,
        ],
        timeout=180,
        log_output=True,
    )
    if target.stat().st_size > SOURCE_TARBALL_MAX_BYTES:
        raise GuardError("source_archive_too_large")


def load_migration_policy(source_dir: Path) -> dict[str, dict[str, str]]:
    path = source_dir / MIGRATION_POLICY_RELATIVE_PATH
    if not path.is_file():
        return {"pending": {}, "legacy": {}}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise GuardError("migration_policy_invalid")
    if raw.get("version") != 1:
        raise GuardError("migration_policy_version_invalid")
    pending = raw.get("backward_compatible") or raw.get("pending") or raw.get("allowed_pending_migrations") or {}
    legacy = raw.get("legacy") or raw.get("legacy_migrations") or {}
    if not isinstance(pending, dict) or not isinstance(legacy, dict):
        raise GuardError("migration_policy_invalid")
    policy = {"pending": {str(k): str(v) for k, v in pending.items()}, "legacy": {str(k): str(v) for k, v in legacy.items()}}
    for mapping in policy.values():
        if any(not re.fullmatch(r"[A-Za-z0-9_./-]+", key) for key in mapping):
            raise GuardError("migration_policy_name_invalid")
        if any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in mapping.values()):
            raise GuardError("migration_policy_hash_invalid")
    return policy


def source_migrations(source_dir: Path) -> dict[str, str]:
    root = source_dir / "backend" / "prisma" / "migrations"
    if not root.is_dir():
        raise GuardError("migrations_missing")
    result = {}
    for sql in sorted(root.glob("*/migration.sql")):
        result[sql.parent.name] = sha256_file(sql)
    return result


def migration_rows(runner: Runner) -> list[dict[str, object]]:
    sql = (
        "SELECT coalesce(json_agg(json_build_object("
        "'name', migration_name, 'checksum', checksum, 'finished', finished_at IS NOT NULL, "
        "'rolledBack', rolled_back_at IS NOT NULL) ORDER BY migration_name), '[]'::json) "
        'FROM "_prisma_migrations";'
    )
    output = runner.text(
        [
            "docker",
            "exec",
            "-i",
            POSTGRES_CONTAINER,
            "sh",
            "-c",
            'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At',
        ],
        input_bytes=sql.encode("utf-8"),
        timeout=60,
    )
    value = json.loads(output or "[]")
    if not isinstance(value, list):
        raise GuardError("migration_rows_invalid")
    return value


def validate_migrations(
    rows: list[dict[str, object]],
    source: dict[str, str],
    policy: dict[str, dict[str, str]],
    legacy_migrations: dict[str, str],
) -> dict[str, object]:
    applied = {}
    failed = []
    for row in rows:
        name = str(row.get("name"))
        checksum = str(row.get("checksum"))
        if row.get("rolledBack"):
            continue
        if row.get("rolled_back"):
            continue
        if not row.get("finished"):
            failed.append(name)
            continue
        applied[name] = checksum
    if failed:
        raise GuardError("failed_migrations_block_deploy")
    known_legacy = {**legacy_migrations, **policy["legacy"]}
    for name, checksum in applied.items():
        if name in source:
            if source[name] != checksum:
                raise GuardError("applied_migration_checksum_mismatch")
        elif known_legacy.get(name) != checksum:
            raise GuardError("applied_migration_unknown")
    pending = {name: checksum for name, checksum in source.items() if name not in applied}
    for name, checksum in pending.items():
        if policy["pending"].get(name) != checksum:
            raise GuardError("pending_migration_without_policy")
    return {
        "applied": [{"name": name, "checksum": checksum} for name, checksum in sorted(applied.items())],
        "pending": [{"name": name, "checksum": checksum} for name, checksum in sorted(pending.items())],
    }


def build_image(runner: Runner, source_dir: Path, sha: str) -> tuple[str, str]:
    tag = f"tdata-ci:{sha}"
    runner.run(
        [
            "docker",
            "build",
            "--build-arg",
            f"TDATA_GIT_SHA={sha}",
            "--label",
            f"{REVISION_LABEL}={sha}",
            "-t",
            tag,
            str(source_dir),
        ],
        timeout=3600,
        log_output=True,
    )
    value = runner.json(["docker", "image", "inspect", tag])
    if not isinstance(value, list) or not value:
        raise GuardError("image_inspect_failed")
    image = value[0]
    image_id = str(image.get("Id", ""))
    labels = ((image.get("Config") or {}).get("Labels") or {}) if isinstance(image.get("Config"), dict) else {}
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise GuardError("image_id_invalid")
    if labels.get(REVISION_LABEL) != sha:
        raise GuardError("image_revision_label_mismatch")
    return tag, image_id


def service_image_ids(containers: dict[str, dict[str, object]]) -> dict[str, str]:
    return {service: str(containers[EXPECTED_CONTAINERS[service]].get("Image")) for service in EXPECTED_SERVICES}


def service_revisions(containers: dict[str, dict[str, object]], default: str = "") -> dict[str, str]:
    revisions = {}
    for service in EXPECTED_SERVICES:
        container = containers[EXPECTED_CONTAINERS[service]]
        config = container.get("Config")
        env = config.get("Env") if isinstance(config, dict) else []
        value = ""
        if isinstance(env, list):
            for pair in env:
                if isinstance(pair, str) and pair.startswith("TDATA_GIT_SHA="):
                    value = pair.split("=", 1)[1]
                    break
        revisions[service] = value if SHA_RE.fullmatch(value) else default
    return revisions


def image_override_payload(images: dict[str, str], revisions: dict[str, str] | str) -> dict[str, object]:
    if isinstance(revisions, str):
        revisions = {service: revisions for service in EXPECTED_SERVICES}
    services = {
        service: {"image": images[service], "environment": {"TDATA_GIT_SHA": revisions.get(service, "")}}
        for service in EXPECTED_SERVICES
    }
    return {"services": services}


def write_image_override(config: Config, images: dict[str, str], revisions: dict[str, str] | str, *, current: bool) -> Path:
    if current:
        path = config.state_dir / "current-image.override.json"
    else:
        path = config.state_dir / "candidates" / f"image-{uuid.uuid4().hex}.override.json"
    write_private_json(path, image_override_payload(images, revisions))
    return path


def compose_up(runner: Runner, config: Config, override: Path, compose_env: dict[str, str]) -> None:
    args = docker_compose_base(config) + ["-f", str(override), "up", "-d", "--no-deps", "--no-build", "--force-recreate"]
    args.extend(EXPECTED_SERVICES)
    runner.run(args, timeout=600, discard=True, env=compose_env, compose_config=config)


def compose_run_migrations(runner: Runner, config: Config, override: Path, compose_env: dict[str, str]) -> None:
    args = docker_compose_base(config) + [
        "-f",
        str(override),
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "npm",
        "web",
        "run",
        "db:migrate:deploy",
    ]
    runner.run(args, timeout=600, discard=True, env=compose_env, compose_config=config)


def backup_database(runner: Runner, config: Config, sha: str) -> Path:
    backup_dir = config.state_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    mode_private(backup_dir, 0o700)
    path = backup_dir / f"{int(time.time())}-{sha}.dump"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            subprocess.run(
                [
                    "docker",
                    "exec",
                    POSTGRES_CONTAINER,
                    "sh",
                    "-c",
                    'exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                ],
                stdout=handle,
                stderr=subprocess.PIPE,
                timeout=600,
                check=True,
                env=runner.safe_env(),
            )
    except (OSError, subprocess.SubprocessError) as exc:
        raise GuardError("database_backup_failed") from exc
    if path.stat().st_size <= 0:
        raise GuardError("database_backup_empty")
    with path.open("rb") as handle:
        runner.run(
            ["docker", "exec", "-i", POSTGRES_CONTAINER, "pg_restore", "--list"],
            stdin_handle=handle,
            timeout=120,
            discard=True,
        )
    with path.open("rb") as handle:
        runner.run(
            ["docker", "exec", "-i", POSTGRES_CONTAINER, "pg_restore", "--file=/dev/null"],
            stdin_handle=handle,
            timeout=120,
            discard=True,
        )
    return path


def health_ok(sha: str, url: str = "http://127.0.0.1:3010/api/health") -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status != 200:
                return False
            body = json.loads(response.read().decode("utf-8"))
    except Exception:
        return False
    return body.get("ok") is True and (body.get("build") or {}).get("sourceRevision") == sha


def health_ok_any_revision(url: str = "http://127.0.0.1:3010/api/health") -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status != 200:
                return False
            body = json.loads(response.read().decode("utf-8"))
    except Exception:
        return False
    return body.get("ok") is True


def wait_until(predicate, *, timeout: int, error: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(3)
    raise GuardError(error)


def validate_recreated_services(runner: Runner, sha: str, expected_image_id: str) -> None:
    containers = inspect_containers(runner)
    for service in EXPECTED_SERVICES:
        container = containers.get(EXPECTED_CONTAINERS[service])
        if not container:
            raise GuardError("service_missing_after_deploy")
        if container.get("Image") != expected_image_id:
            raise GuardError("service_image_mismatch")
        state_value = container.get("State")
        if not isinstance(state_value, dict) or state_value.get("Running") is not True:
            raise GuardError("service_not_running")
        health = state_value.get("Health")
        if isinstance(health, dict) and health.get("Status") == "unhealthy":
            raise GuardError("service_unhealthy")
    value = runner.json(["docker", "image", "inspect", expected_image_id])
    image = value[0] if isinstance(value, list) and value else {}
    labels = ((image.get("Config") or {}).get("Labels") or {}) if isinstance(image.get("Config"), dict) else {}
    if labels.get(REVISION_LABEL) != sha:
        raise GuardError("deployed_revision_label_mismatch")


def validate_service_images_running(runner: Runner, expected_images: dict[str, str]) -> None:
    containers = inspect_containers(runner)
    for service, image_id in expected_images.items():
        container = containers.get(EXPECTED_CONTAINERS[service])
        if not container:
            raise GuardError("rollback_service_missing")
        if container.get("Image") != image_id:
            raise GuardError("rollback_image_mismatch")
        state_value = container.get("State")
        if not isinstance(state_value, dict) or state_value.get("Running") is not True:
            raise GuardError("rollback_service_not_running")
        health = state_value.get("Health")
        if isinstance(health, dict) and health.get("Status") == "unhealthy":
            raise GuardError("rollback_service_unhealthy")


def cleanup_builds(config: Config) -> None:
    builds = config.state_dir / "builds"
    if not builds.exists():
        return
    owned = []
    for child in builds.iterdir():
        marker = child / ".tdata-autodeploy-build"
        if child.is_symlink():
            continue
        if child.is_dir() and marker.is_file() and ensure_child(child, builds) and SHA_RE.fullmatch(marker.read_text().strip()):
            owned.append(child)
    owned.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    for child in owned[2:]:
        shutil.rmtree(child)


@contextlib.contextmanager
def deploy_lock(config: Config):
    config.state_dir.mkdir(parents=True, exist_ok=True)
    mode_private(config.state_dir, 0o700)
    lock_path = config.state_dir / "deploy.lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        if os.name == "posix":
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except BlockingIOError as exc:
        raise GuardError("deployment_already_running") from exc
    finally:
        os.close(fd)


def prepare_source(runner: Runner, config: Config, sha: str, run_id: str) -> Path:
    build_root = config.state_dir / "builds" / f"{sha}-{run_id}"
    ensure_child(build_root, config.state_dir / "builds")
    build_root.mkdir(parents=True, exist_ok=False)
    mode_private(build_root, 0o700)
    (build_root / ".tdata-autodeploy-build").write_text(sha, encoding="utf-8")
    mode_private(build_root / ".tdata-autodeploy-build", 0o600)
    archive = build_root / "source.tar.gz"
    source_dir = build_root / "source"
    download_source_archive(runner, config, sha, archive)
    safe_extract_tarball(archive, source_dir)
    return source_dir


def write_receipt(
    config: Config,
    sha: str,
    old_images: dict[str, str],
    new_image_tag: str,
    new_image_id: str,
    backup_path: Path,
    migration_state: dict[str, object],
) -> None:
    receipt = {
        "repository": config.repository,
        "sha": sha,
        "oldImages": old_images,
        "newImage": {"tag": new_image_tag, "id": new_image_id},
        "databaseBackup": str(backup_path),
        "migrationState": migration_state,
        "services": list(config.services),
        "createdAtUnix": int(time.time()),
    }
    receipts = config.state_dir / "receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    mode_private(receipts, 0o700)
    write_private_json(receipts / f"{sha}-{int(time.time())}.json", receipt)


def deploy(config: Config, sha: str) -> None:
    run_id = uuid.uuid4().hex
    log_path = config.state_dir / "logs" / f"{int(time.time())}-{sha}-{run_id}.log"
    runner = Runner(log_path)
    try:
        with deploy_lock(config):
            stage("inventory")
            inventory, containers, _resolved, compose_env = collect_inventory(runner, config)
            old_images = service_image_ids(containers)
            old_revisions = service_revisions(containers)
            stage("verify-main")
            require_current_main(runner, config, sha)
            stage("source")
            source_dir = prepare_source(runner, config, sha, run_id)
            source_hashes = source_migrations(source_dir)
            policy = load_migration_policy(source_dir)
            stage("build")
            image_tag, image_id = build_image(runner, source_dir, sha)
            new_images = {service: image_id for service in EXPECTED_SERVICES}
            override = write_image_override(config, new_images, sha, current=False)
            validate_compose_override(_resolved, compose_json(runner, config, [override], compose_env=compose_env), sha)
            stage("backup")
            backup_path = backup_database(runner, config, sha)
            rows = migration_rows(runner)
            migration_state = validate_migrations(rows, source_hashes, policy, config.legacy_migrations)
            stage("recheck-main")
            require_current_main(runner, config, sha)
            stage("migrate")
            compose_run_migrations(runner, config, override, compose_env)
            migration_rows_after = migration_rows(runner)
            migration_state_after = validate_migrations(migration_rows_after, source_hashes, policy, config.legacy_migrations)
            if migration_state_after["pending"]:
                raise GuardError("migration_not_applied")
            stage("activate")
            require_current_main(runner, config, sha)
            try:
                compose_up(runner, config, override, compose_env)
                wait_until(lambda: health_ok(sha, config.health_url), timeout=config.health_timeout, error="health_timeout")
                validate_recreated_services(runner, sha, image_id)
            except Exception:
                stage("rollback")
                rollback_override = write_image_override(config, old_images, old_revisions, current=False)
                compose_up(runner, config, rollback_override, compose_env)
                wait_until(
                    lambda: health_ok_any_revision(config.health_url),
                    timeout=config.health_timeout,
                    error="rollback_health_timeout",
                )
                validate_service_images_running(runner, old_images)
                write_image_override(config, old_images, old_revisions, current=True)
                raise GuardError("activation_failed_rollback_attempted") from None
            write_image_override(config, new_images, sha, current=True)
            write_receipt(config, sha, old_images, image_tag, image_id, backup_path, migration_state)
            cleanup_builds(config)
            stage("complete")
    finally:
        runner.close()


def inspect(config: Config) -> None:
    runner = Runner()
    try:
        stage("inspect")
        inventory, _containers, _resolved, _compose_env = collect_inventory(runner, config)
        safe = {
            "appDir": str(config.app_dir),
            "repository": config.repository,
            "composeFiles": [str(path) for path in config.compose_files],
            "services": list(config.services),
            "stateDir": str(config.state_dir),
            "minFreeBytes": config.min_free_bytes,
            "healthUrl": config.health_url,
            "healthTimeout": config.health_timeout,
            "freeBytes": inventory["freeBytes"],
        }
        print(json.dumps({"inspect": safe}, indent=2, sort_keys=True), flush=True)
    finally:
        runner.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Restricted TData auto-deploy entrypoint")
    parser.add_argument("--config", default=str(CONFIG_PATH))
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args(argv)
    config = load_config(Path(args.config))
    if args.inspect:
        inspect(config)
        return 0
    sha = parse_ssh_command(os.environ.get("SSH_ORIGINAL_COMMAND"))
    deploy(config, sha)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GuardError as exc:
        fail(str(exc).split(":", 1)[0])
        raise SystemExit(1)
    except Exception:
        fail("unexpected_error")
        raise SystemExit(1)
