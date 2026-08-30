export const TLINE_NAV_ITEMS = [
  { href: "/tline/line", label: "Линия" },
  { href: "/tline/settings", label: "Настройки" },
] as const;

export const TLINE_HELP_TABS = [
  { id: "how", label: "Как работает" },
  { id: "statuses", label: "Статусы" },
] as const;

export type TLineHelpTab = (typeof TLINE_HELP_TABS)[number]["id"];

export function isTLinePath(pathname: string) {
  return pathname === "/tline" || pathname.startsWith("/tline/");
}
