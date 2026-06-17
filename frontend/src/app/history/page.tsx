import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { prisma } from "@backend/db/db";
import { formatDateTime } from "@backend/utils/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const imports = await prisma.tournamentImport.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { tournament: true }
  });

  return (
    <div className="space-y-8 animate-in">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Audit Logs</p>
        <h1 className="mt-2 text-4xl font-black tracking-tighter text-slate-950">История загрузок</h1>
        <p className="mt-4 text-lg font-bold text-slate-700">Журнал всех операций по импорту данных из Liquipedia.</p>
      </div>

      <section className="premium-card overflow-hidden bg-white shadow-sm border-slate-200">
        {imports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-4 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Турнир</th>
                  <th className="py-4 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Статус</th>
                  <th className="py-4 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Дата и время</th>
                  <th className="py-4 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-right">Источник</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {imports.map((item) => (
                  <tr key={item.id} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="py-5 px-8">
                      <div className="flex flex-col gap-1">
                        {item.tournament ? (
                          <Link 
                            className="text-base font-black text-slate-950 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4 decoration-2" 
                            href={`/${item.tournament.disciplineSlug}/tournament/${item.tournament.id}`}
                          >
                            {item.pageTitle}
                          </Link>
                        ) : (
                          <span className="text-base font-black text-slate-900">{item.pageTitle}</span>
                        )}
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {item.tournament?.disciplineSlug || "unknown"}
                        </span>
                      </div>
                    </td>
                    <td className="py-5 px-8">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-5 px-8 text-sm font-bold text-slate-700 tabular-nums">
                      {formatDateTime(item.startedAt)}
                    </td>
                    <td className="py-5 px-8 text-right">
                      <a 
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-900 hover:text-white transition-all" 
                        href={item.pageUrl} 
                        target="_blank" 
                        rel="noreferrer"
                      >
                        Source
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-sm font-bold text-slate-400">Журнал пуст. Загрузите первый турнир через панель дисциплин.</p>
          </div>
        )}
      </section>
    </div>
  );
}
