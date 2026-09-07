import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import {
  applyAutoMappingForDiscipline,
  buildAutoMappingPreviewForDiscipline,
  ensureTeamMappingsForNames,
  type AutoMappingSelection,
} from "@backend/teams/mapping";
import { queueIdentitySync } from "@backend/sync/identitySync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.
  try {
    const body = await request.json();
    const { disciplineSlug, liquipediaName, teamNames, apply, selectedMappings, replaceConflicts } = body as {
      disciplineSlug: string;
      liquipediaName?: string;
      teamNames?: unknown;
      dryRun?: boolean;
      apply?: boolean;
      selectedMappings?: unknown;
      replaceConflicts?: boolean;
    };
    const slug = String(disciplineSlug || "").trim().toLowerCase();

    if (!slug) {
      return NextResponse.json({ error: "disciplineSlug обязателен" }, { status: 400 });
    }

    const names = resolveRequestedNames(teamNames, liquipediaName);

    if (apply) {
      const ensureResult = await ensureTeamMappingsForNames(names, slug);
      const result = await applyAutoMappingForDiscipline({
        disciplineSlug: slug,
        liquipediaNames: names.length > 0 ? names : undefined,
        selections: readSelectedMappings(selectedMappings),
        replaceConflicts: Boolean(replaceConflicts),
      });
      const identitySync = queueIdentitySync(`team-mapping:auto:${slug}`);
      return NextResponse.json({ success: true, result: { ...result, ...ensureResult }, identitySync });
    }

    const preview = await buildAutoMappingPreviewForDiscipline(slug, {
      liquipediaNames: names.length > 0 ? names : undefined,
      includeAutoMapped: Boolean(liquipediaName),
    });

    return NextResponse.json({ success: true, preview });
  } catch (error) {
    logApiError("api:team-mapping/auto/route.ts", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? safeErrorMessage(error) : "Ошибка авто-маппинга",
    }, { status: 500 });
  }
}

function resolveRequestedNames(teamNames: unknown, liquipediaName?: string) {
  if (liquipediaName?.trim()) return [liquipediaName.trim()];
  if (!Array.isArray(teamNames)) return [];
  return teamNames.map((name) => String(name ?? "").trim()).filter(Boolean);
}

function readSelectedMappings(value: unknown): AutoMappingSelection[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as { liquipediaName?: unknown; platformId?: unknown };
      const liquipediaName = typeof raw.liquipediaName === "string" ? raw.liquipediaName.trim() : "";
      const platformId = typeof raw.platformId === "string" || typeof raw.platformId === "number" ? String(raw.platformId).trim() : "";
      return liquipediaName && platformId ? { liquipediaName, platformId } : null;
    })
    .filter((item): item is AutoMappingSelection => Boolean(item));
}
