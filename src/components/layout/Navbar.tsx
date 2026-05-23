"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Главная" },
  { href: "/dota2", label: "Dota 2" },
  { href: "/counterstrike", label: "Counter-Strike" },
  { href: "/leagueoflegends", label: "League of Legends" },
  { href: "/valorant", label: "Valorant" },
  { href: "/manual-import", label: "Ручной импорт" },
  { href: "/history", label: "История" },
  { href: "/settings", label: "API" }
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
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
