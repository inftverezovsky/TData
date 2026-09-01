import fs from "node:fs";
import path from "node:path";

export const CONSULTANT_DOCUMENT_PATHS = Object.freeze([
  "README.md",
  "backend/README.md",
  "frontend/README.md",
  "docs/API_POLICY.md",
  "docs/ARCHITECTURE.md",
  "docs/DEPLOYMENT_PORTAINER.md",
  "docs/TLINE.md",
  "docs/TOURNAMENT_AUDIT_AGENT.md",
  "deploy/systemd/README.md",
] as const);

export interface KnowledgeDocument {
  readonly source: string;
  readonly text: string;
}

export interface KnowledgeChunk {
  readonly source: string;
  readonly heading: string;
  readonly text: string;
  readonly terms: ReadonlySet<string>;
}

export interface KnowledgeMatch {
  readonly source: string;
  readonly heading: string;
  readonly text: string;
  readonly score: number;
}

export function loadConsultantDocuments(rootDirectory = process.cwd()): KnowledgeDocument[] {
  return CONSULTANT_DOCUMENT_PATHS.flatMap((source) => {
    const absolute = path.resolve(rootDirectory, source);
    const relative = path.relative(rootDirectory, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return [];
    try {
      const text = fs.readFileSync(absolute, "utf8");
      return text.trim() ? [{ source, text }] : [];
    } catch {
      return [];
    }
  });
}

export function createKnowledgeIndex(documents: readonly KnowledgeDocument[]): KnowledgeChunk[] {
  return documents.flatMap((document) => chunkMarkdown(document));
}

export function retrieveKnowledge(
  index: readonly KnowledgeChunk[],
  question: string,
  options: { maxChunks?: number; maxCharacters?: number } = {},
): KnowledgeMatch[] {
  const maxChunks = Math.max(1, Math.min(8, options.maxChunks ?? 4));
  let remaining = Math.max(100, Math.min(20_000, options.maxCharacters ?? 6_000));
  const queryTerms = tokenize(question);
  const queryText = normalizeText(question);
  const ranked = index
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTerms, queryText) }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.text.length - right.text.length);

  const matches: KnowledgeMatch[] = [];
  for (const chunk of ranked) {
    if (matches.length >= maxChunks || remaining <= 0) break;
    const text = chunk.text.slice(0, remaining).trim();
    if (!text) continue;
    matches.push({ source: chunk.source, heading: chunk.heading, text, score: chunk.score });
    remaining -= text.length;
  }
  return matches;
}

function chunkMarkdown(document: KnowledgeDocument): KnowledgeChunk[] {
  const lines = document.text.replace(/\r\n?/g, "\n").split("\n");
  const chunks: KnowledgeChunk[] = [];
  let heading = document.source;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      chunks.push({
        source: document.source,
        heading,
        text,
        terms: tokenize(`${document.source} ${heading} ${text}`),
      });
    }
    buffer = [];
  };
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      buffer.push(line);
    } else {
      buffer.push(line);
      if (buffer.join("\n").length >= 2_400) flush();
    }
  }
  flush();
  return chunks;
}

function scoreChunk(chunk: KnowledgeChunk, queryTerms: ReadonlySet<string>, queryText: string) {
  let score = 0;
  const heading = normalizeText(chunk.heading);
  const source = normalizeText(chunk.source);
  for (const term of queryTerms) {
    if (chunk.terms.has(term)) score += 2;
    if (heading.includes(term)) score += 4;
    if (source.includes(term)) score += 3;
  }
  if (queryText.length >= 4 && normalizeText(chunk.text).includes(queryText)) score += 8;
  return score;
}

function tokenize(value: string) {
  return new Set(normalizeText(value).split(/[^a-zа-яё0-9_-]+/u).filter((term) => term.length >= 2));
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}
