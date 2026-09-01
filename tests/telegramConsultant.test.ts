import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildConsultantUserPrompt,
  classifyConsultantUpdate,
  formatParserMonitorStatus,
  sanitizeExternalText,
} from "../backend/src/consultant/consultant";
import {
  checkTokenBudget,
  DEFAULT_CONSULTANT_TOKEN_BUDGET,
  estimateDeepSeekTokens,
  normalizeDailyUsage,
  recordTokenUsage,
} from "../backend/src/consultant/budget";
import { readConsultantConfig } from "../backend/src/consultant/config";
import { requestDeepSeekAnswer } from "../backend/src/consultant/deepseek";
import {
  CONSULTANT_DOCUMENT_PATHS,
  createKnowledgeIndex,
  retrieveKnowledge,
} from "../backend/src/consultant/knowledge";
import { createTelegramBotClient } from "../backend/src/consultant/telegramBotApi";
import type { ParserMonitorReport } from "../backend/src/monitoring/parserMonitorTypes";

test("consultant retrieves only the most relevant bounded documentation chunks", () => {
  const index = createKnowledgeIndex([
    {
      source: "docs/ARCHITECTURE.md",
      text: "# Architecture\nAPI routes stay thin. Backend owns integrations and domain logic.",
    },
    {
      source: "docs/TLINE.md",
      text: "# TLine\nThe scheduler stays disabled until TLINE_ENABLED and TLINE_SCHEDULER_READY are enabled.\n\n## Safety\nTLine is fail-closed.",
    },
  ]);

  const matches = retrieveKnowledge(index, "Почему планировщик TLine отключён?", {
    maxChunks: 1,
    maxCharacters: 180,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, "docs/TLINE.md");
  assert.ok(matches[0].text.length <= 180);
  assert.match(matches[0].heading, /TLine/i);
});

test("consultant knowledge allowlist contains canonical docs and excludes instruction or secret files", () => {
  assert.ok(CONSULTANT_DOCUMENT_PATHS.includes("README.md"));
  assert.ok(CONSULTANT_DOCUMENT_PATHS.includes("docs/ARCHITECTURE.md"));
  assert.ok(CONSULTANT_DOCUMENT_PATHS.includes("deploy/systemd/README.md"));
  assert.ok(CONSULTANT_DOCUMENT_PATHS.every((source) => !/AGENTS|\.env|KHL_HANDOFF/i.test(source)));
});

test("consultant prompt stays bounded, cites sources, and labels live evidence separately", () => {
  const prompt = buildConsultantUserPrompt({
    question: "Почему HLTV не загрузил матчи?",
    monitorContext: "Последний monitor: hltv failed/cloudflare_block.",
    knowledge: [{
      source: "docs/API_POLICY.md",
      heading: "Rate limiting",
      text: "HLTV Playwright tasks are queued.",
      score: 3,
    }],
    maxCharacters: 900,
  });

  assert.ok(prompt.length <= 900);
  assert.match(prompt, /Вопрос оператора/);
  assert.match(prompt, /Живые диагностические данные/);
  assert.match(prompt, /docs\/API_POLICY\.md — Rate limiting/);
  assert.match(prompt, /предположение/i);
});

test("consultant redacts credentials before external context is assembled", () => {
  const sanitized = sanitizeExternalText([
    "token=super-secret-value",
    "12345:ABCDEFGHIJKLMNOPQRST",
    "sk-abcdefghijklmnopqrstuv",
    "http://alice:password@proxy.example:8080",
  ].join(" "));
  assert.doesNotMatch(sanitized, /super-secret|ABCDEFGHIJKLMNOP|abcdefghijklmnopqrstuv|alice:password/);
  assert.match(sanitized, /REDACTED/);
});

test("daily token budget resets by Moscow date and updates immutably", () => {
  const previous = {
    date: "2026-08-31",
    requests: 12,
    promptTokens: 30_000,
    completionTokens: 5_000,
    cacheHitTokens: 1_000,
  };
  const current = normalizeDailyUsage(previous, new Date("2026-09-01T00:10:00+03:00"));
  assert.deepEqual(current, {
    date: "2026-09-01",
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
  });
  assert.equal(previous.requests, 12);

  const recorded = recordTokenUsage(current, {
    promptTokens: 600,
    completionTokens: 120,
    cacheHitTokens: 300,
  });
  assert.equal(recorded.requests, 1);
  assert.equal(recorded.promptTokens, 600);
  assert.equal(recorded.completionTokens, 120);
  assert.equal(recorded.cacheHitTokens, 300);
  assert.equal(current.requests, 0);
});

test("token budget rejects calls before they can exceed daily or per-answer limits", () => {
  const usage = {
    date: "2026-09-01",
    requests: DEFAULT_CONSULTANT_TOKEN_BUDGET.maxRequestsPerDay,
    promptTokens: 1,
    completionTokens: 1,
    cacheHitTokens: 0,
  };
  assert.equal(checkTokenBudget(usage, DEFAULT_CONSULTANT_TOKEN_BUDGET, 100).allowed, false);
  assert.ok(estimateDeepSeekTokens("короткий вопрос") > 0);
  assert.equal(DEFAULT_CONSULTANT_TOKEN_BUDGET.maxOutputTokensPerAnswer, 450);
});

test("DeepSeek client uses the fixed economical non-thinking request and returns usage", async () => {
  let calls = 0;
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const result = await requestDeepSeekAnswer({
    apiKey: "test-deepseek-key",
    systemPrompt: "stable system prompt",
    userPrompt: "question and selected docs",
    model: "deepseek-v4-flash",
    maxOutputTokens: 450,
    proxyUrls: ["http://user:password@proxy.example:8080"],
  }, {
    proxyAgentFactory: () => ({ kind: "proxy" }) as never,
    sleep: async () => undefined,
    fetchImpl: async (url, init) => {
      calls += 1;
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (calls === 1) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Проверьте Cloudflare-маркер." } }],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 80,
          prompt_cache_hit_tokens: 300,
          prompt_cache_miss_tokens: 200,
          total_tokens: 580,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(calls, 2);
  assert.equal(capturedUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(capturedHeaders.Authorization, "Bearer test-deepseek-key");
  assert.equal(capturedBody.model, "deepseek-v4-flash");
  assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  assert.equal(capturedBody.max_tokens, 450);
  assert.equal(capturedBody.stream, false);
  assert.equal(result.answer, "Проверьте Cloudflare-маркер.");
  assert.deepEqual(result.usage, {
    promptTokens: 500,
    completionTokens: 80,
    cacheHitTokens: 300,
  });
});

test("DeepSeek permanent errors fail once without leaking the API key", async () => {
  let calls = 0;
  await assert.rejects(
    requestDeepSeekAnswer({
      apiKey: "test-secret-deepseek-key",
      systemPrompt: "system",
      userPrompt: "question",
    }, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "bad key test-secret-deepseek-key" } }), { status: 401 });
      },
    }),
    (error: unknown) => {
      assert.match(String(error), /HTTP 401/);
      assert.doesNotMatch(String(error), /test-secret-deepseek-key|bad key/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("DeepSeek validates an empty key and reports a bounded empty response", async () => {
  await assert.rejects(requestDeepSeekAnswer({
    apiKey: " ",
    systemPrompt: "system",
    userPrompt: "question",
  }), /required/i);
  await assert.rejects(requestDeepSeekAnswer({
    apiKey: "test-key",
    systemPrompt: "system",
    userPrompt: "question",
  }, {
    sleep: async () => undefined,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }), /empty answer/i);
});

test("Telegram client long-polls through a proxy first and confirms offsets", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; proxied: boolean }> = [];
  const client = createTelegramBotClient({
    botToken: "12345:TEST",
    proxyUrls: ["http://user:password@proxy.example:8080"],
  }, {
    proxyAgentFactory: () => ({ kind: "proxy" }) as never,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        proxied: Boolean((init as RequestInit & { agent?: unknown })?.agent),
      });
      return new Response(JSON.stringify({
        ok: true,
        result: [{ update_id: 77, message: { message_id: 5, chat: { id: 42 }, text: "/status" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const updates = await client.getUpdates({ offset: 77, timeoutSeconds: 25 });
  assert.equal(updates[0].update_id, 77);
  assert.equal(calls[0].proxied, true);
  assert.match(calls[0].url, /\/getUpdates$/);
  assert.equal(calls[0].body.offset, 77);
  assert.deepEqual(calls[0].body.allowed_updates, ["message"]);
});

test("Telegram client retries transient proxy failures and supports webhook and bounded messages", async () => {
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  const client = createTelegramBotClient({
    botToken: "12345:TEST",
    proxyUrls: ["http://user:password@proxy.example:8080"],
  }, {
    proxyAgentFactory: () => ({ kind: "proxy" }) as never,
    fetchImpl: async (url, init) => {
      calls += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (calls === 1) return new Response("{}", { status: 500 });
      if (String(url).endsWith("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: "", pending_update_count: 0 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    },
  });

  assert.equal((await client.getWebhookInfo()).url, "");
  await client.sendMessage("42", "x".repeat(4_000), 9);
  assert.equal(calls, 3);
  assert.equal(String(bodies[2].text).length, 3_500);
  assert.equal(bodies[2].reply_to_message_id, 9);
});

test("Telegram permanent HTTP errors do not expose the bot token or retry", async () => {
  let calls = 0;
  const client = createTelegramBotClient({ botToken: "12345:VERY-SECRET" }, {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ description: "bad 12345:VERY-SECRET" }), { status: 401 });
    },
  });
  await assert.rejects(client.getWebhookInfo(), (error: unknown) => {
    assert.match(String(error), /HTTP 401/);
    assert.doesNotMatch(String(error), /VERY-SECRET|bad/);
    return true;
  });
  assert.equal(calls, 1);
});

test("consultant accepts only the configured human chat and bounds questions", () => {
  const authorized = classifyConsultantUpdate({
    update_id: 1,
    message: { message_id: 9, chat: { id: 42 }, from: { id: 7, is_bot: false }, text: "Почему сломан HLTV?" },
  }, "42", 1_500);
  assert.equal(authorized.kind, "question");

  const command = classifyConsultantUpdate({
    update_id: 2,
    message: { message_id: 10, chat: { id: 42 }, from: { id: 7, is_bot: false }, text: "/status" },
  }, "42", 1_500);
  assert.deepEqual(command, { kind: "command", command: "status", argument: "", messageId: 10 });

  const unauthorized = classifyConsultantUpdate({
    update_id: 3,
    message: { message_id: 11, chat: { id: 99 }, from: { id: 8, is_bot: false }, text: "secret" },
  }, "42", 1_500);
  assert.deepEqual(unauthorized, { kind: "ignore" });

  const botMessage = classifyConsultantUpdate({
    update_id: 4,
    message: { message_id: 12, chat: { id: 42 }, from: { id: 8, is_bot: true }, text: "loop" },
  }, "42", 1_500);
  assert.deepEqual(botMessage, { kind: "ignore" });

  const tooLong = classifyConsultantUpdate({
    update_id: 5,
    message: { message_id: 13, chat: { id: 42 }, from: { id: 7, is_bot: false }, text: "x".repeat(1_501) },
  }, "42", 1_500);
  assert.equal(tooLong.kind, "too_long");
});

test("consultant config is economical by default and validates secrets and model", () => {
  const config = readConsultantConfig({
    TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN: "12345:TEST",
    TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID: "-10042",
    TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY: "test-key",
  });
  assert.equal(config.deepSeekModel, "deepseek-v4-flash");
  assert.equal(config.maxOutputTokens, 450);
  assert.equal(config.dailyBudget.maxRequestsPerDay, 12);
  assert.equal(config.allowedChatId, "-10042");

  assert.throws(() => readConsultantConfig({}), /required/i);
  assert.throws(() => readConsultantConfig({
    TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN: "12345:TEST",
    TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID: "42",
    TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY: "test-key",
    TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_MODEL: "deepseek-v4-pro",
  }), /model/i);
  assert.throws(() => readConsultantConfig({
    TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN: "12345:TEST",
    TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID: "42",
    TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY: "test-key",
    TDATA_TELEGRAM_CONSULTANT_MAX_REQUESTS_PER_DAY: "0",
  }), /between/i);
});

test("parser status distinguishes healthy empty results and failures", () => {
  const text = formatParserMonitorStatus(sampleMonitorReport());
  assert.match(text, /21/);
  assert.match(text, /healthy_empty/i);
  assert.match(text, /hltv.*cloudflare_block/i);
});

test("consultant deployment is isolated, read-only in behavior, and ships canonical docs", () => {
  const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
  const compose = fs.readFileSync(path.join(process.cwd(), "deploy", "compose", "tdata-telegram-consultant.yml"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };

  assert.match(dockerfile, /\/app\/docs \.\/docs/);
  assert.match(dockerfile, /\/app\/README\.md \.\/README\.md/);
  assert.match(compose, /container_name:\s+tdata-telegram-consultant/);
  assert.match(compose, /TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY/);
  assert.doesNotMatch(compose, /ports:/);
  assert.equal(packageJson.scripts["consultant:telegram"], "tsx scripts/telegram-consultant.ts");
});

function sampleMonitorReport(): ParserMonitorReport {
  return {
    schemaVersion: 1,
    runId: "2026-09-01T12-00-00-000Z",
    startedAt: "2026-09-01T12:00:00.000Z",
    finishedAt: "2026-09-01T12:01:00.000Z",
    durationMs: 60_000,
    results: [
      {
        id: "hltv:counterstrike",
        source: "hltv",
        scope: "counterstrike",
        hostname: "www.hltv.org",
        required: true,
        status: "failed",
        errorClass: "cloudflare_block",
        summary: "HLTV challenge",
        rawCandidates: 0,
        normalizedItems: 0,
        detailChecked: false,
        cacheHit: false,
        stale: false,
        attempts: 3,
        durationMs: 10_000,
        checkedAt: "2026-09-01T12:01:00.000Z",
      },
      {
        id: "dltv:dota2",
        source: "dltv",
        scope: "dota2",
        hostname: "dltv.org",
        required: true,
        status: "healthy_empty",
        errorClass: null,
        summary: "No active season",
        rawCandidates: 1,
        normalizedItems: 0,
        detailChecked: true,
        cacheHit: false,
        stale: false,
        attempts: 1,
        durationMs: 100,
        checkedAt: "2026-09-01T12:01:00.000Z",
      },
    ],
    summary: { total: 21, healthy: 19, healthyEmpty: 1, warning: 0, failed: 1 },
    exitCode: 1,
  };
}
