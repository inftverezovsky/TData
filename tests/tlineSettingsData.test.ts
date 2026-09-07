import assert from "node:assert/strict";
import test from "node:test";
import { loadSports, loadChampionships, loadGlobalHeaders, loadMappings, loadSchedule } from "../frontend/src/components/tline/settings/settingsData";

test("TLine rejects malformed catalog responses instead of showing an empty success", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: { unexpected: true } }));
  for (const load of [loadSports, loadChampionships, loadGlobalHeaders, loadMappings, loadSchedule]) {
    await assert.rejects(load("http://localhost/fixture"), /Некорректный ответ/);
  }
});
test("TLine normalizes compatible catalog envelopes and ignores invalid records", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: { sports: [null, {}, { id: "v", name: "Волейбол", autoPeriodFromOffsetMinutes: 0 }] } }));
  const result = await loadSports("http://localhost/fixture");
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "v");
  assert.equal(result[0].autoPeriodFromOffsetMinutes, 0);
});
