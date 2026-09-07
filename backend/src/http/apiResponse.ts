import { NextResponse } from "next/server";

/** Только ошибки, созданные границей API, могут передавать текст в ответ клиенту. */
export class ApiRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function safeErrorMessage(error: unknown, fallback = "Не удалось выполнить запрос.") {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function apiErrorResponse(error: unknown, fallback = "Не удалось выполнить запрос.", status = 500) {
  const known = error instanceof ApiRequestError;
  return NextResponse.json({
    ok: false,
    code: known ? error.code : status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST",
    error: safeErrorMessage(error, fallback),
  }, { status: known ? error.status : status, headers: { "Cache-Control": "no-store" } });
}

export function logApiError(operation: string, error: unknown) {
  // Не читаем message/stack/name: внешняя библиотека может поместить туда URL, токен или тело запроса.
  const errorClass = error instanceof ApiRequestError ? "ApiRequestError"
    : error instanceof SyntaxError ? "SyntaxError"
      : error instanceof TypeError ? "TypeError"
        : error instanceof Error ? "Error" : "UnknownError";
  console.error(operation, { errorClass });
}
