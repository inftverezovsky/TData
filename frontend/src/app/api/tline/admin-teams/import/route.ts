import { apiError, requireTLineFormAccess } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireTLineFormAccess(request);
  if (denied) return denied;
  return apiError(
    "CHAMPIONSHIP_SCOPE_REQUIRED",
    "Выберите чемпионат и используйте его Shapka-scoped endpoint импорта.",
    410,
  );
}
