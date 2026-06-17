export type ShapkaIdBySelectionId = Record<string, string>;

const QUERY_PARAM = "shapkaBySelection";

export function normalizeShapkaOverrides(value: unknown): ShapkaIdBySelectionId {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: ShapkaIdBySelectionId = {};
  for (const [selectionId, shapkaId] of Object.entries(value)) {
    const cleanSelectionId = selectionId.trim();
    const cleanShapkaId = String(shapkaId ?? "").replace(/\D/g, "").trim();
    if (cleanSelectionId && cleanShapkaId) normalized[cleanSelectionId] = cleanShapkaId;
  }
  return normalized;
}

export function encodeShapkaOverrides(value: ShapkaIdBySelectionId | null | undefined) {
  const normalized = normalizeShapkaOverrides(value);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : "";
}

export function appendShapkaOverridesSearchParam(
  params: URLSearchParams,
  value: ShapkaIdBySelectionId | null | undefined,
) {
  const encoded = encodeShapkaOverrides(value);
  if (encoded) params.set(QUERY_PARAM, encoded);
}

export function readShapkaOverridesSearchParam(searchParams: URLSearchParams) {
  const raw = searchParams.get(QUERY_PARAM);
  if (!raw) return {};

  try {
    return normalizeShapkaOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}
