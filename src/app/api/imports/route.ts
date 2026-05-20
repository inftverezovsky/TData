import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const imports = await prisma.tournamentImport.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { tournament: true }
  });

  return NextResponse.json({ imports });
}
