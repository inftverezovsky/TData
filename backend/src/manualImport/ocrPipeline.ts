import sharp from "sharp";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { PSM as TesseractPsm, Worker } from "tesseract.js";
import { parseManualScheduleText } from "@backend/sources/tdata/hltv/manualTextParser";

export type ManualImportOcrInput = {
  imageDataUrl?: string;
  imageBuffer?: Buffer;
  imageMime?: string;
};

export type ManualImportOcrVariant = {
  name: string;
  text: string;
  confidence: number;
  matchesFound: number;
};

export type ManualImportOcrResult = {
  text: string;
  confidence: number | null;
  warnings: string[];
  variants: ManualImportOcrVariant[];
  cached?: boolean;
};

type PreparedVariant = {
  name: string;
  pageSegMode: TesseractPsm;
  buildBuffer: () => Promise<Buffer>;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 70_000_000;
const MAX_OCR_WIDTH = 2000;
const MIN_OCR_WIDTH = 1200;
const OCR_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_OCR_CACHE_ENTRIES = 30;
const OCR_EARLY_EXIT_MIN_CONFIDENCE = 55;

let ocrWorkerPromise: Promise<Worker> | null = null;
let ocrQueue: Promise<void> = Promise.resolve();
const ocrCache = new Map<string, { result: ManualImportOcrResult; expiresAt: number }>();

export async function extractManualImportOcr(input: ManualImportOcrInput): Promise<ManualImportOcrResult> {
  const warnings: string[] = [];
  const decoded = decodeImageInput(input, warnings);
  if (!decoded) {
    return { text: "", confidence: null, warnings, variants: [] };
  }

  if (decoded.buffer.length > MAX_IMAGE_BYTES) {
    warnings.push(`Изображение слишком большое: ${formatBytes(decoded.buffer.length)}. Максимум: ${formatBytes(MAX_IMAGE_BYTES)}.`);
    return { text: "", confidence: null, warnings, variants: [] };
  }

  const cacheKey = getOcrCacheKey(decoded.buffer);
  const cached = getCachedOcr(cacheKey);
  if (cached) {
    return {
      ...cloneOcrResult(cached),
      cached: true,
    };
  }

  let prepared: PreparedVariant[] = [];
  try {
    prepared = await prepareImageVariants(decoded.buffer);
  } catch (error) {
    warnings.push(error instanceof Error ? `Не удалось подготовить изображение: ${error.message}` : "Не удалось подготовить изображение.");
    return { text: "", confidence: null, warnings, variants: [] };
  }

  const variants = await runOcrExclusive(async () => {
    const worker = await getOcrWorker();
    const results: ManualImportOcrVariant[] = [];
    const { PSM } = await import("tesseract.js");

    for (const variant of prepared) {
      try {
        const buffer = await variant.buildBuffer();
        await worker.setParameters({
          tessedit_pageseg_mode: variant.pageSegMode || PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1",
        });
        const result = await worker.recognize(buffer);
        const text = normalizeOcrText(result?.data?.text || "");
        const confidence = Number(result?.data?.confidence);
        const matchesFound = parseManualScheduleText(text).length;
        const ocrVariant = {
          name: variant.name,
          text,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
          matchesFound,
        };
        results.push(ocrVariant);

        if (shouldStopAfterOcrVariant(ocrVariant)) {
          break;
        }
      } catch {
        results.push({
          name: variant.name,
          text: "",
          confidence: 0,
          matchesFound: 0,
        });
      }
    }

    return results;
  });

  const best = chooseBestOcrVariant(variants);
  if (!best?.text.trim()) {
    warnings.push("OCR не смог извлечь текст из изображения.");
  }

  const result = {
    text: best?.text || "",
    confidence: best ? best.confidence : null,
    warnings,
    variants,
  };
  setCachedOcr(cacheKey, result);
  return result;
}

export async function shutdownManualImportOcrWorker() {
  const worker = ocrWorkerPromise ? await ocrWorkerPromise.catch(() => null) : null;
  if (worker) {
    await worker.terminate().catch(() => undefined);
  }
  ocrWorkerPromise = null;
  ocrQueue = Promise.resolve();
}

function decodeImageInput(input: ManualImportOcrInput, warnings: string[]) {
  if (input.imageBuffer?.length) {
    if (input.imageMime && !input.imageMime.startsWith("image/")) {
      warnings.push(`Неподдерживаемый тип файла: ${input.imageMime}.`);
      return null;
    }

    return { buffer: input.imageBuffer, mime: input.imageMime || "application/octet-stream" };
  }

  const dataUrl = input.imageDataUrl || "";
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    warnings.push("Изображение должно быть передано как data:image/* base64.");
    return null;
  }

  try {
    return {
      buffer: Buffer.from(match[2], "base64"),
      mime: match[1],
    };
  } catch {
    warnings.push("Не удалось декодировать изображение.");
    return null;
  }
}

async function prepareImageVariants(input: Buffer): Promise<PreparedVariant[]> {
  const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const targetWidth = width > MAX_OCR_WIDTH ? MAX_OCR_WIDTH : width > 0 && width < MIN_OCR_WIDTH ? Math.min(width * 2, MAX_OCR_WIDTH) : undefined;
  const resized = image.resize(targetWidth ? { width: targetWidth, withoutEnlargement: false } : undefined);

  const { PSM } = await import("tesseract.js");
  return [
    {
      name: "normalized",
      pageSegMode: PSM.SPARSE_TEXT,
      buildBuffer: () => resized.clone().grayscale().normalize().sharpen().png().toBuffer(),
    },
    {
      name: "threshold",
      pageSegMode: PSM.SPARSE_TEXT,
      buildBuffer: () => resized.clone().grayscale().normalize().threshold(172).png().toBuffer(),
    },
    {
      name: "block",
      pageSegMode: PSM.SINGLE_BLOCK,
      buildBuffer: () => resized.clone().grayscale().linear(1.28, -18).sharpen().png().toBuffer(),
    },
  ];
}

function chooseBestOcrVariant(variants: ManualImportOcrVariant[]) {
  return variants
    .filter((variant) => variant.text.trim())
    .sort((a, b) => scoreOcrVariant(b) - scoreOcrVariant(a))[0] || null;
}

function scoreOcrVariant(variant: ManualImportOcrVariant) {
  const lineCount = variant.text.split("\n").filter((line) => line.trim().length > 1).length;
  return variant.matchesFound * 45 + variant.confidence + Math.min(lineCount, 20);
}

function shouldStopAfterOcrVariant(variant: ManualImportOcrVariant) {
  return variant.matchesFound > 0 && variant.confidence >= OCR_EARLY_EXIT_MIN_CONFIDENCE;
}

function normalizeOcrText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOcrWorker();
  }

  return ocrWorkerPromise;
}

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");
  return createWorker(["rus", "eng"], 1, {
    langPath: resolve(process.cwd(), "data", "tessdata").replace(/\\/g, "/"),
    cachePath: resolve(process.cwd(), ".tesseract-cache").replace(/\\/g, "/"),
    gzip: false,
  });
}

async function runOcrExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function getOcrCacheKey(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function getCachedOcr(key: string) {
  const entry = ocrCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    ocrCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedOcr(key: string, result: ManualImportOcrResult) {
  cleanupOcrCache();
  ocrCache.set(key, {
    result: cloneOcrResult({ ...result, cached: false }),
    expiresAt: Date.now() + OCR_CACHE_TTL_MS,
  });
}

function cleanupOcrCache() {
  const now = Date.now();
  for (const [key, entry] of ocrCache) {
    if (entry.expiresAt < now) ocrCache.delete(key);
  }

  while (ocrCache.size >= MAX_OCR_CACHE_ENTRIES) {
    const oldestKey = ocrCache.keys().next().value;
    if (!oldestKey) break;
    ocrCache.delete(oldestKey);
  }
}

function cloneOcrResult(result: ManualImportOcrResult): ManualImportOcrResult {
  return {
    text: result.text,
    confidence: result.confidence,
    warnings: [...result.warnings],
    variants: result.variants.map((variant) => ({ ...variant })),
    cached: result.cached,
  };
}
