import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { emptyDailyUsage } from "../backend/src/consultant/budget";
import { readConsultantConfig } from "../backend/src/consultant/config";
import { createKnowledgeIndex } from "../backend/src/consultant/knowledge";
import {
  processConsultantUpdate,
  runTelegramConsultant,
} from "../backend/src/consultant/runner";
import {
  emptyState,
  persistConsultantState,
  readConsultantState,
} from "../backend/src/consultant/state";
import type { TelegramUpdate } from "../backend/src/consultant/telegramBotApi";

test("consultant state persists only offsets, usage, and heartbeat", () => {
  const directory = temporaryDirectory();
  const state = {
    ...emptyState(new Date("2026-09-01T10:00:00+03:00")),
    nextUpdateId: 88,
    lastPollAt: "2026-09-01T07:00:00.000Z",
  } as const;
  persistConsultantState(directory, state);
  const content = fs.readFileSync(path.join(directory, "state.json"), "utf8");
  assert.doesNotMatch(content, /question|answer|api.?key/i);
  assert.deepEqual(readConsultantState(directory, new Date("2026-09-01T11:00:00+03:00")), state);
});

test("consultant answers once, records real usage, and caches repeated questions in memory", async () => {
  const directory = temporaryDirectory();
  const config = consultantConfig(directory);
  const sent: string[] = [];
  let aiCalls = 0;
  const cache = new Map<string, string>();
  const dependencies = {
    config,
    knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# HLTV\nHLTV imports Counter-Strike tournaments." }]),
    cache,
    telegram: telegramStub({ send: (text) => sent.push(text) }),
    proxyUrls: [],
    readMonitor: () => null,
    requestAnswer: async () => {
      aiCalls += 1;
      return {
        answer: "Факт: свежего monitor-отчёта нет. Предположение: источник недоступен.",
        finishReason: "stop",
        usage: { promptTokens: 200, completionTokens: 40, cacheHitTokens: 100 },
      };
    },
    persistState: persistConsultantState,
  };
  const update = questionUpdate(1, "Почему не работает HLTV?");
  const first = await processConsultantUpdate(update, emptyState(new Date()), dependencies);
  const second = await processConsultantUpdate(update, first, dependencies);

  assert.equal(aiCalls, 1);
  assert.equal(first.usage.requests, 1);
  assert.equal(first.usage.promptTokens, 200);
  assert.equal(second.usage.requests, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /кэша/i);
});

test("a paid answer advances the persisted offset even when Telegram delivery fails", async () => {
  const directory = temporaryDirectory();
  const config = consultantConfig(directory);
  const result = await processConsultantUpdate(questionUpdate(70, "Почему сломан импорт?"), emptyState(new Date()), {
    config,
    knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# Import\nImports are validated." }]),
    cache: new Map(),
    telegram: telegramStub({ send: () => { throw new Error("network failure"); } }),
    proxyUrls: [],
    readMonitor: () => null,
    requestAnswer: async () => ({
      answer: "Проверьте свежий monitor report.",
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 20, cacheHitTokens: 0 },
    }),
    persistState: persistConsultantState,
    logError: () => undefined,
  });

  assert.equal(result.nextUpdateId, 71);
  assert.equal(readConsultantState(directory).nextUpdateId, 71);
  assert.equal(result.usage.requests, 1);
});

test("consultant refuses an AI request when the daily request budget is exhausted", async () => {
  const directory = temporaryDirectory();
  const config = consultantConfig(directory);
  let aiCalls = 0;
  const sent: string[] = [];
  const state = {
    ...emptyState(new Date()),
    usage: {
      ...emptyDailyUsage(new Date()),
      requests: config.dailyBudget.maxRequestsPerDay,
    },
  };
  const result = await processConsultantUpdate(questionUpdate(3, "Что сломано?"), state, {
    config,
    knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# TData\nTournament parsers." }]),
    cache: new Map(),
    telegram: telegramStub({ send: (text) => sent.push(text) }),
    proxyUrls: [],
    readMonitor: () => null,
    requestAnswer: async () => {
      aiCalls += 1;
      throw new Error("must not run");
    },
    persistState: persistConsultantState,
  });

  assert.equal(aiCalls, 0);
  assert.equal(result.usage.requests, config.dailyBudget.maxRequestsPerDay);
  assert.match(sent[0], /дневной лимит/i);
});

test("free commands, empty ask, oversized input, and AI errors stay bounded", async () => {
  const directory = temporaryDirectory();
  const config = consultantConfig(directory);
  const sent: string[] = [];
  const baseDependencies = {
    config,
    knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# TData\nDocs." }]),
    cache: new Map<string, string>(),
    telegram: telegramStub({ send: (text) => sent.push(text) }),
    proxyUrls: [] as string[],
    readMonitor: () => null,
    requestAnswer: async () => { throw new Error("DeepSeek API failed with HTTP 402"); },
    persistState: persistConsultantState,
  };
  let state = emptyState(new Date());
  for (const [id, command] of [[20, "/help"], [21, "/status"], [22, "/docs"], [23, "/unknown"], [24, "/ask"]] as const) {
    state = await processConsultantUpdate(questionUpdate(id, command), state, baseDependencies);
  }
  state = await processConsultantUpdate(questionUpdate(25, "x".repeat(1_501)), state, baseDependencies);
  state = await processConsultantUpdate(questionUpdate(26, "Почему API недоступен?"), state, baseDependencies);

  assert.equal(state.usage.requests, 0);
  assert.equal(sent.length, 7);
  assert.match(sent[0], /read-only/i);
  assert.match(sent[1], /отсутствует/i);
  assert.match(sent[2], /База знаний/i);
  assert.match(sent[3], /Неизвестная команда/i);
  assert.match(sent[4], /Использование/i);
  assert.match(sent[5], /слишком длинный/i);
  assert.match(sent[6], /HTTP 402/);
});

test("runner rejects a configured webhook instead of mutating Telegram settings", async () => {
  const directory = temporaryDirectory();
  await assert.rejects(
    runTelegramConsultant({ config: consultantConfig(directory) }, {
      telegram: telegramStub({ webhookUrl: "https://example.invalid/hook" }),
      knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# TData\nDocs." }]),
    }),
    /webhook/i,
  );
});

test("runner discards the old backlog, handles a free command, and persists the next offset", async () => {
  const directory = temporaryDirectory();
  const controller = new AbortController();
  const sent: string[] = [];
  let polls = 0;
  const telegram = telegramStub({
    getUpdates: async () => {
      polls += 1;
      if (polls === 1) return [];
      return [{
        update_id: 11,
        message: { message_id: 7, chat: { id: 42 }, from: { id: 8, is_bot: false }, text: "/budget" },
      }];
    },
    send: (text) => {
      sent.push(text);
      controller.abort();
    },
  });

  await runTelegramConsultant({ config: consultantConfig(directory), signal: controller.signal }, {
    telegram,
    knowledgeIndex: createKnowledgeIndex([{ source: "README.md", text: "# TData\nDocs." }]),
  });

  assert.equal(polls, 2);
  assert.match(sent[0], /AI-бюджет/);
  assert.equal(readConsultantState(directory).nextUpdateId, 12);
});

function consultantConfig(directory: string) {
  return readConsultantConfig({
    TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN: "12345:TEST",
    TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID: "42",
    TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY: "test-key",
    TDATA_TELEGRAM_CONSULTANT_STATE_DIR: directory,
    TDATA_PARSER_MONITOR_DIR: path.join(directory, "monitor"),
  });
}

function questionUpdate(updateId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: 42 }, from: { id: 8, is_bot: false }, text },
  };
}

function telegramStub(options: {
  webhookUrl?: string;
  getUpdates?: () => Promise<TelegramUpdate[]>;
  send?: (text: string) => void;
} = {}) {
  return {
    getWebhookInfo: async () => ({ url: options.webhookUrl || "" }),
    getUpdates: options.getUpdates ?? (async () => []),
    sendMessage: async (_chatId: string, text: string) => {
      options.send?.(text);
    },
  };
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tdata-consultant-test-"));
}
