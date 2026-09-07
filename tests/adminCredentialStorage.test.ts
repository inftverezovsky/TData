import assert from "node:assert/strict";
import test from "node:test";
import { hashAdminPassword, verifyPasswordHash } from "../backend/src/auth/passwordHash";
import { readAdminCredential, verifyAdminCredential, type AdminCredentialStore } from "../backend/src/auth/credentials";

test("scrypt hashes are salted, verify the original password and reject tampering", async () => {
  const password = "synthetic-admin-password";
  const first = await hashAdminPassword(password);
  const second = await hashAdminPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPasswordHash(password, first), true);
  assert.equal(await verifyPasswordHash("incorrect", first), false);
  assert.equal(await verifyPasswordHash(password, first.replace("$131072$", "$999999999$")), false);
  assert.equal(await verifyPasswordHash(password, "scrypt$invalid"), false);
});

test("a successful legacy login replaces plaintext with a hash using compare-and-set", async () => {
  let stored = "legacy-test-password";
  const store: AdminCredentialStore = {
    read: async () => stored,
    replaceLegacy: async (expected, next) => {
      if (stored !== expected) return false;
      stored = next;
      return true;
    },
  };
  assert.equal(await verifyAdminCredential("incorrect", store, { NODE_ENV: "production" }), null);
  assert.equal(stored, "legacy-test-password");
  const authenticated = await verifyAdminCredential("legacy-test-password", store, { NODE_ENV: "production" });
  assert.ok(authenticated);
  assert.match(stored, /^scrypt\$/);
  assert.equal(authenticated.sessionBinding, stored);
  assert.ok(await verifyAdminCredential("legacy-test-password", store, { NODE_ENV: "production" }));
});

test("legacy migration cannot overwrite or authenticate over a concurrent password rotation", async () => {
  let stored = "legacy-test-password";
  const store: AdminCredentialStore = {
    read: async () => stored,
    replaceLegacy: async () => { stored = "rotated-test-password"; return false; },
  };
  assert.equal(await verifyAdminCredential("legacy-test-password", store, { NODE_ENV: "production" }), null);
  assert.equal(stored, "rotated-test-password");
});

test("successful environment login migrates legacy storage without persisting the environment password", async () => {
  let stored = "older-database-password";
  const store: AdminCredentialStore = {
    read: async () => stored,
    replaceLegacy: async (expected, next) => {
      assert.equal(expected, stored);
      stored = next;
      return true;
    },
  };
  const result = await verifyAdminCredential("runtime-test-password", store, {
    NODE_ENV: "production", ADMIN_PASSWORD: "runtime-test-password",
  });
  assert.equal(result?.sessionBinding, "runtime-test-password");
  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPasswordHash("older-database-password", stored), true);
  assert.equal(await verifyPasswordHash("runtime-test-password", stored), false);
});

test("invalid environment login never reads or writes stored credentials", async () => {
  const store: AdminCredentialStore = {
    read: async () => { throw new Error("database should not be read"); },
    replaceLegacy: async () => { throw new Error("database should not be written"); },
  };
  assert.equal(await verifyAdminCredential("incorrect", store, {
    NODE_ENV: "production", ADMIN_PASSWORD: "runtime-test-password",
  }), null);
});

test("missing and malformed credentials fail closed in production while development retains its fallback", async () => {
  const store: AdminCredentialStore = { read: async () => null, replaceLegacy: async () => false };
  assert.equal(await readAdminCredential(store, { NODE_ENV: "production" }), null);
  assert.equal(await verifyAdminCredential("test", store, { NODE_ENV: "production" }), null);
  assert.ok(await verifyAdminCredential("63016", store, { NODE_ENV: "development" }));
  assert.equal(await verifyAdminCredential("", store), null);
  assert.equal(await verifyAdminCredential("x".repeat(1025), store), null);
  await assert.rejects(hashAdminPassword(""), { code: "INVALID_PASSWORD" });
  await assert.rejects(hashAdminPassword("x".repeat(1025)), { code: "INVALID_PASSWORD" });
  assert.equal(await verifyPasswordHash("test", "scrypt$v1$131072$8$1$bad$bad"), false);
});

test("parallel legacy logins reuse a completed hash migration without replacing it", async () => {
  let stored = "legacy-test-password";
  const migrated = await hashAdminPassword(stored);
  const store: AdminCredentialStore = {
    read: async () => stored,
    replaceLegacy: async () => { stored = migrated; return false; },
  };
  const result = await verifyAdminCredential("legacy-test-password", store, { NODE_ENV: "production" });
  assert.equal(result?.sessionBinding, migrated);
});
