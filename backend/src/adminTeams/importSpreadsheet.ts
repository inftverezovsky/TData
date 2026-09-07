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

const HEADER_RU_NAME_CANDIDATES = [
  "russian name",
  "name ru",
  "ru name",
  "ru",
  "rus",
  "russian",
  "название на русском",
  "русское название",
  "название ru",
  "имя на русском",
  "русское имя",
  "русский",
  "рус",
];

const HEADER_EN_NAME_CANDIDATES = [
  "english name",
  "name en",
  "en name",
  "en",
  "eng",
  "english",
  "название на английском",
  "английское название",
  "название en",
  "имя на английском",
  "английское имя",
  "английский",
  "англ",
];

export type AdminTeamImportLayout = {
  headerRowIndex: number;
  dataStartRow: number;
  idCol: number;
  nameCol: number;
  nameRuCol?: number | null;
  nameEnCol?: number | null;
  source: "header" | "data";
};

export function inferAdminTeamImportLayout(rows: unknown[][]): AdminTeamImportLayout | null {
  // Сначала ищем явные заголовки; при их отсутствии оцениваем колонки ID и имён по образцу строк.
  // Сохраняем индексы пустых строк: найденный dataStartRow применяется к исходному листу.
  const normalizedRows = rows.map((row) => Array.isArray(row) ? row : []);

  if (normalizedRows.length === 0) return null;

  const headerRowIndex = findHeaderRowIndex(normalizedRows);
  if (headerRowIndex !== -1) {
    const headerRow = normalizedRows[headerRowIndex];
    const idCol = findHeaderColumn(headerRow, HEADER_ID_CANDIDATES);
    const nameRuCol = findHeaderColumn(headerRow, HEADER_RU_NAME_CANDIDATES);
    const nameEnCol = findHeaderColumn(headerRow, HEADER_EN_NAME_CANDIDATES);
    const genericNameCol = findHeaderColumn(headerRow, HEADER_NAME_CANDIDATES);
    const nameCol = nameRuCol !== -1 ? nameRuCol : nameEnCol !== -1 ? nameEnCol : genericNameCol;

    if (idCol !== -1 && nameCol !== -1) {
      return {
        headerRowIndex,
        dataStartRow: headerRowIndex + 1,
        idCol,
        nameCol,
        nameRuCol: nameRuCol !== -1 ? nameRuCol : null,
        nameEnCol: nameEnCol !== -1 ? nameEnCol : null,
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
  // Применяем найденную схему к строкам, сохраняем имена на обоих языках и считаем пропуски.
  const layout = inferAdminTeamImportLayout(rows);
  const records: Array<{
    platformId: string;
    platformName: string;
    platformNameRu: string | null;
    platformNameEn: string | null;
    normalizedName: string;
    normalizedNameRu: string | null;
    normalizedNameEn: string | null;
  }> = [];
  let skippedCount = 0;

  if (!layout) {
    return { layout: null, records, skippedCount };
  }

  for (let i = layout.dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !rowHasValues(row)) continue;

    const platformId = normalizeImportedAdminTeamId(row[layout.idCol]);
    const nameRu = normalizeImportedAdminTeamName(
      layout.nameRuCol != null ? row[layout.nameRuCol] : guessLanguageName(row, layout, "ru")
    );
    const nameEn = normalizeImportedAdminTeamName(
      layout.nameEnCol != null ? row[layout.nameEnCol] : guessLanguageName(row, layout, "en")
    );
    const primaryName = normalizeImportedAdminTeamName(row[layout.nameCol]);
    const platformName = nameRu || nameEn || primaryName;

    if (!platformId || !platformName) {
      skippedCount++;
      continue;
    }

    const platformNameRu = nameRu || (hasCyrillic(platformName) ? platformName : null);
    const platformNameEn = nameEn || (hasLatin(platformName) && !hasCyrillic(platformName) ? platformName : null);

    records.push({
      platformId,
      platformName,
      platformNameRu,
      platformNameEn,
      normalizedName: normalizeImportedTeamName(platformName),
      normalizedNameRu: platformNameRu ? normalizeImportedTeamName(platformNameRu) : null,
      normalizedNameEn: platformNameEn ? normalizeImportedTeamName(platformNameEn) : null,
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
    ...inferLanguageNameColumns(nameCandidates.map((candidate) => candidate.index), sampleRows),
  };
}

function inferLanguageNameColumns(nameColumns: number[], rows: unknown[][]) {
  let nameRuCol: number | null = null;
  let nameEnCol: number | null = null;

  for (const col of nameColumns) {
    const values = rows.map((row) => normalizeImportedText(row[col])).filter(Boolean);
    if (values.length === 0) continue;

    const cyrillicHits = values.filter(hasCyrillic).length;
    const latinHits = values.filter((value) => hasLatin(value) && !hasCyrillic(value)).length;

    if (nameRuCol == null && cyrillicHits > 0) {
      nameRuCol = col;
      continue;
    }

    if (nameEnCol == null && latinHits > 0 && latinHits >= cyrillicHits) {
      nameEnCol = col;
    }
  }

  return { nameRuCol, nameEnCol };
}

function guessLanguageName(row: unknown[], layout: AdminTeamImportLayout, language: "ru" | "en") {
  const usedColumns = new Set([layout.idCol, layout.nameCol]);
  if (layout.nameRuCol != null) usedColumns.add(layout.nameRuCol);
  if (layout.nameEnCol != null) usedColumns.add(layout.nameEnCol);

  const candidates = row
    .map((cell, index) => ({ index, value: normalizeImportedAdminTeamName(cell) }))
    .filter((candidate) => !usedColumns.has(candidate.index) && scoreNameCell(candidate.value) > 0);

  return candidates.find((candidate) => language === "ru" ? hasCyrillic(candidate.value) : hasLatin(candidate.value) && !hasCyrillic(candidate.value))?.value || "";
}

function findHeaderRowIndex(rows: unknown[][]) {
  const limit = Math.min(rows.length, 5);

  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex];
    if (!rowHasValues(row)) continue;

    const normalizedCells = row.map((cell) => normalizeHeaderCell(cell)).filter(Boolean);
    if (normalizedCells.length === 0) continue;

    const hasId = normalizedCells.some((cell) => matchesHeaderCandidate(cell, HEADER_ID_CANDIDATES));
    const hasName = normalizedCells.some((cell) =>
      matchesHeaderCandidate(cell, HEADER_NAME_CANDIDATES)
      || matchesHeaderCandidate(cell, HEADER_RU_NAME_CANDIDATES)
      || matchesHeaderCandidate(cell, HEADER_EN_NAME_CANDIDATES)
    );
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

function hasCyrillic(value: string) {
  return /[А-Яа-яЁё]/.test(value);
}

function hasLatin(value: string) {
  return /[A-Za-z]/.test(value);
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
