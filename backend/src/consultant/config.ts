import path from "node:path";

import {
  DEFAULT_CONSULTANT_TOKEN_BUDGET,
  type ConsultantTokenBudget,
} from "./budget";

export interface ConsultantConfig {
  readonly botToken: string;
  readonly allowedChatId: string;
  readonly deepSeekApiKey: string;
  readonly deepSeekModel: "deepseek-v4-flash";
  readonly maxOutputTokens: number;
  readonly maxQuestionCharacters: number;
  readonly pollTimeoutSeconds: number;
  readonly stateDirectory: string;
  readonly monitorDirectory: string;
  readonly dailyBudget: ConsultantTokenBudget;
}

export function readConsultantConfig(env: Readonly<Record<string, string | undefined>>): ConsultantConfig {
  const botToken = required(env, "TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN");
  const allowedChatId = required(env, "TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID");
  const deepSeekApiKey = required(env, "TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY");
  const model = env.TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  if (model !== "deepseek-v4-flash") {
    throw new Error("Unsupported DeepSeek model; only the economical deepseek-v4-flash model is allowed");
  }
  return {
    botToken,
    allowedChatId,
    deepSeekApiKey,
    deepSeekModel: model,
    maxOutputTokens: integer(env, "TDATA_TELEGRAM_CONSULTANT_MAX_OUTPUT_TOKENS", 450, 64, 450),
    maxQuestionCharacters: integer(env, "TDATA_TELEGRAM_CONSULTANT_MAX_QUESTION_CHARS", 1_500, 100, 3_000),
    pollTimeoutSeconds: integer(env, "TDATA_TELEGRAM_CONSULTANT_POLL_SECONDS", 25, 5, 50),
    stateDirectory: path.resolve(env.TDATA_TELEGRAM_CONSULTANT_STATE_DIR?.trim() || "/app/cache/telegram-consultant"),
    monitorDirectory: path.resolve(env.TDATA_PARSER_MONITOR_DIR?.trim() || "/app/cache/parser-monitor"),
    dailyBudget: {
      maxRequestsPerDay: integer(env, "TDATA_TELEGRAM_CONSULTANT_MAX_REQUESTS_PER_DAY", 12, 1, 100),
      maxPromptTokensPerDay: integer(env, "TDATA_TELEGRAM_CONSULTANT_MAX_INPUT_TOKENS_PER_DAY", 30_000, 1_000, 500_000),
      maxCompletionTokensPerDay: integer(env, "TDATA_TELEGRAM_CONSULTANT_MAX_OUTPUT_TOKENS_PER_DAY", 5_000, 450, 100_000),
      maxOutputTokensPerAnswer: DEFAULT_CONSULTANT_TOKEN_BUDGET.maxOutputTokensPerAnswer,
    },
  };
}

function required(env: Readonly<Record<string, string | undefined>>, key: string) {
  const value = env[key]?.trim() || "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
