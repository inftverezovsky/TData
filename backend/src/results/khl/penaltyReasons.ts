export const KHL_PENALTY_REASON_DEFINITIONS = [
  { code: "tripping", label: "Подножка (Tripping)" },
  { code: "interference", label: "Атака игрока, не владеющего шайбой (Interf., Interf. on goalkeeper)" },
  { code: "roughing", label: "Грубая игра (Roughing)" },
  { code: "hooking", label: "Задержка клюшкой (Hooking)" },
  { code: "holding", label: "Задержка соперника, задержка клюшки (Holding, Holding the stick)" },
  { code: "high_sticking", label: "Игра высоко поднятой клюшкой (High Sticking)" },
  { code: "cross_checking", label: "Толчок клюшкой (Cross Checking)" },
  { code: "slashing", label: "Удар клюшкой (Slashing)" },
  { code: "kneeing", label: "Удар коленом (Kneeing)" },
  { code: "too_many_players", label: "Нарушение численного состава (Too many players)" },
  { code: "other_or_none", label: "Любое другое или нет удаления" },
  { code: "tripping_interference", label: "Подножка/Атака игрока" },
  { code: "tripping_roughing", label: "Подножка/Грубая игра" },
  { code: "tripping_hooking", label: "Подножка/Задержка клюшкой" },
  { code: "tripping_holding", label: "Подножка/Задержка соперника" },
] as const;

export type KhlPenaltyReasonCode = typeof KHL_PENALTY_REASON_DEFINITIONS[number]["code"];

const REASON_ALIASES: Record<KhlPenaltyReasonCode, readonly string[]> = {
  tripping: ["подножка", "tripping"],
  interference: ["блокировка", "атака игрока", "атака игрока, не владеющего шайбой", "атака вратаря", "помеха вратарю", "блокировка вратаря", "interference", "interf.", "interference on goalkeeper", "interf. on goalkeeper", "goalkeeper interference"],
  roughing: ["грубость", "грубая игра", "roughing"],
  hooking: ["задержка соперника клюшкой", "задержка клюшкой", "hooking"],
  holding: ["задержка соперника", "задержка клюшки", "задержка клюшки соперника", "задержка соперника, задержка клюшки", "holding", "holding the stick"],
  high_sticking: ["игра высоко поднятой клюшкой", "опасная игра высоко поднятой клюшкой", "high sticking"],
  cross_checking: ["толчок клюшкой", "cross checking"],
  slashing: ["удар клюшкой", "slashing"],
  kneeing: ["удар коленом", "kneeing"],
  too_many_players: ["нарушение численного состава", "too many players", "too many men", "too many men on the ice"],
  other_or_none: ["любое другое или нет удаления"],
  tripping_interference: ["подножка/атака игрока", "подножка/блокировка", "tripping/interference"],
  tripping_roughing: ["подножка/грубая игра", "подножка/грубость", "tripping/roughing"],
  tripping_hooking: ["подножка/задержка клюшкой", "подножка/задержка соперника клюшкой", "tripping/hooking"],
  tripping_holding: ["подножка/задержка соперника", "tripping/holding"],
};

function normalizeReason(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\([^)]*\)/g, "")
    .replace(/[-‐‑–]/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

export function classifyKhlPenaltyReason(reason: string): KhlPenaltyReasonCode | null {
  const normalized = normalizeReason(reason);
  if (!normalized) return null;
  return KHL_PENALTY_REASON_DEFINITIONS.find((definition) =>
    REASON_ALIASES[definition.code].includes(normalized)
  )?.code ?? "other_or_none";
}

export function isKhlGameMisconductReason(reason: string) {
  return ["дисциплинарный штраф до конца игры", "дисциплинарный штраф до конца матча", "game misconduct"]
    .includes(normalizeReason(reason));
}

export function formatKhlPenaltyReason(code: KhlPenaltyReasonCode) {
  return KHL_PENALTY_REASON_DEFINITIONS.find((definition) => definition.code === code)!.label;
}
