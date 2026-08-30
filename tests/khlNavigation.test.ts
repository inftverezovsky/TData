import assert from "node:assert/strict";
import test from "node:test";

import {
  KHL_EXTRA_MAPPING_DRAFTS,
  KHL_MATCH_TABS,
  KHL_RESULTS_TABS,
  KHL_ROOT_TABS,
  KHL_SETTINGS_TABS,
} from "../frontend/src/components/results/khl/khlNavigation";

test("KHL operator navigation keeps settings and results concerns separate", () => {
  assert.deepEqual(KHL_ROOT_TABS.map((tab) => [tab.id, tab.label]), [
    ["settings", "Настройки"],
    ["results", "Результаты"],
  ]);
  assert.deepEqual(KHL_SETTINGS_TABS.map((tab) => [tab.id, tab.label]), [
    ["teams-players", "Команды и игроки"],
    ["matches", "Матчи"],
    ["extras", "Допы"],
  ]);
  assert.deepEqual(KHL_RESULTS_TABS.map((tab) => [tab.id, tab.label]), [
    ["today", "Матчи сегодня"],
    ["daily", "Статистика игрового дня"],
    ["archive", "Архив"],
  ]);
  assert.deepEqual(KHL_MATCH_TABS.map((tab) => [tab.id, tab.label]), [
    ["overview", "Матч / допы"],
    ["players", "Игроки"],
    ["statistics", "Статистика"],
  ]);
});

test("future extra bindings are named but remain explicitly unconfigured", () => {
  assert.deepEqual(KHL_EXTRA_MAPPING_DRAFTS.map((item) => item.label), [
    "Гол раньше двухминутного удаления",
    "Удаление тренера",
    "Видеопросмотр",
    "Первый гол забьёт команда",
  ]);
  assert.equal(KHL_EXTRA_MAPPING_DRAFTS.every((item) => item.status === "PLANNED"), true);
});
