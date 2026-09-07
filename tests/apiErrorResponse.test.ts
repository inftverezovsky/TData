import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, apiErrorResponse, logApiError } from "../backend/src/http/apiResponse";

test("unexpected API errors never include their message, stack or custom name", async (context) => {
  const error = new Error("synthetic-sensitive-request-value");
  error.name = "synthetic-sensitive-class-value";
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  logApiError("test-operation", error);
  const response = apiErrorResponse(error, "Operation failed.");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, code: "INTERNAL_ERROR", error: "Operation failed." });
  assert.ok(!JSON.stringify(logs).includes("synthetic-sensitive"));
});

test("controlled validation errors preserve their actionable safe message and status", async () => {
  const response = apiErrorResponse(new ApiRequestError("INVALID_REQUEST", 400, "Choose a discipline."));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, code: "INVALID_REQUEST", error: "Choose a discipline." });
});
