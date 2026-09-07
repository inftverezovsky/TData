import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const APP_DIRECTORY = join(process.cwd(), "frontend", "src", "app");
const SETTINGS_PAGE = "settings/page.tsx";

function collectPageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectPageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

test("the password gate protects only the API settings page", () => {
  const protectedPages = collectPageFiles(APP_DIRECTORY)
    .filter((path) => readFileSync(path, "utf8").includes("SettingsPasswordGate"))
    .map((path) => relative(APP_DIRECTORY, path).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(protectedPages, [SETTINGS_PAGE]);
});
