import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import {
  dispatchTournamentImport,
  type ImportTournamentRequestBody,
} from "@/lib/imports/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { disciplineSlug } = await params;
  const body = (await request.json()) as ImportTournamentRequestBody;
  const result = await dispatchTournamentImport(disciplineSlug, body);

  return NextResponse.json(result.body, { status: result.status ?? 200 });
}
