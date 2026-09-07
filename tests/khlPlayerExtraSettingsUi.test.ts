import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KhlSettingsWorkspace } from "../frontend/src/components/results/khl/KhlSettingsWorkspace";
import type { SettingsDirectory } from "../frontend/src/components/results/khl/types";
import {
  formatKhlPlayerExtraLabel,
  KHL_PLAYER_EXTRA_DEFINITIONS,
} from "../backend/src/results/khl/playerExtras";

test("renders nine permanent extra bindings nested inside a team player", () => {
  const playerName = "Александр Радулов";
  const directory: SettingsDirectory = {
    teams: [{
      khlTeamId: "34",
      name: "Локомотив",
      location: null,
      adminTeamId: "admin-team-34",
      adminBindingStatus: "CONFIRMED",
      matchCount: 2,
      statBindings: [],
    }],
    players: [{
      khlPlayerId: "123",
      name: playerName,
      role: "F",
      adminPlayerId: "admin-player-123",
      adminBindingStatus: "CONFIRMED",
      matchCount: 2,
      extraBindings: KHL_PLAYER_EXTRA_DEFINITIONS.map((definition) => ({
        extraCode: definition.code,
        label: formatKhlPlayerExtraLabel(playerName, definition.code),
        adminExtraId: null,
        adminExtraName: null,
        adminBindingStatus: "UNMAPPED",
        adminConfirmedAt: null,
        adminConfirmedBy: null,
      })),
      recentAppearance: {
        khlGameId: "901973",
        startsAt: "2026-09-05T14:00:00.000Z",
        team: { khlTeamId: "34", name: "Локомотив" },
        adminMatchPlayerId: null,
        adminBindingStatus: "UNMAPPED",
      },
    }],
    statMappings: [],
  };

  const noop = () => undefined;
  const html = renderToStaticMarkup(createElement(KhlSettingsWorkspace, {
    directory,
    matches: [],
    stages: [],
    stageId: "",
    from: "2026-05-01",
    to: "2026-09-06",
    events: [],
    loading: false,
    busyKey: null,
    bindingValues: {},
    matchCandidateJson: {},
    targetJson: {},
    targetLabels: {},
    previews: {},
    diffs: {},
    onStageIdChange: noop,
    onFromChange: noop,
    onToChange: noop,
    onLoadSchedule: noop,
    onIngest: noop,
    onBindingValueChange: noop,
    onExtraBindingNameChange: noop,
    onMatchCandidateChange: noop,
    onTargetJsonChange: noop,
    onSaveTeam: noop,
    onSaveTeamStats: noop,
    onSavePlayer: noop,
    onSavePlayerExtra: noop,
    onSaveMatch: noop,
    onLoadTargetTemplate: noop,
    onSaveTargetBindings: noop,
    onConfirmTargetPlayer: noop,
    onLoadPreview: noop,
    onLoadDiff: noop,
    onStageDelivery: noop,
  }));

  assert.equal((html.match(/data-testid="khl-player-extra-bindings"/g) || []).length, 1);
  assert.match(html, /Допы игрока/);
  for (const definition of KHL_PLAYER_EXTRA_DEFINITIONS) {
    assert.match(html, new RegExp(formatKhlPlayerExtraLabel(playerName, definition.code)));
  }
});
