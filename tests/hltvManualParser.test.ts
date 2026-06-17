import test from "node:test";
import assert from "node:assert/strict";
import { parseHltvCopiedText } from "../backend/src/sources/tdata/hltv/manualTextParser";

test("parseHltvCopiedText parses duplicate HLTV copied team lines", () => {
  const matches = parseHltvCopiedText(`
Saturday - 2026-05-09
17:00
bo3
Nemiga
Nemiga
INOX Division
INOX Division
20:00
bo3
AM
AM
CYBERSHOKE
CYBERSHOKE
`);

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => [match.team1, match.team2, match.date]), [
    ["Nemiga", "INOX Division", "09.05.2026 17:00:00"],
    ["AM", "CYBERSHOKE", "09.05.2026 20:00:00"],
  ]);
});

test("parseHltvCopiedText handles OCR time/team and bo/team lines", () => {
  const matches = parseHltvCopiedText(`
Sunday - 2026-05-10
17:00 | ® Falcons
bo3 © 9z
`);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].team1, "Falcons");
  assert.equal(matches[0].team2, "9z");
  assert.equal(matches[0].date, "10.05.2026 17:00:00");
});

test("parseHltvCopiedText handles Russian table OCR lists", () => {
  const matches = parseHltvCopiedText(`
Волин Лев
Гусев Арсений
23 моя, 16:10 | Стол 1
Волошин Александр
Раднаев Батор
23 ман, 16:10 | Стол 2
Никулин Иван
Макаров Владислав
23 мая, 16:10 | Стол 3
Кондратьев Иван
Тихонов Евгений
23 моя, 16:10 | Стол 4
`);

  assert.equal(matches.length, 4);
  assert.deepEqual(matches.map((match) => [match.team1, match.team2, match.date]), [
    ["Волин Лев", "Гусев Арсений", "23.05.2026 16:10:00"],
    ["Волошин Александр", "Раднаев Батор", "23.05.2026 16:10:00"],
    ["Никулин Иван", "Макаров Владислав", "23.05.2026 16:10:00"],
    ["Кондратьев Иван", "Тихонов Евгений", "23.05.2026 16:10:00"],
  ]);
});

test("parseHltvCopiedText handles English table schedules", () => {
  const matches = parseHltvCopiedText(`
Team Liquid
G2 Esports
23 May, 16:10 | Table 1
NAVI
FaZe Clan
23 May, 18:30 | Table 2
`);

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => [match.team1, match.team2, match.date]), [
    ["Team Liquid", "G2 Esports", "23.05.2026 16:10:00"],
    ["NAVI", "FaZe Clan", "23.05.2026 18:30:00"],
  ]);
});

test("parseHltvCopiedText handles inline Team A vs Team B rows", () => {
  const matches = parseHltvCopiedText(`
May 24 2026
16:10 Team Spirit vs Virtus.pro
18:30 Team Falcons v. GamerLegion
`);

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => [match.team1, match.team2, match.date]), [
    ["Team Spirit", "Virtus.pro", "24.05.2026 16:10:00"],
    ["Team Falcons", "GamerLegion", "24.05.2026 18:30:00"],
  ]);
});

test("parseHltvCopiedText tolerates mixed OCR artifacts", () => {
  const matches = parseHltvCopiedText(`
● Sangal Esports ®
□ 9INE
May 25, 2026 14:00 | Tbl 3
✓ Aurora Gaming
© BetBoom Team
15:30 | Table 4
`);

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => [match.team1, match.team2, match.date]), [
    ["Sangal Esports", "9INE", "25.05.2026 14:00:00"],
    ["Aurora Gaming", "BetBoom Team", "25.05.2026 15:30:00"],
  ]);
});
