const ISOLATED_DATABASE_NAME = /^tdata_khl_(?:test|browser)_[a-z0-9_]+$/;

export function requireIsolatedKhlDatabaseUrl(value: string | undefined, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value || "");
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`${label} must use the PostgreSQL protocol.`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(`${label} must point to a loopback database host.`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!ISOLATED_DATABASE_NAME.test(databaseName)) {
    throw new Error(`${label} must use an isolated KHL test database name.`);
  }
  return parsed.toString();
}

export function requireSameDatabaseUrl(
  databaseUrl: string | undefined,
  testDatabaseUrl: string | undefined
) {
  const application = requireIsolatedKhlDatabaseUrl(databaseUrl, "DATABASE_URL");
  const inspection = requireIsolatedKhlDatabaseUrl(testDatabaseUrl, "TEST_DATABASE_URL");
  if (application !== inspection) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL must reference the same isolated database.");
  }
  return inspection;
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
