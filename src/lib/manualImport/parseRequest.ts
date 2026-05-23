export type ManualImportParseRequestInput = {
  disciplineSlug: string;
  disciplineId: string;
  text: string;
  imageDataUrl: string;
  imageBuffer?: Buffer;
  imageMime?: string;
};

type JsonRequestBody = {
  disciplineSlug?: unknown;
  disciplineId?: unknown;
  text?: unknown;
  imageDataUrl?: unknown;
};

export async function readManualImportParseRequest(request: Request): Promise<ManualImportParseRequestInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");
    const image = await readImageFormFile(file);

    return {
      disciplineSlug: readFormString(formData.get("disciplineSlug")).trim().toLowerCase(),
      disciplineId: readFormString(formData.get("disciplineId")),
      text: readFormString(formData.get("text")),
      imageDataUrl: readFormString(formData.get("imageDataUrl")),
      imageBuffer: image?.buffer,
      imageMime: image?.mime,
    };
  }

  const body = (await request.json().catch(() => ({}))) as JsonRequestBody;
  return {
    disciplineSlug: typeof body.disciplineSlug === "string" ? body.disciplineSlug.trim().toLowerCase() : "",
    disciplineId: typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "",
    text: typeof body.text === "string" ? body.text : "",
    imageDataUrl: typeof body.imageDataUrl === "string" ? body.imageDataUrl : "",
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
