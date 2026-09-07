import crypto from "node:crypto";

import { readLatestParserMonitorReport } from "../monitoring/parserMonitorPersistence";
import type { ParserMonitorReport } from "../monitoring/parserMonitorTypes";
import {
  checkTokenBudget,
  estimateDeepSeekTokens,
  normalizeDailyUsage,
  recordTokenUsage,
  type ConsultantDailyUsage,
} from "./budget";
import {
  buildConsultantUserPrompt,
  classifyConsultantUpdate,
  CONSULTANT_SYSTEM_PROMPT,
  formatParserMonitorStatus,
  sanitizeExternalText,
} from "./consultant";
import type { ConsultantConfig } from "./config";
import { requestDeepSeekAnswer, type DeepSeekAnswer } from "./deepseek";
import {
  createKnowledgeIndex,
  loadConsultantDocuments,
  retrieveKnowledge,
  type KnowledgeChunk,
} from "./knowledge";
import {
  persistConsultantState,
  readConsultantState,
  type ConsultantState,
} from "./state";
import { createTelegramBotClient, type TelegramUpdate } from "./telegramBotApi";

const RESPONSE_CACHE_LIMIT = 50;

type TelegramClient = ReturnType<typeof createTelegramBotClient>;

interface ConsultantRuntimeDependencies {
  readonly telegram?: TelegramClient;
  readonly knowledgeIndex?: readonly KnowledgeChunk[];
  readonly readMonitor?: (directory: string) => ParserMonitorReport | null;
  readonly requestAnswer?: typeof requestDeepSeekAnswer;
  readonly readState?: typeof readConsultantState;
  readonly persistState?: typeof persistConsultantState;
}

export async function runTelegramConsultant(input: {
  readonly config: ConsultantConfig;
  readonly proxyUrls?: readonly string[];
  readonly signal?: AbortSignal;
  readonly rootDirectory?: string;
}, runtime: ConsultantRuntimeDependencies = {}) {
  const { config, signal } = input;
  const telegram = runtime.telegram
    ?? createTelegramBotClient({ botToken: config.botToken, proxyUrls: input.proxyUrls });
  const webhook = await telegram.getWebhookInfo();
  if (webhook.url.trim()) {
    throw new Error("Telegram long polling is unavailable while a webhook is configured");
  }

  const knowledgeIndex = runtime.knowledgeIndex
    ?? createKnowledgeIndex(loadConsultantDocuments(input.rootDirectory));
  if (knowledgeIndex.length === 0) throw new Error("Consultant knowledge documents are unavailable");
  const readState = runtime.readState ?? readConsultantState;
  const persistState = runtime.persistState ?? persistConsultantState;
  let state = readState(config.stateDirectory);
  const cache = new Map<string, string>();

  if (state.nextUpdateId === null) {
    const pending = await telegram.getUpdates({ offset: -1, timeoutSeconds: 0 });
    const latest = maxUpdateId(pending);
    state = { ...state, nextUpdateId: latest === null ? 0 : latest + 1, lastPollAt: new Date().toISOString() };
    persistState(config.stateDirectory, state);
  }

  while (!signal?.aborted) {
    try {
      const updates = await telegram.getUpdates({
        offset: state.nextUpdateId ?? 0,
        timeoutSeconds: config.pollTimeoutSeconds,
      });
      for (const update of [...updates].sort((left, right) => left.update_id - right.update_id)) {
        signal?.throwIfAborted();
        state = await processConsultantUpdate(update, state, {
          config,
          knowledgeIndex,
          cache,
          telegram,
          proxyUrls: input.proxyUrls || [],
          readMonitor: runtime.readMonitor ?? readLatestParserMonitorReport,
          requestAnswer: runtime.requestAnswer ?? requestDeepSeekAnswer,
          persistState,
        });
        state = { ...state, nextUpdateId: update.update_id + 1 };
        persistState(config.stateDirectory, state);
      }
      state = {
        ...state,
        usage: normalizeDailyUsage(state.usage),
        lastPollAt: new Date().toISOString(),
      };
      persistState(config.stateDirectory, state);
    } catch (error) {
      if (signal?.aborted) break;
      console.error("Telegram consultant poll failed:", safeError(error));
      await abortableDelay(5_000, signal);
    }
  }
}

export async function processConsultantUpdate(
  update: TelegramUpdate,
  state: ConsultantState,
  dependencies: {
    readonly config: ConsultantConfig;
    readonly knowledgeIndex: readonly KnowledgeChunk[];
    readonly cache: Map<string, string>;
    readonly telegram: TelegramClient;
    readonly proxyUrls: readonly string[];
    readonly readMonitor: (directory: string) => ParserMonitorReport | null;
    readonly requestAnswer: (input: Parameters<typeof requestDeepSeekAnswer>[0]) => Promise<DeepSeekAnswer>;
    readonly persistState: typeof persistConsultantState;
    readonly logError?: (label: string, message: string) => void;
  },
) {
  const action = classifyConsultantUpdate(
    update,
    dependencies.config.allowedChatId,
    dependencies.config.maxQuestionCharacters,
  );
  if (action.kind === "ignore") return state;
  if (action.kind === "too_long") {
    await dependencies.telegram.sendMessage(
      dependencies.config.allowedChatId,
      `Вопрос слишком длинный. Лимит: ${dependencies.config.maxQuestionCharacters} символов.`,
      action.messageId,
    );
    return state;
  }
  if (action.kind === "command" && action.command !== "ask") {
    await dependencies.telegram.sendMessage(
      dependencies.config.allowedChatId,
      commandResponse(action.command, state.usage, dependencies.config, dependencies.readMonitor(dependencies.config.monitorDirectory)),
      action.messageId,
    );
    return state;
  }
  const question = action.kind === "question" ? action.question : action.argument;
  if (!question) {
    await dependencies.telegram.sendMessage(
      dependencies.config.allowedChatId,
      "Использование: /ask ваш вопрос о TData",
      action.messageId,
    );
    return state;
  }
  return answerQuestion(question, action.messageId, update.update_id, state, dependencies);
}

async function answerQuestion(
  question: string,
  messageId: number,
  updateId: number,
  state: ConsultantState,
  dependencies: {
    readonly config: ConsultantConfig;
    readonly knowledgeIndex: readonly KnowledgeChunk[];
    readonly cache: Map<string, string>;
    readonly telegram: TelegramClient;
    readonly proxyUrls: readonly string[];
    readonly readMonitor: (directory: string) => ParserMonitorReport | null;
    readonly requestAnswer: (input: Parameters<typeof requestDeepSeekAnswer>[0]) => Promise<DeepSeekAnswer>;
    readonly persistState: typeof persistConsultantState;
    readonly logError?: (label: string, message: string) => void;
  },
) {
  const report = dependencies.readMonitor(dependencies.config.monitorDirectory);
  const monitorContext = formatParserMonitorStatus(report);
  const knowledge = retrieveKnowledge(dependencies.knowledgeIndex, question, {
    maxChunks: 4,
    maxCharacters: 5_500,
  });
  const prompt = buildConsultantUserPrompt({ question, knowledge, monitorContext, maxCharacters: 8_000 });
  const cacheKey = responseCacheKey(question, report?.runId || "none");
  const cached = dependencies.cache.get(cacheKey);
  if (cached) {
    await dependencies.telegram.sendMessage(dependencies.config.allowedChatId, `${cached}\n\nОтвет из кратковременного кэша.`, messageId);
    return state;
  }

  const usage = normalizeDailyUsage(state.usage);
  const budget = checkTokenBudget(
    usage,
    dependencies.config.dailyBudget,
    estimateDeepSeekTokens(`${CONSULTANT_SYSTEM_PROMPT}\n${prompt}`),
  );
  if (!budget.allowed) {
    await dependencies.telegram.sendMessage(dependencies.config.allowedChatId, budget.reason, messageId);
    return { ...state, usage };
  }

  try {
    const result = await dependencies.requestAnswer({
      apiKey: dependencies.config.deepSeekApiKey,
      systemPrompt: CONSULTANT_SYSTEM_PROMPT,
      userPrompt: prompt,
      model: dependencies.config.deepSeekModel,
      maxOutputTokens: dependencies.config.maxOutputTokens,
      proxyUrls: dependencies.proxyUrls,
    });
    const nextState = {
      ...state,
      nextUpdateId: updateId + 1,
      usage: recordTokenUsage(usage, result.usage),
    };
    dependencies.persistState(dependencies.config.stateDirectory, nextState);
    rememberResponse(dependencies.cache, cacheKey, result.answer);
    try {
      await dependencies.telegram.sendMessage(dependencies.config.allowedChatId, result.answer, messageId);
    } catch (error) {
      (dependencies.logError ?? console.error)(
        "Telegram consultant could not deliver a completed answer:",
        safeError(error),
      );
    }
    return nextState;
  } catch (error) {
    await dependencies.telegram.sendMessage(
      dependencies.config.allowedChatId,
      `DeepSeek не смог ответить: ${safeError(error)}. Проверьте ключ, баланс и доступ к API.`,
      messageId,
    );
    return { ...state, usage };
  }
}

function commandResponse(
  command: string,
  usage: ConsultantDailyUsage,
  config: ConsultantConfig,
  report: ParserMonitorReport | null,
) {
  switch (command) {
    case "start":
    case "help":
      return [
        "TData Consultant — read-only помощник.",
        "/ask <вопрос> — спросить DeepSeek",
        "/status или /parsers — последний отчёт парсеров",
        "/docs — база знаний",
        "/budget — расход AI за сегодня",
        "Обычный текст также считается вопросом. Бот не меняет сервер и данные.",
      ].join("\n");
    case "status":
    case "parsers":
      return formatParserMonitorStatus(report);
    case "docs":
      return "База знаний: канонические README, архитектура, API policy, TLine, аудит турниров, Portainer и systemd runbook. Поиск локальный; в DeepSeek уходят только релевантные фрагменты.";
    case "budget": {
      const current = normalizeDailyUsage(usage);
      return [
        `AI-бюджет ${current.date} (Москва):`,
        `запросы ${current.requests}/${config.dailyBudget.maxRequestsPerDay}`,
        `вход ${current.promptTokens}/${config.dailyBudget.maxPromptTokensPerDay} токенов`,
        `выход ${current.completionTokens}/${config.dailyBudget.maxCompletionTokensPerDay} токенов`,
        `cache hit ${current.cacheHitTokens} токенов`,
      ].join("\n");
    }
    default:
      return "Неизвестная команда. Используйте /help.";
  }
}

function maxUpdateId(updates: readonly TelegramUpdate[]) {
  if (updates.length === 0) return null;
  return Math.max(...updates.map((update) => update.update_id));
}

function responseCacheKey(question: string, reportRunId: string) {
  return crypto.createHash("sha256")
    .update(`${question.trim().toLocaleLowerCase("ru-RU")}\n${reportRunId}`)
    .digest("hex");
}

function rememberResponse(cache: Map<string, string>, key: string, answer: string) {
  if (cache.size >= RESPONSE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, answer);
}

function safeError(error: unknown) {
  const text = error instanceof Error ? error.message : "неизвестная ошибка";
  return sanitizeExternalText(text).slice(0, 240) || "неизвестная ошибка";
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
