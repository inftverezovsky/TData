import { NFFR_FLOORBALL_PROVIDER, resolveNffrFloorballCalendarUrl } from "../sources/nffrFloorball";
import { VOLLEY_RU_PROVIDER } from "../sources/volleyRu";
import { TLineValidationError } from "./validation";

export type ResolvedOfficialSourceConfig = Readonly<{
  provider: string;
  externalId: string;
  sourceUrl: string;
}>;

export function resolveOfficialSourceConfig(value: unknown): ResolvedOfficialSourceConfig {
  if (typeof value !== "string" || value.length > 2_048) throw invalidSourceUrl();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidSourceUrl();
  }

  if (url.hostname === "volley.ru") {
    const externalId = url.pathname.match(/^\/calendar\/([A-Za-z0-9_-]{1,128})\/allgames\/?$/u)?.[1];
    if (!externalId || !isExactSafeUrl(url, "volley.ru")) throw invalidSourceUrl();
    return Object.freeze({ provider: VOLLEY_RU_PROVIDER, externalId, sourceUrl: url.toString() });
  }
  if (url.hostname === "xn--m1agla.xn--p1ai") {
    try {
      const resolved = resolveNffrFloorballCalendarUrl(value);
      return Object.freeze({ provider: NFFR_FLOORBALL_PROVIDER, ...resolved });
    } catch {
      throw invalidSourceUrl();
    }
  }
  throw invalidSourceUrl();
}

function isExactSafeUrl(url: URL, hostname: string) {
  return url.protocol === "https:"
    && url.hostname === hostname
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}

function invalidSourceUrl() {
  return new TLineValidationError(
    "INVALID_SOURCE_URL",
    "Source URL must match a calendar supported by a registered TLine source adapter.",
  );
}
