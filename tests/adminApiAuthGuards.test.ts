import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const API_ROOT = path.join(process.cwd(), "frontend", "src", "app", "api");
const ADMIN_GUARD_PATTERN = /\brequireAdmin\s*\(/;

const REQUIRED_ADMIN_GUARDED_ROUTES = new Set([
  "admin-settings/[disciplineSlug]/route.ts",
  "admin-settings/proxy-pool/route.ts",
  "admin/proxies/route.ts",
  "admin/sandbox/route.ts",
  "cron/check-proxies/route.ts",
  "settings/global/route.ts",
  "settings/route.ts",
]);

const UI_WORKFLOW_ROUTES = new Set([
  "[disciplineSlug]/import-tournament/route.ts",
  "[disciplineSlug]/search-tournament/route.ts",
  "[disciplineSlug]/tournament/[id]/admin-fixt-preview/route.ts",
  "[disciplineSlug]/tournament/[id]/admin-mapping/route.ts",
  "settings/clear-search-cache/route.ts",
]);

test("sensitive admin API routes require the admin password gate", () => {
  const missingGuards = collectRouteFiles(API_ROOT)
    .filter((filePath) => REQUIRED_ADMIN_GUARDED_ROUTES.has(toApiRelativePath(filePath)))
    .filter((filePath) => !ADMIN_GUARD_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(toApiRelativePath)
    .sort();

  assert.deepEqual(missingGuards, []);
});

test("parser and upload workflow routes stay callable from ungated UI pages", () => {
  const guardedWorkflowRoutes = collectRouteFiles(API_ROOT)
    .filter((filePath) => UI_WORKFLOW_ROUTES.has(toApiRelativePath(filePath)))
    .filter((filePath) => ADMIN_GUARD_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(toApiRelativePath)
    .sort();

  assert.deepEqual(guardedWorkflowRoutes, []);
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
