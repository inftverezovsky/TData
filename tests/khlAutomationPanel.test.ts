import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KhlAutomationPanel } from "../frontend/src/components/results/khl/KhlAutomationPanel";
import type { AutomationStatus } from "../frontend/src/components/results/khl/types";

const now = new Date("2026-09-05T18:00:00Z");
function status(values: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    configured: true, paused: false, enabled: true, cutoff: "2026-04-30T21:00:00Z",
    intervalMinutes: 10, lastFetchedAt: "2026-08-21T11:15:00Z",
    workerHeartbeatAt: now.toISOString(), lastAttemptAt: now.toISOString(),
    lastSuccessAt: now.toISOString(), lastChangedAt: "2026-08-21T11:15:00Z",
    nextRunAt: "2026-09-05T18:10:00Z", latestRun: null, activeRun: null,
    bootstrapCompletedAt: now.toISOString(), ...values,
  };
}
function render(automation: AutomationStatus) {
  return renderToStaticMarkup(createElement(KhlAutomationPanel, {
    automation, busyKey: null, onToggle: () => {}, now,
  }));
}

test("automation separates successful source checks from unchanged data", () => {
  const html = render(status());
  assert.match(html, /Последняя проверка источника/);
  assert.match(html, /Последний успешный проход/);
  assert.match(html, /Последнее изменение данных/);
  assert.match(html, /05\.09\.2026/);
  assert.match(html, /21\.08\.2026/);
  assert.match(html, /Остановить автопарсинг/);
});

test("stale worker is not presented as working automatic collection", () => {
  const html = render(status({ workerHeartbeatAt: "2026-09-05T17:00:00Z" }));
  assert.match(html, /Нет связи с фоновым сборщиком/);
  assert.doesNotMatch(html, /Фоновый сборщик работает/);
});

test("paused collection clearly permits manual collection", () => {
  const html = render(status({ paused: true, enabled: false }));
  assert.match(html, /Автопарсинг остановлен/);
  assert.match(html, /Ручной сбор доступен/);
  assert.match(html, /Включить автопарсинг/);
});
