import { prisma } from "../db/db";
import { constantTimeEqual, hashAdminPassword, hashStoredAdminPassword, isPasswordHash, verifyPasswordHash } from "./passwordHash";

export interface AdminCredentialStore {
  read(): Promise<string | null>;
  replaceLegacy(expected: string, next: string): Promise<boolean>;
}

const databaseStore: AdminCredentialStore = {
  async read() {
    const setting = await prisma.globalSettings.findUnique({ where: { key: "admin_password" }, select: { value: true } });
    return setting?.value || null;
  },
  async replaceLegacy(expected, next) {
    const updated = await prisma.globalSettings.updateMany({
      where: { key: "admin_password", value: expected }, data: { value: next },
    });
    return updated.count === 1;
  },
};

export async function readAdminCredential(
  store: AdminCredentialStore = databaseStore,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (environment.ADMIN_PASSWORD) return { value: environment.ADMIN_PASSWORD, source: "environment" as const };
  const stored = await store.read();
  if (stored) return { value: stored, source: "database" as const };
  return environment.NODE_ENV === "production" ? null : { value: "63016", source: "development" as const };
}

export async function verifyAdminCredential(
  password: string,
  store: AdminCredentialStore = databaseStore,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ sessionBinding: string } | null> {
  if (!password || Buffer.byteLength(password) > 1024) return null;
  const credential = await readAdminCredential(store, environment);
  if (!credential) return null;
  const hashed = credential.source === "database" && isPasswordHash(credential.value);
  const valid = hashed ? await verifyPasswordHash(password, credential.value) : constantTimeEqual(password, credential.value);
  if (!valid) return null;
  if (credential.source === "environment") {
    // Приоритет env сохраняется, но успешный вход удаляет и старый plaintext из БД, даже если он не используется.
    const legacy = await store.read();
    if (legacy && !isPasswordHash(legacy)) {
      await store.replaceLegacy(legacy, await hashStoredAdminPassword(legacy));
    }
  }
  if (credential.source !== "database" || hashed) return { sessionBinding: credential.value };

  // Мигрируем только успешно проверенный legacy-пароль; CAS не перезаписывает параллельную смену пароля.
  const replacement = await hashAdminPassword(password);
  if (await store.replaceLegacy(credential.value, replacement)) return { sessionBinding: replacement };
  const current = await store.read();
  return current && isPasswordHash(current) && await verifyPasswordHash(password, current)
    ? { sessionBinding: current } : null;
}
