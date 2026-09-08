import { NextResponse } from "next/server";
import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { ApiRequestError, apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { readKhlSyncRequest } from "@backend/results/khl/syncRequest";
import {
  confirmKhlPenaltyExtraBinding, getKhlPenaltyExtraBindings, KhlPenaltyExtraBindingError,
} from "@backend/results/khl/penaltyExtraBindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json({ bindings: await getKhlPenaltyExtraBindings(prisma) }); }
  catch (error) {
    logApiError("api:khl/penalty-extra:get", error);
    return apiErrorResponse(error, "Не удалось загрузить ID допов штрафного времени.");
  }
}

export async function POST(request: Request) {
  const unsafe = requireSameOriginJsonMutation(request);
  if (unsafe) return unsafe;
  const body = await readKhlSyncRequest(request);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !["extraCode", "adminExtraId"].includes(key))) {
    return NextResponse.json({ error: "Некорректные поля привязки допа." }, { status: 400 });
  }
  try {
    const result = await confirmKhlPenaltyExtraBinding(prisma, {
      ...body as { extraCode: string; adminExtraId: string }, confirmedBy: "admin-session",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof KhlPenaltyExtraBindingError) {
      const message = {
        INVALID_BINDING: "Укажите известный доп и ID от 1 до 128 символов без пробелов.",
        CONFIRMED_BINDING_IMMUTABLE: "У этого допа уже подтверждён другой Admin ID.",
        ADMIN_ID_COLLISION: "Этот Admin ID уже назначен другому допу.",
      }[error.code];
      return apiErrorResponse(new ApiRequestError(error.code, error.code === "INVALID_BINDING" ? 400 : 409, message));
    }
    logApiError("api:khl/penalty-extra:post", error);
    return apiErrorResponse(error, "Не удалось сохранить ID допа штрафного времени.");
  }
}
