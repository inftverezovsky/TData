"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Главная" },
  { href: "/dota2", label: "Dota 2" },
  { href: "/counterstrike", label: "Counter-Strike" },
  { href: "/leagueoflegends", label: "League of Legends" },
  { href: "/valorant", label: "Valorant" },
  { href: "/history", label: "История" }
];

const tbvolleyNavItems = [
  { href: "/tbvolley/volleyballworld", label: "VolleyballWorld" },
  { href: "/tbvolley/beachvolleyru", label: "beach.volley.ru" },
  { href: "/tbvolley/germanbeachtour", label: "German Beach Tour" },
  { href: "/tbvolley/twelvendrcsvp", label: "CSVP International" },
  { href: "/tbvolley/twelvendroevv", label: "Austrian Beach Tour" },
  { href: "/tbvolley/cbv", label: "CBV Brasil" },
  { href: "/tbvolley/federvolley", label: "Italy Federvolley" }
];

const tabletNavItems = [
  { href: "/tablet/wtt", label: "WTT" }
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function isTcyberPath(pathname: string) {
  return navItems.some((item) => isActivePath(pathname, item.href));
}

function isTbvolleyPath(pathname: string) {
  return isActivePath(pathname, "/tbvolley");
}

function isTableTPath(pathname: string) {
  return isActivePath(pathname, "/tablet");
}

export function PlatformTabs() {
  const pathname = usePathname();
  const isTcyberActive = isTcyberPath(pathname);
  const isManualImportActive = isActivePath(pathname, "/manual-import");
  const isTbvolleyActive = isTbvolleyPath(pathname);
  const isTableTActive = isTableTPath(pathname);
  const isSettingsActive = isActivePath(pathname, "/settings");
  const isSandboxActive = isActivePath(pathname, "/sandbox");

  return (
    <nav aria-label="Платформы TData" className="flex min-w-0 flex-wrap items-center gap-1 md:flex-nowrap md:overflow-x-auto">
      <Link
        href="/"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isTcyberActive
            ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">Cyber</span>
        {isTcyberActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-indigo-600 animate-slide-in" />
        )}
      </Link>
      <Link
        href="/manual-import"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isManualImportActive
            ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">Ручной импорт</span>
        {isManualImportActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-rose-600 animate-slide-in" />
        )}
      </Link>
      <Link
        href="/tbvolley/volleyballworld"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isTbvolleyActive
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">TBvolley</span>
        {isTbvolleyActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-emerald-600 animate-slide-in" />
        )}
      </Link>
      <Link
        href="/tablet/wtt"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isTableTActive
            ? "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">TableT</span>
        {isTableTActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-cyan-600 animate-slide-in" />
        )}
      </Link>
      <Link
        href="/settings"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isSettingsActive
            ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">API</span>
        {isSettingsActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-indigo-600 animate-slide-in" />
        )}
      </Link>
      <Link
        href="/sandbox"
        className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
          isSandboxActive
            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100 shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        }`}
      >
        <span className="relative z-10">Песочница</span>
        {isSandboxActive && (
          <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-sky-600 animate-slide-in" />
        )}
      </Link>
    </nav>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  if (isTbvolleyPath(pathname)) {
    return (
      <nav
        aria-label="Навигация TBvolley"
        className="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-slate-200/70 py-2"
      >
        {tbvolleyNavItems.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
                isActive
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <span className="relative z-10">{item.label}</span>
              {isActive && (
                <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-emerald-600 animate-slide-in" />
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  if (isTableTPath(pathname)) {
    return (
      <nav
        aria-label="Навигация TableT"
        className="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-slate-200/70 py-2"
      >
        {tabletNavItems.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
                isActive
                  ? "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100 shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <span className="relative z-10">{item.label}</span>
              {isActive && (
                <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-cyan-600 animate-slide-in" />
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  if (!isTcyberPath(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="Навигация Cyber"
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-slate-200/70 py-2"
    >
      {navItems.map((item) => {
        const isActive = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative shrink-0 rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 active:scale-[0.95] will-change-transform ${
              isActive 
                ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 shadow-sm" 
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            }`}
          >
            <span className="relative z-10">{item.label}</span>
            {isActive && (
              <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-indigo-600 animate-slide-in" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
