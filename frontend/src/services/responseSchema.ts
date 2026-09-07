export type Decoder<T> = (value: unknown, path?: string) => T;

function invalid(path: string): never { throw new Error(`Некорректный ответ сервера: ${path}.`); }
export const textValue: Decoder<string> = (value, path = "строка") => typeof value === "string" ? value : invalid(path);
export const numberValue: Decoder<number> = (value, path = "число") => typeof value === "number" && Number.isFinite(value) ? value : invalid(path);
export const booleanValue: Decoder<boolean> = (value, path = "флаг") => typeof value === "boolean" ? value : invalid(path);
export const recordValue: Decoder<Record<string, unknown>> = (value, path = "объект") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(path);
  return value as Record<string, unknown>;
};

export function optional<T>(decode: Decoder<T>): Decoder<T | undefined> {
  return (value, path) => value === undefined ? undefined : decode(value, path);
}
export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => value === null ? null : decode(value, path);
}
export function withDefault<T>(decode: Decoder<T>, fallback: T): Decoder<T> {
  return (value, path) => value === undefined ? fallback : decode(value, path);
}
export function list<T>(decode: Decoder<T>): Decoder<T[]> {
  return (value, path = "список") => {
    if (!Array.isArray(value)) return invalid(path);
    return value.map((item, index) => decode(item, `${path}[${index}]`));
  };
}
export function enumValue<const T extends readonly (string | null)[]>(values: T): Decoder<T[number]> {
  return (value, path = "значение") => values.includes(value as T[number]) ? value as T[number] : invalid(path);
}
export function objectValue<T extends Record<string, Decoder<unknown>>>(fields: T): Decoder<{ [K in keyof T]: ReturnType<T[K]> }> {
  return (value, path = "ответ") => {
    const record = recordValue(value, path);
    // Каждый ключ проходит собственный декодер; дополнительные поля API не попадают в модель UI.
    return Object.fromEntries(Object.entries(fields).map(([key, decode]) => [key, decode(record[key], `${path}.${key}`)])) as { [K in keyof T]: ReturnType<T[K]> };
  };
}
export async function readJsonResponse<T>(response: Response, decode: Decoder<T>, fallback: string): Promise<T> {
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    throw new Error(typeof record?.error === "string" ? record.error : `${fallback} (HTTP ${response.status})`);
  }
  return decode(raw);
}
