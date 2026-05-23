const HEADER_ID_CANDIDATES = [
  "platform id",
  "platformid",
  "team id",
  "teamid",
  "player id",
  "playerid",
  "participant id",
  "participantid",
  "athlete id",
  "athleteid",
  "id",
  "uid",
];

const HEADER_NAME_CANDIDATES = [
  "team name",
  "teamname",
  "player name",
  "playername",
  "participant name",
  "participantname",
  "athlete name",
  "athletename",
  "name",
  "team",
  "player",
  "participant",
  "athlete",
  "title",
  "название",
  "команда",
  "игрок",
  "спортсмен",
  "фио",
];

export type AdminTeamImportLayout = {
  headerRowIndex: number;
  dataStartRow: number;
  idCol: number;
  nameCol: number;
  source: "header" | "data";
};

export function inferAdminTeamImportLayout(rows: unknown[][]): AdminTeamImportLayout | null {
  const normalizedRows = rows
    .map((row) => Array.isArray(row) ? row : [])
    .filter((row) => rowHasValues(row));

  if (normalizedRows.length === 0) return null;

  const headerRowIndex = findHeaderRowIndex(normalizedRows);
  if (headerRowIndex !== -1) {
    const headerRow = normalizedRows[headerRowIndex];
    const idCol = findHeaderColumn(headerRow, HEADER_ID_CANDIDATES);
    const nameCol = findHeaderColumn(headerRow, HEADER_NAME_CANDIDATES);

    if (idCol !== -1 && nameCol !== -1) {
      return {
        headerRowIndex,
        dataStartRow: headerRowIndex + 1,
        idCol,
        nameCol,
        source: "header",
      };
    }

    const inferredFromData = inferColumnsFromData(normalizedRows.slice(headerRowIndex + 1));
    if (inferredFromData) {
      return {
        headerRowIndex,
        dataStartRow: headerRowIndex + 1,
        ...inferredFromData,
        source: "data",
      };
    }
  }

  const inferred = inferColumnsFromData(normalizedRows);
  if (!inferred) return null;

  return {
    headerRowIndex: -1,
    dataStartRow: 0,
    ...inferred,
    source: "data",
  };
}

export function parseAdminTeamImportRows(rows: unknown[][]) {
  const layout = inferAdminTeamImportLayout(rows);
  const records: Array<{ platformId: string; platformName: string; normalizedName: string }> = [];
  let skippedCount = 0;

  if (!layout) {
    return { layout: null, records, skippedCount };
  }

  for (let i = layout.dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !rowHasValues(row)) continue;

    const platformId = normalizeImportedAdminTeamId(row[layout.idCol]);
    const platformName = normalizeImportedAdminTeamName(row[layout.nameCol]);

    if (!platformId || !platformName) {
      skippedCount++;
      continue;
    }

    records.push({
      platformId,
      platformName,
      normalizedName: normalizeImportedTeamName(platformName),
    });
  }

  return { layout, records, skippedCount };
}

export function normalizeImportedAdminTeamId(value: unknown) {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return "";
    return Number.isInteger(value) ? String(value) : String(Math.trunc(value));
  }

  const text = normalizeImportedText(value);
  if (!text) return "";

  const compact = text.replace(/[\s\u00A0]/g, "");
  const numericLike = compact.replace(/,/g, ".");

  if (/^\d+(?:\.\d+)?$/.test(numericLike)) {
    const parsed = Number(numericLike);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Number.isInteger(parsed) ? String(parsed) : String(Math.trunc(parsed));
    }
  }

  return compact || text;
}

export function normalizeImportedAdminTeamName(value: unknown) {
  return normalizeImportedText(value);
}

function inferColumnsFromData(rows: unknown[][]) {
  const sampleRows = rows.slice(0, 20).filter((row) => rowHasValues(row));
  if (sampleRows.length === 0) return null;

  const columnCount = sampleRows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return null;

  let idCol = -1;
  let idScore = 0;

  for (let col = 0; col < columnCount; col++) {
    const score = scoreIdColumn(sampleRows, col);
    if (score > idScore) {
      idScore = score;
      idCol = col;
    }
  }

  if (idCol === -1 || idScore < 1) return null;

  const nameCandidates: Array<{ index: number; score: number }> = [];
  for (let col = 0; col < columnCount; col++) {
    if (col === idCol) continue;
    const score = scoreNameColumn(sampleRows, col, idCol);
    if (score > 0) {
      nameCandidates.push({ index: col, score });
    }
  }

  if (nameCandidates.length === 0) return null;

  nameCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return {
    idCol,
    nameCol: nameCandidates[0].index,
  };
}

function findHeaderRowIndex(rows: unknown[][]) {
  const limit = Math.min(rows.length, 5);

  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex];
    if (!rowHasValues(row)) continue;

    const normalizedCells = row.map((cell) => normalizeHeaderCell(cell)).filter(Boolean);
    if (normalizedCells.length === 0) continue;

    const hasId = normalizedCells.some((cell) => matchesHeaderCandidate(cell, HEADER_ID_CANDIDATES));
    const hasName = normalizedCells.some((cell) => matchesHeaderCandidate(cell, HEADER_NAME_CANDIDATES));
    const hasNumericCell = row.some((cell) => isNumericLikeCell(cell));

    if (hasId && hasName && !hasNumericCell) {
      return rowIndex;
    }
  }

  return -1;
}

function findHeaderColumn(row: unknown[], candidates: string[]) {
  for (let col = 0; col < row.length; col++) {
    const normalized = normalizeHeaderCell(row[col]);
    if (normalized && matchesHeaderCandidate(normalized, candidates)) {
      return col;
    }
  }

  return -1;
}

function matchesHeaderCandidate(value: string, candidates: string[]) {
  const normalizedValue = normalizeHeaderCell(value);
  return candidates.some((candidate) => {
    if (normalizedValue === candidate) return true;
    return normalizedValue.includes(` ${candidate} `)
      || normalizedValue.startsWith(`${candidate} `)
      || normalizedValue.endsWith(` ${candidate}`)
      || normalizedValue.includes(candidate);
  });
}

function normalizeHeaderCell(value: unknown) {
  return normalizeImportedText(value)
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImportedText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImportedTeamName(name: string): string {
  if (!name) return "";

  return name
    .trim()
    .toLowerCase()
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/ё/g, "е")
    .replace(/[.,()]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/[^\w\sа-я]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowHasValues(row: unknown[]) {
  return row.some((cell) => normalizeImportedText(cell) !== "");
}

function scoreIdColumn(rows: unknown[][], columnIndex: number) {
  let total = 0;
  let hits = 0;

  for (const row of rows) {
    const score = scoreIdCell(row[columnIndex]);
    if (score > 0) {
      total += score;
      hits++;
    }
  }

  if (!hits) return 0;
  return total / hits;
}

function scoreNameColumn(rows: unknown[][], columnIndex: number, idCol: number) {
  let total = 0;
  let hits = 0;

  for (const row of rows) {
    const score = scoreNameCell(row[columnIndex]);
    if (score > 0) {
      total += score;
      hits++;
    }
  }

  if (!hits) return 0;

  const average = total / hits;
  const positionalBonus = columnIndex > idCol ? 0.25 : -0.1;
  const leftBias = Math.max(0, columnIndex - idCol) * 0.02;
  return average + positionalBonus - leftBias;
}

function scoreIdCell(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? 5 : 0;
  }

  const text = normalizeImportedText(value);
  if (!text) return 0;

  const compact = text.replace(/[\s\u00A0]/g, "");
  const numericLike = compact.replace(/,/g, ".");

  if (/^\d+(?:\.\d+)?$/.test(numericLike)) {
    return 4;
  }

  if (/^\d[\dA-Za-z-]*$/.test(compact) && /\d/.test(compact)) {
    return 2;
  }

  return 0;
}

function scoreNameCell(value: unknown) {
  const text = normalizeImportedText(value);
  if (!text) return 0;

  const compact = text.replace(/[\s\u00A0]/g, "");
  if (/^\d+(?:\.\d+)?$/.test(compact.replace(/,/g, "."))) {
    return 0;
  }

  const letters = (text.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  if (letters === 0) return 0;

  let score = 1 + Math.min(letters, 24) / 6;
  if (/[А-Яа-яЁё]/.test(text)) score += 0.75;
  if (/\s/.test(text)) score += 0.35;
  if (text.length > 4) score += 0.25;
  if (/\//.test(text)) score += 0.15;

  return score;
}

function isNumericLikeCell(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);

  const text = normalizeImportedText(value);
  if (!text) return false;

  const compact = text.replace(/[\s\u00A0]/g, "");
  return /^\d+(?:[.,]\d+)?$/.test(compact);
}
