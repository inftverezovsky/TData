import { getAdminLineConfiguration } from "@backend/tline/admin/configuration";
import { apiOk, requireTLineAccess } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  const configuration = getAdminLineConfiguration();
  return apiOk({
    configured: configuration.configured,
    connected: false,
    mode: configuration.mode,
    readOnly: true,
  });
}
