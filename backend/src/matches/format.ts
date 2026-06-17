const BEST_OF_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  seven: 7,
};

export function getBestOfLabel(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();

  if (!normalized) return null;

  const explicit = normalized.match(/\bbo\s*[-:]?\s*([1-9]\d?)\b/i)
    || normalized.match(/\bbest\s*[-\s]?of\s*[-:]?\s*([1-9]\d?)\b/i)
    || normalized.match(/\bbestof\s*([1-9]\d?)\b/i);

  if (explicit?.[1]) return `BO${Number(explicit[1])}`;

  const word = normalized.match(/\bbest\s*[-\s]?of\s*[-:]?\s*(one|two|three|four|five|seven)\b/i);
  if (word?.[1]) return `BO${BEST_OF_WORDS[word[1].toLowerCase()]}`;

  const bareNumber = normalized.match(/^\s*([1-9]\d?)\s*$/);
  if (bareNumber?.[1]) return `BO${Number(bareNumber[1])}`;

  const inferredFromMapSlots = inferBestOfFromMapSlots(normalized);
  if (inferredFromMapSlots) return inferredFromMapSlots;

  return null;
}

function inferBestOfFromMapSlots(value: string) {
  const uncommented = value.replace(/<!--[\s\S]*?-->/g, " ");
  const slotNumbers = new Set<number>();
  const patterns = [
    /(?:^|\|)\s*(?:map|game)\s*([1-9]\d?)\s*=/gi,
    /\bdata-(?:map|game)(?:-?(?:number|num|index))?\s*=\s*["']?([1-9]\d?)["']?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(uncommented))) {
      const number = Number(match[1]);
      if (Number.isInteger(number) && number > 0) slotNumbers.add(number);
    }
  }

  const maxSlot = Math.max(0, ...slotNumbers);
  return maxSlot > 0 ? `BO${maxSlot}` : null;
}
