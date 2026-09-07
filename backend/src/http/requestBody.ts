import { ApiRequestError } from "./apiResponse";

export async function readJsonRequest(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw invalidJson();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw invalidJson(); }
}

function tooLarge() { return new ApiRequestError("PAYLOAD_TOO_LARGE", 413, "Request body is too large."); }
function invalidJson() { return new ApiRequestError("INVALID_JSON", 400, "Request body must be valid JSON."); }
