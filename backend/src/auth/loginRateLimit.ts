import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/db";

const MAX_ATTEMPTS = 8;
type Client = Pick<PrismaClient, "$queryRaw" | "adminLoginRateLimit">;

export function loginRateLimitKey(clientKey: string) {
  return createHash("sha256").update(`admin-login:${clientKey}`).digest("hex");
}

export async function reserveLoginAttempt(clientKey: string, client: Client = prisma) {
  const key = loginRateLimitKey(clientKey);
  // Счётчик изменяется одним SQL upsert: параллельные процессы не получают один и тот же остаток лимита.
  const rows = await client.$queryRaw<Array<{ attempts: number; retryAfterSeconds: number }>>`
    INSERT INTO "AdminLoginRateLimit" ("key", "attempts", "windowStartedAt", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "AdminLoginRateLimit"."expiresAt" <= CURRENT_TIMESTAMP
        THEN 1 ELSE LEAST("AdminLoginRateLimit"."attempts" + 1, ${MAX_ATTEMPTS + 1}) END,
      "windowStartedAt" = CASE WHEN "AdminLoginRateLimit"."expiresAt" <= CURRENT_TIMESTAMP
        THEN CURRENT_TIMESTAMP ELSE "AdminLoginRateLimit"."windowStartedAt" END,
      "expiresAt" = CASE WHEN "AdminLoginRateLimit"."expiresAt" <= CURRENT_TIMESTAMP
        THEN CURRENT_TIMESTAMP + INTERVAL '10 minutes' ELSE "AdminLoginRateLimit"."expiresAt" END
    RETURNING "attempts", CEIL(EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP)))::integer AS "retryAfterSeconds"
  `;
  if (!rows[0]) throw new Error("Login rate limit unavailable");
  // Удаляем только давно истёкшие окна. Рабочее окно не исчезает при рестарте процесса.
  await client.adminLoginRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  return { allowed: rows[0].attempts <= MAX_ATTEMPTS, retryAfterSeconds: Math.max(1, rows[0].retryAfterSeconds) };
}

export async function clearLoginAttempts(clientKey: string, client: Client = prisma) {
  await client.adminLoginRateLimit.deleteMany({ where: { key: loginRateLimitKey(clientKey) } });
}
