import { ApiRequestError } from "../http/apiResponse";
import { hashAdminPassword } from "../auth/passwordHash";

export function isSecretSetting(key: string) {
  return /password|secret|token|api[_-]?key/i.test(key);
}

export async function prepareGlobalSettingEntries(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidSettings();
  const entries = Object.entries(input);
  if (entries.length > 256) throw invalidSettings();
  const prepared: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of entries) {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key)
      || !["string", "number", "boolean"].includes(typeof raw)) throw invalidSettings();
    const value = String(raw);
    if (Buffer.byteLength(value) > 65536) throw invalidSettings();
    if (isSecretSetting(key) && value === "") continue;
    // Пароль администратора никогда не передаётся в Prisma открытым текстом.
    prepared.push({ key, value: key === "admin_password" ? await hashAdminPassword(value) : value });
  }
  return prepared;
}

function invalidSettings() {
  return new ApiRequestError("INVALID_SETTINGS", 400, "Некорректный формат настроек.");
}
