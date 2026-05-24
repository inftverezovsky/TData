import assert from "node:assert/strict";
import test from "node:test";
import { isRetryablePrismaConnectionError } from "../src/lib/db/retry";

test("isRetryablePrismaConnectionError detects closed PostgreSQL connections", () => {
  assert.equal(
    isRetryablePrismaConnectionError(new Error("Invalid `prisma.discipline.upsert()` invocation: Server has closed the connection.")),
    true,
  );
  assert.equal(
    isRetryablePrismaConnectionError({ code: "P1017", message: "Server has closed the connection." }),
    true,
  );
  assert.equal(
    isRetryablePrismaConnectionError(new Error("terminating connection due to administrator command")),
    true,
  );
});

test("isRetryablePrismaConnectionError rejects normal validation errors", () => {
  assert.equal(isRetryablePrismaConnectionError({ code: "P2002", message: "Unique constraint failed" }), false);
  assert.equal(isRetryablePrismaConnectionError(new Error("Unknown discipline slug")), false);
});
