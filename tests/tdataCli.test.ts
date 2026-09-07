import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/tdata-cli.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("CLI help works without a database and describes deploy as an unverified checklist", () => {
  const result = runCli("help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /deploy\s+.*unverified.*checklist/i);
  assert.doesNotMatch(result.stdout, /Trigger production|latency.*all proxies/i);
});

test("CLI rejects unknown commands with a failing exit code", () => {
  const result = runCli("unknown-command");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/i);
});

test("CLI deploy cannot report successful checks that it never executed", () => {
  const result = runCli("deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /not executed|not verified/i);
  assert.match(result.stdout, /DEPLOYMENT_PORTAINER\.md/);
  assert.doesNotMatch(result.stdout, /\bPass\b|Ready for deployment|git push.*SSH/i);
});

function runCli(command: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, command], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: "" },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}
