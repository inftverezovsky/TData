const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Выбираем допустимый нативный декодер по содержимому, а не по MIME от клиента.
 * HEIF/AVIF намеренно исключены из OCR-контракта: он принимает только PNG/JPEG/WebP.
 * Обновление native-библиотеки не должно неявно расширять список входных форматов.
 */
export function isSupportedOcrImage(input: Buffer): boolean {
  if (input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return true;
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return true;
  return input.length >= 16
    && input.toString("ascii", 0, 4) === "RIFF"
    && input.toString("ascii", 8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(input.toString("ascii", 12, 16));
}
