import dns from "dns/promises";
import net from "net";
import { ApiRequestError } from "./apiResponse";

export type OutboundPolicyOptions = {
  policyName: string;
  allowedHostsEnv?: Array<string | undefined>;
  allowInsecureHttpEnv?: string | undefined;
  allowPrivateHostsEnv?: string | undefined;
  allowAnyPublicHostEnv?: string | undefined;
  requireAllowedHostsInProduction?: boolean;
  blockPrivateHostsInProduction?: boolean;
};

export async function validateOutboundUrl(rawUrl: string | URL, options: OutboundPolicyOptions) {
  return (await inspectOutboundTarget(rawUrl, options, false)).url;
}

/** Возвращает проверенный IP для самого соединения, чтобы транспорт не выполнял повторный DNS lookup. */
export async function resolveOutboundTarget(rawUrl: string | URL, options: OutboundPolicyOptions) {
  const { url, addresses } = await inspectOutboundTarget(rawUrl, options, true);
  return { url, address: addresses[0] };
}

async function inspectOutboundTarget(rawUrl: string | URL, options: OutboundPolicyOptions, resolveForConnection: boolean) {
  // Проверяем протокол и allowlist до DNS, затем отклоняем любой непубличный адрес назначения.
  const url = new URL(String(rawUrl));

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL must use http or https.`);
  }

  if (url.username || url.password) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL must not contain inline credentials.`);
  }

  const allowInsecureHttp = isEnabled(options.allowInsecureHttpEnv);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !allowInsecureHttp) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL must use HTTPS in production.`);
  }

  const allowedHosts = getAllowedHosts(options.allowedHostsEnv);
  const allowAnyPublicHost =
    process.env.NODE_ENV !== "production" ||
    isEnabled(options.allowAnyPublicHostEnv);

  if (options.requireAllowedHostsInProduction && allowedHosts.length === 0 && !allowAnyPublicHost) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} allowed hosts are required in production.`);
  }

  if (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} host is not allowlisted.`);
  }

  const blockPrivateHosts =
    options.blockPrivateHostsInProduction !== false &&
    process.env.NODE_ENV === "production" &&
    !isEnabled(options.allowPrivateHostsEnv);

  if (!blockPrivateHosts && !resolveForConnection) return { url, addresses: [] as string[] };

  if (blockPrivateHosts && isPrivateHostname(url.hostname)) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL must not target a private host.`);
  }

  const addresses = await resolveHostAddresses(url.hostname);
  if (addresses.length === 0 || addresses.some((address) => !net.isIP(address))) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL has no usable IP address.`);
  }
  if (blockPrivateHosts && addresses.some(isPrivateAddress)) {
    throw new ApiRequestError("INVALID_OUTBOUND_TARGET", 400, `${options.policyName} URL resolves to a private address.`);
  }

  return { url, addresses };
}

export function getAllowedHosts(values: Array<string | undefined> = []) {
  return values
    .join(",")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export async function resolveHostAddresses(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return [host];
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost");
}

export function isPrivateAddress(address: string) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (net.isIP(address) === 6) {
    // IPv4-mapped IPv6 маскирует тот же IPv4-узел; проверяем встроенный адрес теми же правилами.
    if (address.includes("%")) return true;
    const words = ipv6Words(address);
    const isEmbeddedIpv4 = words.slice(0, 5).every((word) => word === 0)
      && (words[5] === 0xffff || words[5] === 0);
    if (isEmbeddedIpv4) {
      return isPrivateAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
    }
    const firstWord = words[0];
    return (
      (firstWord & 0xfe00) === 0xfc00 ||
      (firstWord & 0xffc0) === 0xfe80 ||
      (firstWord & 0xffc0) === 0xfec0 ||
      (firstWord & 0xff00) === 0xff00 ||
      (firstWord === 0x2001 && words[1] === 0x0db8)
    );
  }

  return true;
}

function ipv6Words(address: string) {
  // URL приводит IPv4-хвост к hex; раскрываем сокращение :: в ровно восемь 16-битных слов.
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head, tail] = normalized.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.map((group) => Number.parseInt(group, 16));
}

export function isEnabled(value: string | undefined) {
  return value === "1" || value === "true";
}
