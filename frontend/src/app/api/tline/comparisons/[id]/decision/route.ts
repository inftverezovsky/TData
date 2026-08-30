import { prisma } from "@backend/db/db";
import { applyComparisonDecision } from "@backend/tline/application/manualDecisions";
import { parseManualDecisionInput, resetManualDecisionInput } from "@backend/tline/api/decisionInput";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const result = await applyComparisonDecision(
      prisma,
      parseId((await context.params).id),
      parseManualDecisionInput(await readJsonBody(request)),
    );
    return apiOk(result, 201);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    return apiOk(await applyComparisonDecision(
      prisma,
      parseId((await context.params).id),
      resetManualDecisionInput(),
    ), 201);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
