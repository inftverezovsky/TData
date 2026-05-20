import Image from "next/image";
import Link from "next/link";
import { ArrowRight, History, Search, Settings, ShieldCheck } from "lucide-react";

const disciplines = [
  {
    slug: "dota2",
    name: "Dota 2",
    source: "Liquipedia",
    bg: "/dota2_bg_1777894185405.png",
    accent: "bg-emerald-500",
  },
  {
    slug: "counterstrike",
    name: "Counter-Strike",
    source: "Liquipedia + HLTV",
    bg: "/cs_bg_1777894203647.png",
    accent: "bg-orange-500",
  },
  {
    slug: "leagueoflegends",
    name: "League of Legends",
    source: "Liquipedia",
    bg: "/lol_bg_1777894223180.png",
    accent: "bg-sky-500",
  },
  {
    slug: "valorant",
    name: "Valorant",
    source: "Liquipedia",
    bg: "/valorant_bg_1777894248851.png",
    accent: "bg-rose-500",
  },
];

const quickLinks = [
  { href: "/history", label: "История загрузок", icon: History },
  { href: "/settings", label: "API и прокси", icon: Settings },
];

export default function HomePage() {
  const hoverShadows: Record<string, string> = {
    dota2: "hover:shadow-[0_12px_30px_rgba(16,185,129,0.18)] hover:border-emerald-300",
    counterstrike: "hover:shadow-[0_12px_30px_rgba(249,115,22,0.18)] hover:border-orange-300",
    leagueoflegends: "hover:shadow-[0_12px_30px_rgba(14,165,233,0.18)] hover:border-sky-300",
    valorant: "hover:shadow-[0_12px_30px_rgba(244,63,94,0.18)] hover:border-rose-300",
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5 animate-pulse" />
                Admin hub
              </div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950">
                Оперативная панель TCyber
              </h1>
              <p className="mt-3 max-w-xl text-sm font-semibold leading-relaxed text-slate-600">
                Быстрый вход в поиск турниров, импорт матчей, проверку ID команд и отправку расписания в админку.
              </p>
            </div>
            <Link
              href="/counterstrike"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 text-xs font-black uppercase tracking-widest text-white transition-all duration-300 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-600/20 active:scale-[0.95] will-change-transform"
            >
              <Search className="h-4 w-4" />
              Начать поиск
            </Link>
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-slate-950 p-8 text-white shadow-soft">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Рабочие разделы</p>
          <div className="mt-5 grid gap-3">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-bold transition-all duration-300 hover:bg-white/10 hover:border-indigo-500/30 active:scale-[0.96] will-change-transform"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4.5 w-4.5 text-indigo-300" />
                  {label}
                </span>
                <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        </aside>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {disciplines.map((discipline, index) => {
          const shadowClass = hoverShadows[discipline.slug] || "";
          return (
            <Link 
              key={discipline.slug} 
              href={`/${discipline.slug}`}
              className={`group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300 hover:-translate-y-1.5 active:scale-[0.98] will-change-transform ${shadowClass}`}
            >
              <div className="relative h-44 overflow-hidden">
                <Image
                  src={discipline.bg}
                  alt={discipline.name}
                  fill
                  priority={index === 0}
                  sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105 group-hover:saturate-[1.10]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
                <div className={`absolute left-5 top-5 h-3 w-3 rounded-full ${discipline.accent} shadow-md`} />
              </div>
              <div className="flex items-center justify-between gap-4 p-5 bg-white">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{discipline.source}</p>
                  <h2 className="mt-1 truncate text-xl font-black text-slate-950 tracking-tight">{discipline.name}</h2>
                </div>
                <div className="rounded-full bg-slate-50 p-2 group-hover:bg-indigo-50 transition-colors">
                  <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-600" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
