import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { clearCacheFiles } from "../backend/src/cache/cacheMaintenance";

test("clearCacheFiles respects source and discipline scope", () => {
  const liqScoped = path.join(process.cwd(), "cache", "liquipedia", "testscope");
  const hltvScoped = path.join(process.cwd(), "cache", "hltv", "testscope");
  const fandomScoped = path.join(process.cwd(), "cache", "fandom", "testscope");
  fs.mkdirSync(liqScoped, { recursive: true });
  fs.mkdirSync(hltvScoped, { recursive: true });
  fs.mkdirSync(fandomScoped, { recursive: true });

  const liqFile = path.join(liqScoped, "one.json");
  const hltvFile = path.join(hltvScoped, "two.json");
  const fandomFile = path.join(fandomScoped, "three.json");
  fs.writeFileSync(liqFile, "{}");
  fs.writeFileSync(hltvFile, "{}");
  fs.writeFileSync(fandomFile, "{}");

  const deleted = clearCacheFiles({ source: "liquipedia", disciplineSlug: "testscope" });
  assert.equal(deleted, 1);
  assert.equal(fs.existsSync(liqFile), false);
  assert.equal(fs.existsSync(hltvFile), true);
  assert.equal(fs.existsSync(fandomFile), true);

  const fandomDeleted = clearCacheFiles({ source: "fandom", disciplineSlug: "testscope" });
  assert.equal(fandomDeleted, 1);
  assert.equal(fs.existsSync(fandomFile), false);

  fs.rmSync(path.join(process.cwd(), "cache", "liquipedia", "testscope"), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "cache", "hltv", "testscope"), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "cache", "fandom", "testscope"), { recursive: true, force: true });
});
