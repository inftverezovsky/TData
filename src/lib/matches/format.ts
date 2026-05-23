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

  return null;
}
