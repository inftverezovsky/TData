import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";

const ADMIN_SESSION_COOKIE = "tcyber_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_SIGNATURE_VERSION = "settings-password-v2";

export async function verifyAdminPassword(password: string) {
  const configuredPassword = await getConfiguredAdminPassword();
  if (!configuredPassword) return false;

  return safeEqual(password, configuredPassword);
}

export async function createAdminSessionResponse(payload: Record<string, unknown> = { ok: true }) {
  const configuredPassword = await getConfiguredAdminPassword();
  if (!configuredPassword) {
    return NextResponse.json({ error: "Admin password is not configured." }, { status: 503 });
  }

  const sessionSecret = getSessionSecret(configuredPassword);
  if (!sessionSecret) {
    return NextResponse.json({ error: "ADMIN_SESSION_SECRET is required in production." }, { status: 503 });
  }

  const response = NextResponse.json(payload);
  const issuedAt = Date.now();
  const token = `${issuedAt}.${signSession(issuedAt, sessionSecret)}`;

  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAdminCookie(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

export async function requireAdmin(request: Request) {
  if (await hasValidAdminSession(request)) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function hasValidAdminSession(request: Request) {
  const token = getCookie(request.headers.get("cookie") || "", ADMIN_SESSION_COOKIE);
  if (!token) return false;

  const [issuedAtRaw, signature] = token.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || !signature) return false;

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > SESSION_TTL_SECONDS * 1000) return false;

  const configuredPassword = await getConfiguredAdminPassword();
  if (!configuredPassword) return false;

  const sessionSecret = getSessionSecret(configuredPassword);
  if (!sessionSecret) return false;

  return safeEqual(signature, signSession(issuedAt, sessionSecret));
}

export function createAdminLogoutResponse() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAdminCookie(),
    path: "/",
    maxAge: 0,
  });
  return response;
}

async function getConfiguredAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;

  const setting = await prisma.globalSettings.findUnique({
    where: { key: "admin_password" },
    select: { value: true },
  });

  if (setting?.value) return setting.value;

  return process.env.NODE_ENV === "production" ? null : "63016";
}

function signSession(issuedAt: number, secret: string) {
  return createHmac("sha256", secret).update(`${SESSION_SIGNATURE_VERSION}:${issuedAt}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function shouldUseSecureAdminCookie() {
  if (process.env.ADMIN_COOKIE_SECURE === "true") return true;
  if (process.env.ADMIN_COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function getCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getSessionSecret(configuredPassword: string) {
  const explicitSecret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET;

  if (explicitSecret) return explicitSecret;
  if (process.env.NODE_ENV === "production") return null;

  return configuredPassword;
}
