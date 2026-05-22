import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const imports = await prisma.tournamentImport.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { tournament: true }
  });

  return NextResponse.json({ imports });
}
