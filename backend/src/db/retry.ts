import { getPrismaClient } from "@backend/db/db";

type PrismaRetryOptions = {
  label: string;
  retries?: number;
  baseDelayMs?: number;
};

export async function withPrismaConnectionRetry<T>(
  operation: () => Promise<T>,
  options: PrismaRetryOptions,
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryablePrismaConnectionError(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** attempt;
      console.warn(
        `[PrismaRetry] ${options.label} failed after a transient database disconnect. Retrying in ${delayMs}ms (${attempt + 1}/${retries}).`,
      );
      await getPrismaClient().$disconnect().catch(() => undefined);
      await delay(delayMs);
    }
  }

  throw lastError;
}

export function isRetryablePrismaConnectionError(error: unknown) {
  const value = error as { code?: string; message?: string };
  const code = String(value?.code || "");
  if (["P1001", "P1002", "P1017"].includes(code)) return true;

  const message = String(value?.message || error || "").toLowerCase();
  return [
    "server has closed the connection",
    "terminating connection due to administrator command",
    "connection reset by peer",
    "can't reach database server",
    "connection refused",
    "connection terminated",
    "socket closed",
  ].some((marker) => message.includes(marker));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
