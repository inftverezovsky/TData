#!/usr/bin/env python3
"""Однократная установка TData CD. Приватный ключ существует только в памяти и GitHub Secrets."""

import argparse
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import uuid

REPOSITORY = "inftverezovsky/TData"
DESTINATION = "root@82.147.67.231"
KEY_MARKER = "tdata-github-actions:"
SERVICES = {"web", "khl-worker", "tline-worker", "telegram-consultant"}


def validate_profile(profile):
    """В установочный payload попадает только фиксированный набор несекретных полей."""
    allowed = {
        "repository", "app_dir", "state_dir", "compose_files", "services",
        "minimum_free_bytes", "health_url", "health_timeout", "legacy_migrations",
    }
    if set(profile) != allowed:
        raise ValueError("Unexpected deployment profile fields")
    if (profile["repository"] != REPOSITORY or profile["app_dir"] != "/root/tdata"
            or profile["state_dir"] != "/root/tdata/.deploy/auto"
            or profile["health_url"] != "http://127.0.0.1:3010/api/health"):
        raise ValueError("Unexpected deployment target")
    if not isinstance(profile["services"], list) or set(profile["services"]) != SERVICES:
        raise ValueError("Unexpected application services")
    if len(profile["services"]) != len(SERVICES):
        raise ValueError("Duplicate application services")
    files = profile["compose_files"]
    if not isinstance(files, list) or not files or len(files) != len(set(files)):
        raise ValueError("Invalid Compose chain")
    for filename in files:
        path = PurePosixPath(filename)
        if (not path.is_absolute() or ".." in path.parts
                or not filename.startswith("/root/tdata/")
                or any(character in filename for character in "\n\r\0")):
            raise ValueError("Compose path escapes the canonical application")
    if not 8 * 1024**3 <= profile["minimum_free_bytes"] <= 100 * 1024**3:
        raise ValueError("Invalid disk threshold")
    if not 30 <= profile["health_timeout"] <= 600:
        raise ValueError("Invalid health deadline")
    for name, checksum in profile["legacy_migrations"].items():
        if not re.fullmatch(r"[0-9]{14}_[a-z0-9_]+", name) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
            raise ValueError("Invalid legacy migration fingerprint")
    return profile


def run(command, *, data=None):
    # Не включаем argv/stdout/stderr в ошибки: gh secret set получает приватный ключ через stdin.
    result = subprocess.run(command, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(f"{Path(command[0]).name} operation failed; sensitive output withheld")
    return result.stdout


def ssh_command(key):
    return ["ssh", "-i", str(key), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=15", DESTINATION, "python3 -"]


def remote_script(payload):
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    # Установщик передаёт только исходный код, публичный ключ и несекретный профиль.
    return ("import base64,json,os,pathlib,stat,tempfile\n"
            f"p=json.loads(base64.b64decode('{encoded}'))\n" + REMOTE_INSTALL).encode()


REMOTE_INSTALL = r'''
def regular(path):
    pth=pathlib.Path(path)
    for ancestor in (pth,*pth.parents):
        if ancestor.is_symlink(): raise RuntimeError('Symlink deployment target rejected')
        if ancestor.exists():
            metadata=ancestor.stat()
            if metadata.st_uid != 0: raise RuntimeError('Root ownership required')
            if stat.S_IMODE(metadata.st_mode)&0o022:
                raise RuntimeError('Deployment paths must not be writable by group or others')
    return pth
def write(path, text, mode):
    target=regular(path)
    with tempfile.NamedTemporaryFile(mode='w',dir=target.parent,delete=False) as handle:
        os.chmod(handle.name,mode)
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(handle.name,target)
if os.geteuid()!=0: raise RuntimeError('Root setup required')
ssh=regular('/root/.ssh')
if not ssh.is_dir(): raise RuntimeError('Existing SSH directory required')
auth=regular('/root/.ssh/authorized_keys')
lines=auth.read_text().splitlines() if auth.exists() else []
if p['action']=='install':
    root=regular('/usr/local/lib/tdata-autodeploy')
    root.mkdir(mode=0o755,exist_ok=True)
    for filename,source in p['sources'].items():
        if not filename.endswith('.py') or pathlib.Path(filename).name!=filename:
            raise RuntimeError('Invalid engine module')
        compile(source,filename,'exec')
        write(root/filename,source,0o755)
    for filename in p['config']['compose_files']:
        if not regular(filename).is_file(): raise RuntimeError('Compose file unavailable')
    write('/etc/tdata-autodeploy.json',json.dumps(p['config'],indent=2)+'\n',0o600)
    write('/usr/local/bin/tdata-autodeploy',
          '#!/bin/sh\nexec /usr/bin/python3 /usr/local/lib/tdata-autodeploy/auto_deploy.py "$@"\n',0o755)
    lines.append(p['entry'])
elif p['action']=='remove_new_key':
    lines=[line for line in lines if not line.endswith(p['marker'])]
elif p['action']=='retire_old_keys':
    lines=[line for line in lines if ' tdata-github-actions:' not in line or line.endswith(p['marker'])]
else: raise RuntimeError('Unknown setup action')
write(auth,'\n'.join(lines)+'\n',0o600)
print('TData restricted deployment setup updated.')
'''


def github_production_environment():
    policy = {"deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}}
    environments = json.loads(run(["gh", "api", f"repos/{REPOSITORY}/environments"]))["environments"]
    existing = next((environment for environment in environments if environment["name"] == "production"), None)
    endpoint = f"repos/{REPOSITORY}/environments/production/deployment-branch-policies"
    branches = []
    if existing:
        # Не сбрасываем чужих reviewers, таймеры или ограничения частично выполненным setup.
        # GitHub также отражает нашу main-only настройку как штатное правило branch_policy.
        protections = existing.get("protection_rules", [])
        unsupported_protections = not isinstance(protections, list) or any(
            not isinstance(rule, dict) or rule.get("type") != "branch_policy"
            for rule in protections
        )
        if unsupported_protections or existing.get("deployment_branch_policy") != policy["deployment_branch_policy"]:
            raise RuntimeError("Review existing production protections before configuring unattended deployment")
        branches = json.loads(run(["gh", "api", endpoint]))["branch_policies"]
    if any(branch["name"] != "main" or branch.get("type", "branch") != "branch" for branch in branches):
        raise RuntimeError("Production environment has broader branch policies; review them before installation")
    if not existing:
        run(["gh", "api", f"repos/{REPOSITORY}/environments/production", "--method", "PUT", "--input", "-"],
            data=json.dumps(policy).encode())
    if not branches:
        run(["gh", "api", endpoint, "--method", "POST", "--input", "-"],
            data=json.dumps({"name": "main", "type": "branch"}).encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True, help="Non-secret inventory profile JSON")
    parser.add_argument("--ssh-key", type=Path, default=Path.home() / ".ssh" / "codex_deploy_ed25519")
    parser.add_argument("--known-hosts", type=Path, required=True, help="Public keys already verified through SSH")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    profile = validate_profile(json.loads(args.profile.read_text(encoding="utf-8-sig")))
    source_dir = Path(__file__).resolve().parent
    modules = {file.name: file.read_text(encoding="utf-8") for file in source_dir.glob("auto_deploy*.py")}
    if "auto_deploy.py" not in modules:
        raise RuntimeError("Deployment engine is missing")
    for filename, source in modules.items():
        compile(source, filename, "exec")
    known_hosts = args.known_hosts.read_bytes()
    if not known_hosts.strip() or b"PRIVATE KEY" in known_hosts:
        raise ValueError("Pinned public host keys are required")
    if not args.apply:
        print("Plan: install a root-owned TData engine, restrict one new SSH key, configure GitHub production/main.")
        print("No private key has been generated and no external state has changed. Use --apply to install.")
        return
    if not args.ssh_key.is_file():
        raise RuntimeError("Existing operator SSH key is missing")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

    # Сначала подтверждаем доступ по уже доверенному SSH host key.
    run(ssh_command(args.ssh_key), data=b"import os; assert os.geteuid()==0; print('SSH verified')\n")
    github_production_environment()
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption())
    public = key.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).decode()
    marker = KEY_MARKER + uuid.uuid4().hex
    entry = f'restrict,command="/usr/local/bin/tdata-autodeploy" {public} {marker}'
    payload = {"action": "install", "config": profile, "sources": modules, "entry": entry, "marker": marker}
    run(ssh_command(args.ssh_key), data=remote_script(payload))
    try:
        run(["gh", "secret", "set", "TDATA_DEPLOY_KNOWN_HOSTS", "--repo", REPOSITORY, "--env", "production"],
            data=known_hosts)
        run(["gh", "secret", "set", "TDATA_DEPLOY_SSH_KEY", "--repo", REPOSITORY, "--env", "production"],
            data=private)
    except Exception:
        run(ssh_command(args.ssh_key), data=remote_script({"action": "remove_new_key", "marker": marker}))
        raise
    finally:
        del private, key
    run(ssh_command(args.ssh_key), data=remote_script({"action": "retire_old_keys", "marker": marker}))
    print("Installed: restricted TData SSH key and GitHub production/main deployment secrets.")
    print("Private key was transferred in memory and was not written to a local or server file.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Только класс исключения: никакие неожиданно отражённые секреты не попадут в журнал.
        print(f"TData setup failed ({type(error).__name__}); no sensitive subprocess output is printed.", file=sys.stderr)
        sys.exit(1)
