import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  try {
    const imports = await prisma.tournamentImport.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { tournament: true }
    });

    return NextResponse.json({ imports });
  } catch (error) {
    logApiError("api:imports/route.ts", error);
    return apiErrorResponse(error);
  }
}
