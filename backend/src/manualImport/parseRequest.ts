import { resolveManualImportDisciplineSlug } from "./config";

export type ManualImportParseMode = "auto" | "text" | "ai";

export type ManualImportParseRequestInput = {
  disciplineSlug: string;
  disciplineId: string;
  text: string;
  ocrText: string;
  imageDataUrl: string;
  imageBuffer?: Buffer;
  imageMime?: string;
  mode: ManualImportParseMode;
  fast: boolean;
};

type JsonRequestBody = {
  disciplineSlug?: unknown;
  disciplineId?: unknown;
  text?: unknown;
  ocrText?: unknown;
  imageDataUrl?: unknown;
  mode?: unknown;
  fast?: unknown;
};

export async function readManualImportParseRequest(request: Request): Promise<ManualImportParseRequestInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");
    const image = await readImageFormFile(file);
    const disciplineId = readFormString(formData.get("disciplineId"));

    return {
      disciplineSlug: resolveManualImportDisciplineSlug({
        disciplineId,
        disciplineSlug: readFormString(formData.get("disciplineSlug")),
      }),
      disciplineId,
      text: readFormString(formData.get("text")),
      ocrText: readFormString(formData.get("ocrText")),
      imageDataUrl: readFormString(formData.get("imageDataUrl")),
      imageBuffer: image?.buffer,
      imageMime: image?.mime,
      mode: normalizeParseMode(readFormString(formData.get("mode"))),
      fast: normalizeBoolean(formData.get("fast")),
    };
  }

  const body = (await request.json().catch(() => ({}))) as JsonRequestBody;
  const disciplineId =
    typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "";
  return {
    disciplineSlug: resolveManualImportDisciplineSlug({
      disciplineId,
      disciplineSlug: body.disciplineSlug,
    }),
    disciplineId,
    text: typeof body.text === "string" ? body.text : "",
    ocrText: typeof body.ocrText === "string" ? body.ocrText : "",
    imageDataUrl: typeof body.imageDataUrl === "string" ? body.imageDataUrl : "",
    mode: normalizeParseMode(body.mode),
    fast: normalizeBoolean(body.fast),
  };
}

function readFormString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

async function readImageFormFile(value: FormDataEntryValue | null) {
  if (!value || typeof value === "string") return null;
  const file = value as File;
  if (!file.size) return null;

  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    mime: file.type || "application/octet-stream",
  };
}

function normalizeParseMode(value: unknown): ManualImportParseMode {
  return value === "text" || value === "ai" || value === "auto" ? value : "auto";
}

function normalizeBoolean(value: unknown) {
  return value === true || value === "true" || value === "1" || value === 1;
}
