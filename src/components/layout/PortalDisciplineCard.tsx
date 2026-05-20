"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PortalTournament } from "@/lib/liquipedia/portal";

type Props = {
  slug: string;
  name: string;
  iconUrl: string;
  bgUrl: string;
  tournaments: PortalTournament[];
};

export default function PortalDisciplineCard({ slug, name, iconUrl, bgUrl, tournaments }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayLimit = expanded ? tournaments.length : 6;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-[2rem] bg-white border border-slate-200 shadow-sm transition-all hover:shadow-md">
      {/* Cinematic Header */}
      <div className="relative h-48 w-full overflow-hidden">
        <Image 
          src={bgUrl} 
          alt={name} 
          fill
          unoptimized
          className="h-full w-full object-cover grayscale-[0.2] transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/20 to-transparent" />
        <div className="absolute bottom-6 left-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-100">
            <Image 
              src={iconUrl} 
              alt={name} 
              width={48} 
              height={48} 
              unoptimized
              className="h-full w-full object-contain" 
            />
          </div>
          <h2 className="text-3xl font-black tracking-tighter text-slate-900 drop-shadow-sm">{name}</h2>
        </div>
      </div>

      {/* Tournament List */}
      <div className="flex-1 p-8">
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.length > 0 ? (
            tournaments.slice(0, displayLimit).map((t, i) => (
              <TournamentRow key={i} tournament={t} slug={slug} />
            ))
          ) : (
            <div className="col-span-full py-12 text-center opacity-40">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Нет активных событий</p>
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-3">
          {tournaments.length > 6 && (
            <button 
              onClick={() => setExpanded(!expanded)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-50 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 border border-slate-100 transition-all hover:bg-slate-100 hover:text-slate-900"
            >
              {expanded ? "Свернуть" : `Еще (${tournaments.length - 6})`}
            </button>
          )}

          <Link 
            href={`/${slug}`}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-50 py-3 text-[10px] font-black uppercase tracking-widest text-indigo-600 border border-indigo-100 transition-all hover:bg-indigo-600 hover:text-white"
          >
            Все турниры
          </Link>
        </div>
      </div>
    </div>
  );
}

function TournamentRow({ tournament, slug }: { tournament: PortalTournament; slug: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${slug}/import-tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: tournament.title, pageUrl: tournament.url })
      });
      const data = await res.json();
      if (data.tournament?.id) {
        router.push(`/${slug}/tournament/${data.tournament.id}`);
      } else {
        alert(data.error || "Ошибка");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group/row flex flex-col justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-100 p-4 transition-all hover:bg-white hover:border-indigo-200 hover:shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
           <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tournament.status === 'ongoing' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-slate-300'}`} />
           <p className="line-clamp-2 text-xs font-bold leading-snug text-slate-700 group-hover/row:text-slate-900 transition-colors">
             {tournament.title}
           </p>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={handleLoad}
          disabled={loading}
          className="relative flex h-8 flex-1 items-center justify-center rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:bg-indigo-600 hover:border-indigo-600 hover:text-white disabled:opacity-50"
        >
          {loading ? "..." : "Загрузить"}
        </button>
        <a 
          href={tournament.url} 
          target="_blank" 
          rel="noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-400 transition-all hover:text-indigo-600 hover:border-indigo-200 shadow-sm"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </a>
      </div>
    </div>
  );
}
