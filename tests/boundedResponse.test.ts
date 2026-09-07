import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  BoundedBodyReadError,
  readBoundedBodyJson,
  readBoundedBodyText,
} from "../backend/src/http/boundedResponse";

test("bounded body reader rejects a declared body above the byte limit", async () => {
  const response = new Response("small", {
    headers: { "Content-Length": "65537" },
  });

  await assert.rejects(
    readBoundedBodyText(response, { maxBytes: 65536, label: "test response" }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
});

test("bounded body reader stops a chunked body once streamed bytes exceed the limit", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(40));
    },
    cancel() {
      cancelled = true;
    },
  }));

  await assert.rejects(
    readBoundedBodyText(response, { maxBytes: 64, label: "chunked response" }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
  assert.equal(cancelled, true);
});

test("bounded body reader measures UTF-8 bytes instead of JavaScript characters", async () => {
  const response = new Response("яяя");

  await assert.rejects(
    readBoundedBodyText(response, { maxBytes: 5 }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
});

test("bounded body reader limits node-fetch style async-iterable streams", async () => {
  const body = Readable.from([Buffer.alloc(32), Buffer.alloc(33)]);
  const source = {
    body,
    headers: new Headers(),
  };

  await assert.rejects(
    readBoundedBodyText(source, { maxBytes: 64, label: "node stream" }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
  assert.equal(body.destroyed, true);
});

test("bounded body reader handles empty, string, and ArrayBuffer body variants", async () => {
  assert.equal(await readBoundedBodyText({ body: null, headers: new Headers() }, { maxBytes: 0 }), "");

  const body = {
    async *[Symbol.asyncIterator]() {
      yield "ab";
      yield new TextEncoder().encode("cd").buffer;
    },
  };
  assert.equal(
    await readBoundedBodyText({ body, headers: new Headers({ "Content-Length": "invalid" }) }, { maxBytes: 4 }),
    "abcd",
  );
});

test("bounded body reader rejects invalid limits, streams, and chunks", async () => {
  await assert.rejects(
    readBoundedBodyText({ body: {}, headers: new Headers() }, { maxBytes: 1 }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "invalid_body",
  );
  await assert.rejects(
    readBoundedBodyText({
      body: { async *[Symbol.asyncIterator]() { yield { unexpected: true }; } },
      headers: new Headers(),
    }, { maxBytes: 10 }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "invalid_body",
  );
  await assert.rejects(
    readBoundedBodyText(new Response("x"), { maxBytes: -1 }),
    TypeError,
  );
});

test("declared oversized node streams are destroyed before reading", async () => {
  const body = Readable.from([Buffer.alloc(1)]);
  await assert.rejects(
    readBoundedBodyText({ body, headers: new Headers({ "Content-Length": "65" }) }, { maxBytes: 64 }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
  assert.equal(body.destroyed, true);
});

test("bounded body reader cancels an in-flight stream when the caller aborts", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = new Response(new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelled = true;
    },
  }));

  const reading = readBoundedBodyText(response, { maxBytes: 1024, signal: controller.signal });
  controller.abort(new DOMException("Stopped", "AbortError"));

  await assert.rejects(reading, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(cancelled, true);
});

test("bounded JSON reader parses a bounded body and types invalid JSON", async () => {
  assert.deepEqual(
    await readBoundedBodyJson(new Response('{"ok":true}'), { maxBytes: 64 }),
    { ok: true },
  );
  await assert.rejects(
    readBoundedBodyJson(new Response("not json"), { maxBytes: 64 }),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "invalid_json",
  );
});
