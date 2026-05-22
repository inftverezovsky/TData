import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { clearCacheFiles } from "../src/lib/cache/cacheMaintenance";

test("clearCacheFiles respects source and discipline scope", () => {
  const liqScoped = path.join(process.cwd(), "cache", "liquipedia", "testscope");
  const hltvScoped = path.join(process.cwd(), "cache", "hltv", "testscope");
  fs.mkdirSync(liqScoped, { recursive: true });
  fs.mkdirSync(hltvScoped, { recursive: true });

  const liqFile = path.join(liqScoped, "one.json");
  const hltvFile = path.join(hltvScoped, "two.json");
  fs.writeFileSync(liqFile, "{}");
  fs.writeFileSync(hltvFile, "{}");

  const deleted = clearCacheFiles({ source: "liquipedia", disciplineSlug: "testscope" });
  assert.equal(deleted, 1);
  assert.equal(fs.existsSync(liqFile), false);
  assert.equal(fs.existsSync(hltvFile), true);

  fs.rmSync(path.join(process.cwd(), "cache", "liquipedia", "testscope"), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "cache", "hltv", "testscope"), { recursive: true, force: true });
});
