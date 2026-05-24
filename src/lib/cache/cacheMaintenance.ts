import fs from "fs";
import path from "path";

export type CacheSource = "hltv" | "vlr" | "dltv" | "fandom" | "liquipedia" | "all";

export type CacheClearScope = {
  source?: CacheSource;
  disciplineSlug?: string;
};

export function clearCacheFiles(scope: CacheClearScope = {}) {
  const source = scope.source || "all";
  if (scope.disciplineSlug && !isValidCacheDisciplineSlug(scope.disciplineSlug)) return 0;

  const roots = getCacheRoots(source, scope.disciplineSlug);

  return roots.reduce((count, root) => count + deleteCacheFiles(root), 0);
}

export function isValidCacheDisciplineSlug(value: string) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

function getCacheRoots(source: CacheSource, disciplineSlug?: string) {
  const cacheRoot = path.join(process.cwd(), "cache");
  const sources = source === "all" ? ["hltv", "vlr", "dltv", "fandom", "liquipedia"] : [source];

  return sources.map((item) => {
    const root = path.join(cacheRoot, item);
    return disciplineSlug ? path.join(root, disciplineSlug) : root;
  });
}

function deleteCacheFiles(cacheDir: string, allowedRoot = cacheDir): number {
  if (!isPathInside(cacheDir, allowedRoot) || !isPathInsideCache(cacheDir) || !fs.existsSync(cacheDir)) return 0;
  let deletedCount = 0;

  for (const file of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    const fullPath = path.join(cacheDir, file.name);
    if (!isPathInside(fullPath, allowedRoot) || !isPathInsideCache(fullPath)) continue;

    if (file.isDirectory()) {
      deletedCount += deleteCacheFiles(fullPath, allowedRoot);
      continue;
    }

    if (file.isFile() && (file.name.endsWith(".json") || file.name.endsWith(".png"))) {
      fs.unlinkSync(fullPath);
      deletedCount++;
    }
  }

  return deletedCount;
}

function isPathInsideCache(targetPath: string) {
  const cacheRoot = path.resolve(process.cwd(), "cache");
  return isPathInside(targetPath, cacheRoot);
}

function isPathInside(targetPath: string, rootPath: string) {
  const cacheRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === cacheRoot || resolvedTarget.startsWith(`${cacheRoot}${path.sep}`);
}
