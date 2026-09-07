import assert from "node:assert/strict";
import test from "node:test";
import { prepareGlobalSettingEntries } from "../backend/src/settings/globalSettings";
import { verifyPasswordHash } from "../backend/src/auth/passwordHash";

test("global settings save hashes the admin password while preserving integration values", async () => {
  const rows = await prepareGlobalSettingEntries({ admin_password: "new-test-password", api_url: "https://example.test/api" });
  assert.equal(rows[1].value, "https://example.test/api");
  assert.notEqual(rows[0].value, "new-test-password");
  assert.equal(await verifyPasswordHash("new-test-password", rows[0].value), true);
});

test("empty secret fields preserve existing values and invalid settings fail before writes", async () => {
  assert.deepEqual(await prepareGlobalSettingEntries({ admin_password: "", api_token: "" }), []);
  for (const input of [null, [], "text", { constructor: "value" }, { key: { nested: true } },
    { key: "x".repeat(65537) }, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`key${i}`, "value"]))]) {
    await assert.rejects(prepareGlobalSettingEntries(input), /настро/i);
  }
});
