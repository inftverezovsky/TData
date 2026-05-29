'use client';

import { appendShapkaOverridesSearchParam } from '@/lib/adminUpload/shapkaOverrides';

interface ExportPanelProps {
  tournamentId: string;
  disciplineSlug: string;
  selectedMatchIds?: string[];
  shapkaIdBySelectionId?: Record<string, string>;
}

function buildSelectedIdsQuery(selectedMatchIds: string[]) {
  return selectedMatchIds.map((id) => encodeURIComponent(id)).join(',');
}

export default function ExportPanel({
  tournamentId,
  disciplineSlug,
  selectedMatchIds = [],
  shapkaIdBySelectionId = {},
}: ExportPanelProps) {
  const buildAdminParams = () => {
    const params = new URLSearchParams();
    if (selectedMatchIds.length > 0) params.set('ids', selectedMatchIds.join(','));
    appendShapkaOverridesSearchParam(params, shapkaIdBySelectionId);
    return params.toString();
  };

  const getJsonUrl = () => {
    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/json`;
    const query = buildAdminParams();
    return query ? `${baseUrl}?${query}` : baseUrl;
  };

  const getExportUrl = (format: string, type: string = 'matches') => {
    let url = `/api/${disciplineSlug}/tournament/${tournamentId}/export?format=${format}`;
    if (format === 'csv') url += `&type=${type}`;
    if (selectedMatchIds.length > 0) url += `&ids=${buildSelectedIdsQuery(selectedMatchIds)}`;
    if (format === 'json' || format === 'php') {
      const params = new URLSearchParams();
      appendShapkaOverridesSearchParam(params, shapkaIdBySelectionId);
      const query = params.toString();
      if (query) url += `&${query}`;
    }
    return url;
  };

  const getPhpUrl = () => {
    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/php`;
    const query = buildAdminParams();
    return query ? `${baseUrl}?${query}` : baseUrl;
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
