/**
 * Защита тестов, которые создают и удаляют записи.
 * Алгоритм: разобрать URL → проверить локальный PostgreSQL → проверить отдельное
 * имя базы и схему → только после этого разрешить создание PrismaClient.
 * Строку подключения не включаем в ошибки: она может содержать пароль.
 */
export function requireTestDatabaseUrl(value: string | undefined): string {
  const reject = () => new Error(
    "An isolated local test database is required: PostgreSQL on loopback, " +
    "name tdata_test_*, tdata_khl_test_* or tdata_khl_browser_*, public schema only."
  );
  let parsed: URL;
  let databaseName: string;
  try {
    parsed = new URL(value || "");
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw reject();
  }

  const allowedQueryKeys = new Set(["schema", "connection_limit", "pool_timeout", "connect_timeout"]);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !/^tdata_(?:(?:khl_)?test|khl_browser)_[a-z0-9_]+$/.test(databaseName) ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((key) => !allowedQueryKeys.has(key)) ||
    parsed.searchParams.getAll("schema").some((schema) => schema !== "public")
  ) throw reject();

  return parsed.toString();
}
