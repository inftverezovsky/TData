'use client';

interface ExportPanelProps {
  tournamentId: string;
  disciplineSlug: string;
  selectedMatchIds?: string[];
}

export default function ExportPanel({ tournamentId, disciplineSlug, selectedMatchIds = [] }: ExportPanelProps) {
  const getJsonUrl = () => {
    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/json`;
    if (selectedMatchIds.length > 0) {
      return `${baseUrl}?ids=${selectedMatchIds.join(',')}`;
    }
    return baseUrl;
  };

  const getExportUrl = (format: string, type: string = 'matches') => {
    let url = `/api/${disciplineSlug}/tournament/${tournamentId}/export?format=${format}`;
    if (format === 'csv') url += `&type=${type}`;
    if (selectedMatchIds.length > 0) url += `&ids=${selectedMatchIds.join(',')}`;
    return url;
  };

  const getPhpUrl = () => {
    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/php`;
    if (selectedMatchIds.length > 0) {
      return `${baseUrl}?ids=${selectedMatchIds.join(',')}`;
    }
    return baseUrl;
  };

  return (
    <section className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Экспорт данных</h2>
      <div className="grid grid-cols-3 gap-2">
        <a
          href={getJsonUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          JSON
        </a>
        <a
          href={getExportUrl('csv')}
          className="flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          CSV
        </a>
        <a
          href={getPhpUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          PHP
        </a>
      </div>
    </section>
  );
}
