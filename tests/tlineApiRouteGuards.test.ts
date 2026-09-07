import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const apiRoot = path.join(process.cwd(), "frontend", "src", "app", "api", "tline");

test("every TLine API route uses the public access and mutation-safety boundary", () => {
  const routes = routeFiles(apiRoot);
  assert.ok(routes.length >= 20, "expected the complete TLine API surface");
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    const protectedDirectly = source.includes("requireTLineAccess(request")
      || source.includes("requireTLineFormAccess(request");
    const protectedByReexport = source.includes("export { GET } from");
    assert.ok(protectedDirectly || protectedByReexport, path.relative(process.cwd(), route));
  }
});

test("every implemented TLine mutation requests same-origin validation", () => {
  for (const route of routeFiles(apiRoot)) {
    const source = readFileSync(route, "utf8");
    if (!/export async function (?:POST|PATCH|DELETE)/.test(source)) continue;
    assert.match(
      source,
      /requireTLineAccess\(request, true\)|requireTLineFormAccess\(request\)/,
      path.relative(process.cwd(), route),
    );
  }
});

test("TLine client components never read server environment variables", () => {
  const componentRoot = path.join(process.cwd(), "frontend", "src", "components", "tline");
  for (const file of sourceFiles(componentRoot)) {
    const source = readFileSync(file, "utf8");
    if (source.startsWith('"use client"')) {
      assert.doesNotMatch(source, /process\.env|ADMIN_(?:PASSWORD|TOKEN|API|MTLS)/, file);
    }
  }
});

function routeFiles(root: string): string[] {
  return sourceFiles(root).filter((file) => path.basename(file) === "route.ts");
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(item) : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [item] : [];
  });
}
