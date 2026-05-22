import dns from "dns/promises";
import net from "net";

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
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error(`${options.policyName} URL must use http or https.`);
  }

  if (url.username || url.password) {
    throw new Error(`${options.policyName} URL must not contain inline credentials.`);
  }

  const allowInsecureHttp = isEnabled(options.allowInsecureHttpEnv);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !allowInsecureHttp) {
    throw new Error(`${options.policyName} URL must use HTTPS in production.`);
  }

  const allowedHosts = getAllowedHosts(options.allowedHostsEnv);
  const allowAnyPublicHost =
    process.env.NODE_ENV !== "production" ||
    isEnabled(options.allowAnyPublicHostEnv);

  if (options.requireAllowedHostsInProduction && allowedHosts.length === 0 && !allowAnyPublicHost) {
    throw new Error(`${options.policyName} allowed hosts are required in production.`);
  }

  if (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`${options.policyName} host is not allowlisted.`);
  }

  const blockPrivateHosts =
    options.blockPrivateHostsInProduction !== false &&
    process.env.NODE_ENV === "production" &&
    !isEnabled(options.allowPrivateHostsEnv);

  if (!blockPrivateHosts) return url;

  if (isPrivateHostname(url.hostname)) {
    throw new Error(`${options.policyName} URL must not target a private host.`);
  }

  const addresses = await resolveHostAddresses(url.hostname);
  if (addresses.some(isPrivateAddress)) {
    throw new Error(`${options.policyName} URL resolves to a private address.`);
  }

  return url;
}

export function getAllowedHosts(values: Array<string | undefined> = []) {
  return values
    .join(",")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export async function resolveHostAddresses(hostname: string) {
  if (net.isIP(hostname)) return [hostname];
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost");
}

export function isPrivateAddress(address: string) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}

export function isEnabled(value: string | undefined) {
  return value === "1" || value === "true";
}
