export type RequestAuthentication = () => Promise<boolean>;

/** Повторяем только запрос, отклонённый до отправки из-за отсутствия сессии, и не более одного раза. */
export async function authenticatedRequest(
  url: string,
  init: RequestInit,
  authenticate: RequestAuthentication,
  fetchRequest: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetchRequest(url, init);
  if (response.status !== 401 || init.signal?.aborted) return response;
  if (!await authenticate() || init.signal?.aborted) return response;
  return fetchRequest(url, init);
}
