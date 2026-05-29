export function buildAdminServiceUrl(jsonUrl: string, serviceBaseUrl: string | null | undefined) {
  const baseUrl = String(serviceBaseUrl || "").trim();
  if (!baseUrl) return null;

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("link", jsonUrl);
    return url.toString();
  } catch {
    return null;
  }
}
