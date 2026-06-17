import { NextResponse } from "next/server";
import { createAdminSessionResponse, verifyAdminPassword } from "@backend/auth/adminAuth";
import { getClientRateLimitKey } from "@backend/http/clientIp";

export const dynamic = "force-dynamic";

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

type LoginAttempt = {
  count: number;
  firstAttemptAt: number;
};

const attempts = new Map<string, LoginAttempt>();

export async function POST(request: Request) {
  try {
    const key = getClientKey(request);
    const limited = isRateLimited(key);
    if (limited) {
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    }

    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";

    if (!(await verifyAdminPassword(password))) {
      recordFailedAttempt(key);
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    attempts.delete(key);
    return createAdminSessionResponse({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

function isRateLimited(key: string) {
  const current = attempts.get(key);
  if (!current) return false;

  if (Date.now() - current.firstAttemptAt > LOGIN_WINDOW_MS) {
    attempts.delete(key);
    return false;
  }

  return current.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || now - current.firstAttemptAt > LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }

  current.count += 1;
}

function getClientKey(request: Request) {
  return getClientRateLimitKey(request, "admin-login");
}
