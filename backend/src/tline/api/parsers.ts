import { TLineValidationError } from "./validation";

export function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requiredText(
  input: Record<string, unknown>,
  key: string,
  maxLength = 256,
) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw invalidInput(`${key} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

export function optionalText(
  input: Record<string, unknown>,
  key: string,
  maxLength = 256,
) {
  const value = input[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw invalidInput(`${key} must be null or a string no longer than ${maxLength} characters.`);
  }
  return value.trim() || null;
}

export function optionalBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalidInput(`${key} must be a boolean.`);
  return value;
}

export function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  bounds: { min: number; max: number },
) {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!Number.isSafeInteger(value) || Number(value) < bounds.min || Number(value) > bounds.max) {
    throw invalidInput(`${key} must be an integer from ${bounds.min} through ${bounds.max}, or null.`);
  }
  return Number(value);
}

export function parseSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    throw invalidInput("slug must contain lowercase Latin letters, digits and single hyphens.");
  }
  return slug;
}

export function parseId(value: string, name = "id") {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw invalidInput(`${name} is invalid.`);
  }
  return value;
}

export function parseIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw invalidInput("sourceTimezone must be a valid IANA timezone.");
  }
  return value;
}

function invalidInput(message: string) {
  return new TLineValidationError("INVALID_INPUT", message);
}
