export const KHL_ROOT_TABS = [
  { id: "settings", label: "Настройки" },
  { id: "results", label: "Результаты" },
] as const;

export const KHL_SETTINGS_TABS = [
  { id: "teams-players", label: "Команды и игроки" },
  { id: "matches", label: "Матчи" },
  { id: "extras", label: "Допы" },
] as const;

export const KHL_RESULTS_TABS = [
  { id: "today", label: "Матчи сегодня" },
  { id: "daily", label: "Статистика игрового дня" },
  { id: "archive", label: "Архив" },
] as const;

export const KHL_MATCH_TABS = [
  { id: "overview", label: "Матч / допы" },
  { id: "players", label: "Игроки" },
  { id: "statistics", label: "Статистика" },
] as const;

export const KHL_EXTRA_MAPPING_DRAFTS = [
  { id: "early_goal_after_minor", label: "Гол раньше двухминутного удаления", status: "PLANNED" },
  { id: "coach_penalty", label: "Удаление тренера", status: "PLANNED" },
  { id: "video_review", label: "Видеопросмотр", status: "PLANNED" },
  { id: "first_team_goal", label: "Первый гол забьёт команда", status: "PLANNED" },
] as const;

export type KhlRootTab = typeof KHL_ROOT_TABS[number]["id"];
export type KhlSettingsTab = typeof KHL_SETTINGS_TABS[number]["id"];
export type KhlResultsTab = typeof KHL_RESULTS_TABS[number]["id"];
export type KhlMatchTab = typeof KHL_MATCH_TABS[number]["id"];
