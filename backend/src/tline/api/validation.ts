import { isIP } from "node:net";

export class TLineValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TLineValidationError";
  }
}

export function parseOfficialSourceUrl(value: unknown, allowedHosts: readonly string[]): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw invalidSourceUrl();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidSourceUrl();
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const normalizedAllowedHosts = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  const registeredHost = normalizedAllowedHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || isIP(hostname) !== 0
    || !registeredHost
  ) {
    throw invalidSourceUrl();
  }

  return parsed.href;
}

function invalidSourceUrl() {
  return new TLineValidationError(
    "INVALID_SOURCE_URL",
    "Source URL must use HTTPS and a host registered by a TLine source adapter.",
  );
}
