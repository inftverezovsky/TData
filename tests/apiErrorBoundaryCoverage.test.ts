import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";

const apiRoot = join(process.cwd(), "frontend/src/app/api");

test("API catch blocks do not expose raw exception messages, stacks or names", () => {
  const findings: string[] = [];
  for (const path of routes(apiRoot)) {
    if (path.includes(join("cron", "check-proxies"))) continue;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
        const name = node.variableDeclaration.name.text;
        const inspect = (child: ts.Node) => {
          if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)
            && child.expression.text === name && ["message", "stack", "name"].includes(child.name.text)) {
            findings.push(`${relative(apiRoot, path)}:${source.getLineAndCharacterOfPosition(child.getStart()).line + 1}`);
          }
          ts.forEachChild(child, inspect);
        };
        inspect(node.block);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(findings, []);
});

function routes(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? routes(join(root, entry.name)) : entry.name === "route.ts" ? [join(root, entry.name)] : []);
}
