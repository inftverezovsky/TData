export const DEFAULT_ADMIN_SERVICE_URL = "https://in.upzero.net/infotdel/results_fixtures/cyber/liquiped/";

export function buildAdminServiceUrl(jsonUrl: string, serviceBaseUrl: string | null | undefined) {
  const configuredBaseUrl = String(serviceBaseUrl || "").trim();
  const baseUrl = configuredBaseUrl || DEFAULT_ADMIN_SERVICE_URL;

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("link", jsonUrl);
    return url.toString();
  } catch {
    return null;
  }
}
