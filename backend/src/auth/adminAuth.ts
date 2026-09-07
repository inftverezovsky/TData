import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { readAdminCredential, verifyAdminCredential } from "./credentials";
import { apiErrorResponse, ApiRequestError, logApiError } from "../http/apiResponse";

const ADMIN_SESSION_COOKIE = "tdata_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_SIGNATURE_VERSION = "settings-password-v3";
const PUBLIC_ORIGIN_ENV_KEYS = [
  "TDATA_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "PUBLIC_BASE_URL",
  "APP_URL",
] as const;

export async function verifyAdminPassword(password: string) {
  return Boolean(await verifyAdminCredential(password));
}

export async function createAdminSessionResponse(
  payload: Record<string, unknown> = { ok: true },
  verifiedSessionBinding?: string,
) {
  // Login передаёт именно проверенную версию секрета: параллельная смена пароля не выдаст новую сессию старому паролю.
  const configuredPassword = verifiedSessionBinding ?? (await readAdminCredential())?.value;
  if (!configuredPassword) {
    return NextResponse.json({ error: "Admin password is not configured." }, { status: 503 });
  }

  const sessionSecret = getSessionSecret(configuredPassword);
  if (!sessionSecret) {
    return NextResponse.json({ error: "ADMIN_SESSION_SECRET is required in production." }, { status: 503 });
  }

  const response = NextResponse.json(payload);
  const issuedAt = Date.now();
  // Выдаём только подпись и время: пароль остаётся на сервере, а его смена отзывает старые сессии.
  const token = `${issuedAt}.${signSession(issuedAt, sessionSecret, configuredPassword)}`;

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
  try {
    if (await hasValidAdminSession(request)) return null;
    return apiErrorResponse(new ApiRequestError("AUTH_REQUIRED", 401, "Unauthorized"));
  } catch (error) {
    logApiError("admin-session-validation", error);
    return apiErrorResponse(error, "Authentication is temporarily unavailable.", 503);
  }
}

export async function hasValidAdminSession(request: Request) {
  const token = getCookie(request.headers.get("cookie") || "", ADMIN_SESSION_COOKIE);
  if (!token) return false;

  // Сначала отсеиваем повреждённый/просроченный cookie, затем сверяем HMAC с текущими настройками.
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const [issuedAtRaw, signature] = token.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || !signature) return false;

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > SESSION_TTL_SECONDS * 1000) return false;

  const configuredPassword = (await readAdminCredential())?.value;
  if (!configuredPassword) return false;

  const sessionSecret = getSessionSecret(configuredPassword);
  if (!sessionSecret) return false;

  return safeEqual(signature, signSession(issuedAt, sessionSecret, configuredPassword));
}

export function requireSameOriginJsonMutation(request: Request) {
  const invalid = requireSameOriginMutation(request, ["application/json"]);
  return invalid?.status === 415
    ? NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 })
    : invalid;
}

export function requireSameOriginMutation(request: Request, allowedContentTypes: readonly string[]) {
  // До чтения тела проверяем источник запроса; затем разрешаем только ожидаемый формат данных.
  const forbidden = requireSameOriginRequest(request);
  if (forbidden) return forbidden;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !allowedContentTypes.includes(contentType)) {
    return apiErrorResponse(new ApiRequestError("INVALID_CONTENT_TYPE", 415,
      `Content-Type must be one of: ${allowedContentTypes.join(", ")}.`));
  }
  return null;
}

export function requireSameOriginRequest(request: Request) {
  const origin = normalizeOrigin(request.headers.get("origin"));
  const allowedOrigins = requestOrigins(request);
  if (!origin || !allowedOrigins.has(origin)) {
    return apiErrorResponse(new ApiRequestError("FORBIDDEN_ORIGIN", 403, "Forbidden request origin."));
  }

  return null;
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

function signSession(issuedAt: number, secret: string, configuredPassword: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify([SESSION_SIGNATURE_VERSION, issuedAt, configuredPassword]))
    .digest("hex");
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

function requestOrigins(request: Request) {
  const origins = new Set<string>();
  const host = request.headers.get("host");
  // NextRequest нормализует loopback в localhost. Host хранит реальный authority HTTP-запроса,
  // с которым браузер сравнивает Origin; внутренний alias сервера не становится дополнительным разрешённым origin.
  const requestOrigin = host === null
    ? normalizeOrigin(request.url)
    : normalizeHostOrigin(host, new URL(request.url).protocol);
  if (requestOrigin) origins.add(requestOrigin);

  // Явно настроенный адрес сайта принимаем и при внутреннем HTTP-адресе reverse proxy.
  for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
    const configuredOrigin = normalizeOrigin(process.env[key] || null);
    if (configuredOrigin) origins.add(configuredOrigin);
  }

  // Пересылаемый внешний authority разрешаем только за явно настроенным доверенным прокси.
  if (process.env.TRUST_PROXY_HEADERS !== "1" && process.env.TRUST_PROXY_HEADERS !== "true") {
    return origins;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0].trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
  if (forwardedHost && (forwardedProtocol === "http" || forwardedProtocol === "https")) {
    const forwardedOrigin = normalizeHostOrigin(forwardedHost, `${forwardedProtocol}:`);
    if (forwardedOrigin) origins.add(forwardedOrigin);
  }
  return origins;
}

function normalizeHostOrigin(host: string, protocol: string) {
  // Host содержит только имя/IP и необязательный порт, без userinfo, пути, списка или управляющих символов.
  if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])(?::\d{1,5})?$/i.test(host)) return null;
  return normalizeOrigin(`${protocol}//${host}`);
}

function normalizeOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
