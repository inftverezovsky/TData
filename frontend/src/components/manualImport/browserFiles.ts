/** Браузерные операции с файлами и буфером обмена; здесь нет React-состояния или сетевых запросов. */
export async function copyToClipboard(value: string) {
  // Сначала современный Clipboard API; при недоступности используем временное поле и возвращаем прежний фокус.
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Браузер отклонил Clipboard API; ниже остаётся совместимый путь через выделение текста.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus({ preventScroll: true });
  }
}

export async function resizeImageForAi(file: File) {
  return resizeImage(file, {
    maxSide: 1600,
    maxPassthroughBytes: 1.25 * 1024 * 1024,
    outputType: "image/jpeg",
    quality: 0.9,
    suffix: "ai",
  });
}

export async function resizeImageForOcr(file: File) {
  return resizeImage(file, {
    maxSide: 2000,
    maxPassthroughBytes: 2 * 1024 * 1024,
    outputType: "image/webp",
    quality: 0.92,
    suffix: "ocr",
  });
}

async function resizeImage(
  file: File,
  options: {
    maxSide: number;
    maxPassthroughBytes: number;
    outputType: "image/webp" | "image/jpeg";
    quality: number;
    suffix: string;
  }
) {
  // Небольшой оригинал сохраняем; большой пропорционально уменьшаем и перекодируем. При сбое возвращаем исходный файл.
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= options.maxSide && file.size <= options.maxPassthroughBytes) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, options.maxSide / maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.outputType, options.quality));
    if (!blob) return file;
    const resizedName = file.name.replace(/\.[^.]+$/, "") || "schedule";
    const extension = options.outputType === "image/jpeg" ? "jpg" : "webp";
    return new File([blob], `${resizedName}-${options.suffix}.${extension}`, { type: options.outputType });
  } catch {
    return file;
  }
}

export async function getClientAiImageCacheKey(disciplineId: string, file: File | null, imageDataUrl: string, text = "") {
  if (typeof window === "undefined" || !window.crypto?.subtle) return "";
  const source = file ? await file.arrayBuffer() : imageDataUrl ? new TextEncoder().encode(imageDataUrl).buffer : null;
  if (!source) return "";
  // AI получает картинку вместе с текстовым пояснением: смена любого входа отменяет старый кэш.
  const hashes = await Promise.all([
    window.crypto.subtle.digest("SHA-256", source),
    window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  ]);
  const fingerprint = hashes.map((hash) => Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")).join(":");
  return `${disciplineId.trim() || "manual"}:${fingerprint}`;
}

export function getImageFilesFromClipboard(clipboardData: DataTransfer | null) {
  if (!clipboardData?.items) return [];
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export async function getFileHash(file: File) {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }
  const hash = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function fileExtensionFromMime(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}
