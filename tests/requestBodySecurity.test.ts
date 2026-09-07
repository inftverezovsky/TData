import assert from "node:assert/strict";
import test from "node:test";
import { readJsonRequest } from "../backend/src/http/requestBody";

test("JSON boundary reads valid UTF-8 and rejects empty or malformed bodies", async () => {
  assert.deepEqual(await readJsonRequest(new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ title: "Турнир" }),
  })), { title: "Турнир" });
  await assert.rejects(readJsonRequest(new Request("https://example.test")), { code: "INVALID_JSON", status: 400 });
  await assert.rejects(readJsonRequest(new Request("https://example.test", { method: "POST", body: "{" })), {
    code: "INVALID_JSON", status: 400,
  });
});

test("JSON boundary limits both declared and streamed body size and cancels overflow", async () => {
  await assert.rejects(readJsonRequest(new Request("https://example.test", {
    method: "POST", headers: { "Content-Length": "100" }, body: "{}",
  }), 16), { code: "PAYLOAD_TOO_LARGE", status: 413 });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(32)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readJsonRequest(request, 16), { code: "PAYLOAD_TOO_LARGE", status: 413 });
  assert.equal(cancelled, true);
});
