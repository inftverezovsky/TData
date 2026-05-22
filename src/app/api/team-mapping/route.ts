import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { queueIdentitySync } from "@/lib/sync/identitySync";

export const dynamic = "force-dynamic";

// GET — все маппинги или по списку имён
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const names = searchParams.get("names");
  const disciplineSlug = searchParams.get("discipline") || "counterstrike";

  if (names) {
    const nameList = names.split(",").map((n) => n.trim()).filter(Boolean);
    const mappings = await prisma.teamMapping.findMany({
      where: { 
        disciplineSlug,
        liquipediaName: { in: nameList } 
      }
    });
    return NextResponse.json({ mappings });
  }

  const mappings = await prisma.teamMapping.findMany({
    where: { disciplineSlug },
    orderBy: { liquipediaName: "asc" }
  });
  return NextResponse.json({ mappings });
}

// POST — создать или обновить маппинг
export async function POST(request: Request) {
  const body = await request.json();
  const { liquipediaName, disciplineSlug, alias, platformId, canonicalName, status, logoUrl, isManual, isLockedFromAutoMapping } = body as any;

  const slug = disciplineSlug || "counterstrike";

  if (!liquipediaName || liquipediaName.trim().length < 1) {
    return NextResponse.json({ error: "liquipediaName обязателен" }, { status: 400 });
  }

  const normalizedName = liquipediaName.trim();

  const mapping = await prisma.teamMapping.upsert({
    where: { 
      disciplineSlug_liquipediaName: {
        disciplineSlug: slug,
        liquipediaName: normalizedName
      }
    },
    update: {
      alias: alias?.trim() || null,
      canonicalName: canonicalName?.trim() || null,
      platformId: platformId?.trim() || null,
      logoUrl: logoUrl?.trim() || undefined,
      status: status || 'manual_mapped',
      isManual: isManual !== undefined ? isManual : true,
      isLockedFromAutoMapping: isLockedFromAutoMapping !== undefined ? isLockedFromAutoMapping : true
    },
    create: {
      disciplineSlug: slug,
      liquipediaName: normalizedName,
      alias: alias?.trim() || null,
      canonicalName: canonicalName?.trim() || null,
      platformId: platformId?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
      status: status || 'manual_mapped',
      isManual: isManual !== undefined ? isManual : true,
      isLockedFromAutoMapping: isLockedFromAutoMapping !== undefined ? isLockedFromAutoMapping : true
    }
  });

  // Cascade update: find all tournaments for this discipline and update participants with this name
  await prisma.tournamentParticipant.updateMany({
    where: {
      name: normalizedName,
      tournament: {
        disciplineSlug: slug
      }
    },
    data: {
      platformId: platformId?.trim() || null
    }
  });

  const identitySync = queueIdentitySync("team-mapping:upsert");
  return NextResponse.json({ mapping, identitySync });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const disciplineSlug = searchParams.get("discipline") || "counterstrike";

  if (!name) {
    return NextResponse.json({ error: "Параметр name обязателен" }, { status: 400 });
  }

  const normalizedName = name.trim();

  // Don't physically delete, instead mark as unmapped and locked
  await prisma.teamMapping.update({
    where: { 
      disciplineSlug_liquipediaName: {
        disciplineSlug,
        liquipediaName: normalizedName
      }
    },
    data: {
      platformId: null,
      canonicalName: null,
      alias: null,
      status: 'manual_unmapped',
      isManual: true,
      isLockedFromAutoMapping: true,
      matchMethod: null,
      confidenceScore: null
    }
  });

  // Clear participant platformId
  await prisma.tournamentParticipant.updateMany({
    where: {
      name: normalizedName,
      tournament: {
        disciplineSlug
      }
    },
    data: {
      platformId: null
    }
  });

  const identitySync = queueIdentitySync("team-mapping:delete");
  return NextResponse.json({ success: true, identitySync });
}
