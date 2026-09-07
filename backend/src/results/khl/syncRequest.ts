import { NextResponse } from "next/server";

/** Sync commands contain only a few identifiers; never buffer an unbounded public body. */
export async function readKhlSyncRequest(request: Request): Promise<unknown | Response> {
  const maximum = 2_048;
  const length = request.headers.get("content-length");
  const oversized = () => NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) return oversized();
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); return oversized(); }
      parts.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  } finally { reader.releaseLock(); }
}
