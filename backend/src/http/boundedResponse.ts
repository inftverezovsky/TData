import { Buffer } from "node:buffer";

export type BoundedBodyReadErrorCode = "body_too_large" | "invalid_body" | "invalid_json";

export class BoundedBodyReadError extends Error {
  readonly code: BoundedBodyReadErrorCode;

  constructor(message: string, code: BoundedBodyReadErrorCode) {
    super(message);
    this.name = "BoundedBodyReadError";
    this.code = code;
  }
}

type BodySource = {
  readonly body: unknown;
  readonly headers: { get(name: string): string | null };
};

type ReadOptions = {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  readonly label?: string;
};

type WebReader = {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<unknown>;
  releaseLock?(): void;
};

type WebReadableBody = {
  getReader(): WebReader;
  cancel?(reason?: unknown): Promise<unknown>;
};

type AsyncIterableBody = AsyncIterable<unknown> & {
  destroy?(error?: Error): void;
};

export async function readBoundedBodyText(source: BodySource, options: ReadOptions): Promise<string> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const label = options.label?.trim() || "HTTP body";
  options.signal?.throwIfAborted();

  const declaredLength = parseContentLength(source.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelBody(source.body);
    throw tooLarge(label, maxBytes);
  }

  if (source.body === null || source.body === undefined) return "";

  const chunks = isWebReadableBody(source.body)
    ? await readWebBody(source.body, maxBytes, label, options.signal)
    : isAsyncIterableBody(source.body)
      ? await readAsyncIterableBody(source.body, maxBytes, label, options.signal)
      : null;

  if (!chunks) {
    throw new BoundedBodyReadError(`${label} is not a readable byte stream.`, "invalid_body");
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readBoundedBodyJson<T = unknown>(source: BodySource, options: ReadOptions): Promise<T> {
  const text = await readBoundedBodyText(source, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BoundedBodyReadError(`${options.label?.trim() || "HTTP body"} is not valid JSON.`, "invalid_json");
  }
}

async function readWebBody(
  body: WebReadableBody,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      const chunk = normalizeChunk(value, label);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel(`${label} exceeded ${maxBytes} bytes`).catch(() => undefined);
        throw tooLarge(label, maxBytes);
      }
      chunks.push(chunk);
    }
    signal?.throwIfAborted();
    return chunks;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}

async function readAsyncIterableBody(
  body: AsyncIterableBody,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
) {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const onAbort = () => body.destroy?.(abortError(signal?.reason));
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await raceWithAbort(iterator.next(), signal);
      if (done) break;
      const chunk = normalizeChunk(value, label);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        body.destroy?.();
        await iterator.return?.().catch(() => undefined);
        throw tooLarge(label, maxBytes);
      }
      chunks.push(chunk);
    }
    signal?.throwIfAborted();
    return chunks;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeChunk(value: unknown, label: string) {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new BoundedBodyReadError(`${label} yielded a non-byte stream chunk.`, "invalid_body");
}

function normalizeMaxBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
  return value;
}

function parseContentLength(value: string | null) {
  const normalized = value?.trim() || "";
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isWebReadableBody(value: unknown): value is WebReadableBody {
  return Boolean(value && typeof value === "object" && "getReader" in value && typeof value.getReader === "function");
}

function isAsyncIterableBody(value: unknown): value is AsyncIterableBody {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function");
}

async function cancelBody(body: unknown) {
  if (isWebReadableBody(body) && body.cancel) {
    await body.cancel().catch(() => undefined);
    return;
  }
  if (isAsyncIterableBody(body)) body.destroy?.();
}

function tooLarge(label: string, maxBytes: number) {
  return new BoundedBodyReadError(`${label} exceeds the ${maxBytes}-byte limit.`, "body_too_large");
}

function abortError(reason?: unknown) {
  return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}
