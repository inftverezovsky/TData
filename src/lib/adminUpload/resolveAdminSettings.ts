import { prisma } from "@/lib/db/db";
import {
  BEACH_VOLLEYBALL_ADMIN_SPORT_ID,
  isBeachVolleyballScopeSlug,
} from "@/lib/tbvolley/config";

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

  return resolveAdminSettingsFromData(disciplineSlug, disciplineSettings, globalSettings);
}

export function resolveAdminSettingsFromData(
  disciplineSlug: string,
  disciplineSettings: {
    apiUrl?: string | null;
    adminSportId?: string | null;
    adminMax?: string | null;
    defaultShapkaId?: string | null;
    timezone?: string | null;
    dateFormat?: string | null;
    requestMode?: string | null;
    sslVerify?: boolean | null;
  } | null | undefined,
  globalSettings: Record<string, string | null | undefined>,
): ResolvedAdminSettings {
  const isBeachVolleyball = isBeachVolleyballScopeSlug(disciplineSlug);
  const tbvolleySportId = cleanSetting(globalSettings.tbvolley_sport_id)
    || BEACH_VOLLEYBALL_ADMIN_SPORT_ID;

  return {
    apiUrl: cleanSetting(disciplineSettings?.apiUrl)
      || (isBeachVolleyball ? cleanSetting(globalSettings.tbvolley_admin_api_url) : null)
      || cleanSetting(globalSettings.admin_api_url)
      || null,
    adminSportId: cleanSetting(disciplineSettings?.adminSportId)
      || (isBeachVolleyball ? tbvolleySportId : null)
      || cleanSetting(globalSettings.admin_sport_id)
      || null,
    adminMax: cleanSetting(disciplineSettings?.adminMax) || cleanSetting(globalSettings.admin_max) || '5000',
    defaultShapkaId: disciplineSettings?.defaultShapkaId || null,
    timezone: cleanSetting(disciplineSettings?.timezone) || cleanSetting(globalSettings.admin_timezone) || 'Europe/Moscow',
    dateFormat: cleanSetting(disciplineSettings?.dateFormat) || cleanSetting(globalSettings.admin_date_format) || 'DD.MM.YYYY HH:mm:ss',
    requestMode: cleanSetting(disciplineSettings?.requestMode) || cleanSetting(globalSettings.admin_request_mode) || 'legacy_raw',
    sslVerify: disciplineSettings?.sslVerify ?? true,
  };
}

function cleanSetting(value: string | null | undefined) {
  return String(value || "").trim();
}
