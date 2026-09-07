import test from "node:test";
import assert from "node:assert/strict";
import { loadGlobalSettings, saveGlobalSettings } from "../frontend/src/services/globalSettings";
import { readCollapsedPreference, writeCollapsedPreference } from "../frontend/src/components/tline/collapseStorage";

test("global settings save rejects an expired session instead of reporting success", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Сессия истекла" }, { status: 401 }));
  await assert.rejects(saveGlobalSettings({ tablet_wtt_default_days: "14" }), /Сессия истекла/);
});

test("global settings save rejects a non-JSON server failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Upstream unavailable", { status: 502 }));
  await assert.rejects(saveGlobalSettings({ tablet_wtt_default_days: "14" }), /502/);
});

test("global settings save requires an explicit success response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false }));
  await assert.rejects(saveGlobalSettings({ tablet_wtt_default_days: "14" }));
});

test("global settings save sends JSON and accepts confirmed success", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/settings/global");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { tablet_wtt_default_days: "14" });
    return Response.json({ ok: true });
  });
  await saveGlobalSettings({ tablet_wtt_default_days: "14" });
});

test("global settings load rejects an error envelope and malformed settings", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Forbidden" }, { status: 403 }));
  await assert.rejects(loadGlobalSettings(), /Forbidden/);
  t.mock.method(globalThis, "fetch", async () => Response.json(["unexpected array"]));
  await assert.rejects(loadGlobalSettings());
});

test("global settings load returns the server values", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ tablet_wtt_default_days: "7" }));
  assert.deepEqual(await loadGlobalSettings(), { tablet_wtt_default_days: "7" });
});

test("TLine remains usable when browser storage access is denied", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get localStorage() { throw new DOMException("Blocked", "SecurityError"); } },
  });
  t.after(() => original ? Object.defineProperty(globalThis, "window", original) : Reflect.deleteProperty(globalThis, "window"));
  assert.equal(readCollapsedPreference("tline:collapsed:test"), false);
  assert.doesNotThrow(() => writeCollapsedPreference("tline:collapsed:test", true));
});

test("TLine collapse preference is persisted when storage is available", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } },
  });
  t.after(() => original ? Object.defineProperty(globalThis, "window", original) : Reflect.deleteProperty(globalThis, "window"));
  writeCollapsedPreference("tline:collapsed:test", true);
  assert.equal(readCollapsedPreference("tline:collapsed:test"), true);
  writeCollapsedPreference("tline:collapsed:test", false);
  assert.equal(readCollapsedPreference("tline:collapsed:test"), false);
});
