import fs from "fs";
import path from "path";

export type CacheSource = "hltv" | "vlr" | "dltv" | "fandom" | "liquipedia" | "all";

export type CacheClearScope = {
  source?: CacheSource;
  disciplineSlug?: string;
};

export function clearCacheFiles(scope: CacheClearScope = {}) {
  const source = scope.source || "all";
  const roots = getCacheRoots(source, scope.disciplineSlug);

  return roots.reduce((count, root) => count + deleteCacheFiles(root), 0);
}

function getCacheRoots(source: CacheSource, disciplineSlug?: string) {
  const cacheRoot = path.join(process.cwd(), "cache");
  const sources = source === "all" ? ["hltv", "vlr", "dltv", "fandom", "liquipedia"] : [source];

  return sources.map((item) => {
    const root = path.join(cacheRoot, item);
    return disciplineSlug ? path.join(root, disciplineSlug) : root;
  });
}

function deleteCacheFiles(cacheDir: string): number {
  if (!isPathInsideCache(cacheDir) || !fs.existsSync(cacheDir)) return 0;
  let deletedCount = 0;

  for (const file of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    const fullPath = path.join(cacheDir, file.name);
    if (!isPathInsideCache(fullPath)) continue;

    if (file.isDirectory()) {
      deletedCount += deleteCacheFiles(fullPath);
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
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === cacheRoot || resolvedTarget.startsWith(`${cacheRoot}${path.sep}`);
}
