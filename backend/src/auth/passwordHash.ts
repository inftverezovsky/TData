import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ApiRequestError } from "../http/apiResponse";

const COST = 131072;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 32;
const MAX_PASSWORD_BYTES = 1024;
const PREFIX = `scrypt$v1$${COST}$${BLOCK_SIZE}$${PARALLELISM}$`;

export async function hashAdminPassword(password: string) {
  if (!password || Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new ApiRequestError("INVALID_PASSWORD", 400, "Пароль должен содержать от 1 до 1024 байт.");
  }
  return hashStoredAdminPassword(password);
}

/** Миграция уже сохранённого значения не оставляет plaintext из-за нового лимита длины для ввода. */
export async function hashStoredAdminPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return `${PREFIX}${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPasswordHash(password: string, encoded: string) {
  if (!password || Buffer.byteLength(password) > MAX_PASSWORD_BYTES || !encoded.startsWith(PREFIX)) return false;
  const parts = encoded.slice(PREFIX.length).split("$");
  if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return false;
  const actual = await derive(password, Buffer.from(parts[0], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[1], "hex"));
}

export function isPasswordHash(value: string) {
  return value.startsWith("scrypt$");
}

export function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function derive(password: string, salt: Buffer) {
  // Параметры фиксированы сервером: строка из БД не может увеличить стоимость вычисления.
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 160 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}
