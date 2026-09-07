export interface ConsultantDailyUsage {
  readonly date: string;
  readonly requests: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheHitTokens: number;
}

export interface ConsultantTokenBudget {
  readonly maxRequestsPerDay: number;
  readonly maxPromptTokensPerDay: number;
  readonly maxCompletionTokensPerDay: number;
  readonly maxOutputTokensPerAnswer: number;
}

export interface DeepSeekUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheHitTokens: number;
}

export const DEFAULT_CONSULTANT_TOKEN_BUDGET: ConsultantTokenBudget = Object.freeze({
  maxRequestsPerDay: 12,
  maxPromptTokensPerDay: 30_000,
  maxCompletionTokensPerDay: 5_000,
  maxOutputTokensPerAnswer: 450,
});

export function moscowDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function emptyDailyUsage(now = new Date()): ConsultantDailyUsage {
  return {
    date: moscowDate(now),
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
  };
}

export function normalizeDailyUsage(
  usage: ConsultantDailyUsage | null | undefined,
  now = new Date(),
): ConsultantDailyUsage {
  const date = moscowDate(now);
  if (!usage || usage.date !== date) return emptyDailyUsage(now);
  return {
    date,
    requests: nonNegativeInteger(usage.requests),
    promptTokens: nonNegativeInteger(usage.promptTokens),
    completionTokens: nonNegativeInteger(usage.completionTokens),
    cacheHitTokens: nonNegativeInteger(usage.cacheHitTokens),
  };
}

export function estimateDeepSeekTokens(text: string) {
  const bytes = Buffer.byteLength(String(text || ""), "utf8");
  return Math.max(1, Math.ceil(bytes / 3));
}

export function checkTokenBudget(
  usage: ConsultantDailyUsage,
  budget: ConsultantTokenBudget,
  estimatedPromptTokens: number,
): { allowed: true } | { allowed: false; reason: string } {
  if (usage.requests >= budget.maxRequestsPerDay) {
    return { allowed: false, reason: "Достигнут дневной лимит AI-запросов." };
  }
  if (usage.promptTokens + Math.max(0, estimatedPromptTokens) > budget.maxPromptTokensPerDay) {
    return { allowed: false, reason: "Достигнут дневной лимит входных токенов." };
  }
  if (usage.completionTokens + budget.maxOutputTokensPerAnswer > budget.maxCompletionTokensPerDay) {
    return { allowed: false, reason: "Недостаточно дневного лимита выходных токенов." };
  }
  return { allowed: true };
}

export function recordTokenUsage(
  usage: ConsultantDailyUsage,
  result: DeepSeekUsage,
): ConsultantDailyUsage {
  return {
    ...usage,
    requests: usage.requests + 1,
    promptTokens: usage.promptTokens + nonNegativeInteger(result.promptTokens),
    completionTokens: usage.completionTokens + nonNegativeInteger(result.completionTokens),
    cacheHitTokens: usage.cacheHitTokens + nonNegativeInteger(result.cacheHitTokens),
  };
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
