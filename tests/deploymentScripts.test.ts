import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const digest = `inftverezovsky/tdata-web@sha256:${"a".repeat(64)}`;
function run(script: string, args: string) {
  const path = resolve("scripts", script).replace(/'/g, "''");
  return spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command",
    `function global:docker { throw 'UNEXPECTED_DOCKER' }; function global:ssh { throw 'UNEXPECTED_SSH' }; & '${path}' ${args}`,
  ], { encoding: "utf8", timeout: 15_000 });
}

for (const [script, args] of [
  ["deploy-all.ps1", ""], ["build-and-push.ps1", ""], ["ssh-redeploy.ps1", `-Image '${digest}'`],
]) {
  test(`${script} defaults to an offline plan`, () => {
    const result = run(script, args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run/i);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_/);
  });
}
test("global pruning is rejected before any Docker or SSH call", () => {
  const result = run("deploy-all.ps1", "-Prune -Apply");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Prune has been removed/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_/);
});
test("deployment rejects mutable tags and shell metacharacters", () => {
  for (const value of ["repo:latest", `${digest};touch /tmp/unsafe`, "$(whoami)"]) {
    const result = run("ssh-redeploy.ps1", `-Image '${value}'`);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_/);
  }
});

test("resolved Compose validation refuses a legacy tag, foreign project or public port", () => {
  const source = readFileSync(resolve("scripts/deploy/remote-redeploy.sh"), "utf8");
  const validator = source.match(/--entrypoint node "\$TDATA_IMAGE" -e '([\s\S]+?)' "\$TDATA_IMAGE"/)?.[1];
  assert.ok(validator, "The reviewed deployment validator must be present");
  const config = { name: "tdata", services: {
    web: { image: digest, container_name: "tdata-web", ports: [{ host_ip: "127.0.0.1", published: "3010", target: 3010 }] },
    "tline-worker": { image: digest, container_name: "tdata-tline-worker" },
  } };
  const validate = (value: unknown) => spawnSync(process.execPath, ["-e", validator, digest], { input: JSON.stringify(value) }).status;
  assert.equal(validate(config), 0);
  assert.notEqual(validate({ ...config, name: "unrelated" }), 0);
  for (const service of ["web", "tline-worker"] as const) {
    assert.notEqual(validate({ ...config, services: { ...config.services, [service]: { ...config.services[service], image: "fixture/tdata:latest" } } }), 0);
  }
  assert.notEqual(validate({ ...config, services: { ...config.services, web: { ...config.services.web, ports: [{ host_ip: "0.0.0.0", published: "80", target: 3010 }] } } }), 0);
});
