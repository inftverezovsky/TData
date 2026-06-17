import { NextResponse } from "next/server";
import {
  dispatchTournamentImport,
  type ImportTournamentRequestBody,
} from "@backend/imports/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const body = (await request.json()) as ImportTournamentRequestBody;
  const result = await dispatchTournamentImport(disciplineSlug, body);

  return NextResponse.json(result.body, { status: result.status ?? 200 });
}
