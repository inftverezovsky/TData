import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  TLINE_HELP_TABS,
  TLINE_NAV_ITEMS,
  isTLinePath,
} from "../frontend/src/components/tline/navigation";

test("TLine navigation exposes Line and Settings in the required order", () => {
  assert.deepEqual(TLINE_NAV_ITEMS, [
    { href: "/tline/line", label: "Линия" },
    { href: "/tline/settings", label: "Настройки" },
  ]);
  assert.equal(isTLinePath("/tline"), true);
  assert.equal(isTLinePath("/tline/line"), true);
  assert.equal(isTLinePath("/results/khl"), false);
});

test("help content is split into the two product-passport tabs", () => {
  assert.deepEqual(TLINE_HELP_TABS.map((tab) => tab.label), [
    "Как работает",
    "Статусы",
  ]);
});

test("TLine Settings exposes Shapka-scoped import and inline mapping controls", () => {
  const source = readFileSync(
    path.join(process.cwd(), "frontend", "src", "components", "tline", "TLineSettingsWorkspace.tsx"),
    "utf8",
  );
  assert.match(source, /Синхронизировать команды источника/);
  assert.match(source, /Глобальные шапки/);
  assert.match(source, /Справочник будет доступен всем чемпионатам/);
  for (const label of ["Редактировать", "Сохранить", "Отмена", "Подобрать автоматически", "Очистить"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /\/api\/tline\/championships\/\$\{encodeURIComponent\(selectedChampionshipId\)\}\/team-mappings/);
});

test("TLine Line exposes history and the compact manual decision controls", () => {
  const workspace = readFileSync(
    path.join(process.cwd(), "frontend", "src", "components", "tline", "TLineWorkspace.tsx"),
    "utf8",
  );
  const decisionMenu = readFileSync(
    path.join(process.cwd(), "frontend", "src", "components", "tline", "TLineDecisionMenu.tsx"),
    "utf8",
  );
  const source = `${workspace}\n${decisionMenu}`;
  for (const label of [
    "История запусков",
    "Включать матчи без даты",
    "Подтвердить OK вручную",
    "Отметить ошибкой вручную",
    "Считать события одним матчем",
    "Игнорировать до",
    "Не сравнивать это событие",
    "Сбросить ручное решение",
  ]) {
    assert.match(source, new RegExp(label));
  }
});
