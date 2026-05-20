import { prisma } from "@/lib/db/db";

export interface ResolvedAdminSettings {
  apiUrl: string | null;
  adminSportId: string | null;
  adminMax: string;
  defaultShapkaId: string | null;
  timezone: string;
  dateFormat: string;
  requestMode: string;
  sslVerify: boolean;
}

export async function resolveAdminSettings(disciplineSlug: string): Promise<ResolvedAdminSettings> {
  const [disciplineSettings, globalSettingsArray] = await Promise.all([
    prisma.disciplineAdminSettings.findUnique({ where: { disciplineSlug } }),
    prisma.globalSettings.findMany()
  ]);

  const globalSettings = globalSettingsArray.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>);

  return {
    apiUrl: disciplineSettings?.apiUrl || globalSettings.admin_api_url || null,
    adminSportId: disciplineSettings?.adminSportId || globalSettings.admin_sport_id || null,
    adminMax: disciplineSettings?.adminMax || globalSettings.admin_max || '5000',
    defaultShapkaId: disciplineSettings?.defaultShapkaId || null,
    timezone: disciplineSettings?.timezone || globalSettings.admin_timezone || 'Europe/Moscow',
    dateFormat: disciplineSettings?.dateFormat || globalSettings.admin_date_format || 'DD.MM.YYYY HH:mm:ss',
    requestMode: disciplineSettings?.requestMode || globalSettings.admin_request_mode || 'legacy_raw',
    sslVerify: disciplineSettings?.sslVerify ?? true,
  };
}
