import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const API_ROOT = path.join(process.cwd(), "src", "app", "api");
const MUTATING_ROUTE_PATTERN = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
const ADMIN_GUARD_PATTERN = /\brequireAdmin\s*\(/;

const ALLOWED_UNGUARDED_MUTATING_ROUTES = new Set([
  "admin-auth/login/route.ts",
  "admin-auth/logout/route.ts",
]);

test("mutating API routes require an admin session", () => {
  const missingGuards = collectRouteFiles(API_ROOT)
    .filter((filePath) => MUTATING_ROUTE_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .filter((filePath) => !ALLOWED_UNGUARDED_MUTATING_ROUTES.has(toApiRelativePath(filePath)))
    .filter((filePath) => !ADMIN_GUARD_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(toApiRelativePath)
    .sort();

  assert.deepEqual(missingGuards, []);
});

function collectRouteFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

function toApiRelativePath(filePath: string) {
  return path.relative(API_ROOT, filePath).split(path.sep).join("/");
}
