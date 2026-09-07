import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface SendResult {
  rawResponse: string;
  status: "success" | "success_like" | "failed";
  errorMessage?: string;
}

/** Отправить на уже проверенный IP → дочитать ограниченное тело → закрыть ресурсы при любом исходе. */
export function sendPinnedAdminRequest(
  protocol: "http:" | "https:",
  options: https.RequestOptions,
  body: Buffer | string,
  limits = { timeoutMs: 15_000, maxResponseBytes: 1024 * 1024 },
): Promise<SendResult> {
  const agent = options.agent;
  return new Promise<SendResult>((resolve) => {
    let request: http.ClientRequest | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (result.status === "failed") request?.destroy();
      resolve(result);
    };
    const fail = (message: string) => finish({ rawResponse: "", status: "failed", errorMessage: message });

    try {
      if (!options.hostname || !net.isIP(options.hostname)) {
        fail("Admin destination must be a previously resolved IP address.");
        return;
      }
      const transport = protocol === "https:" ? https : http;
      request = transport.request(options, (response) => {
        // Redirect не переносит ни payload, ни авторизацию; вызывающий получает явный неуспех.
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
          response.destroy();
          fail("Admin API redirects are not allowed.");
          return;
        }

        const chunks: Buffer[] = [];
        let bytesRead = 0;
        response.on("data", (chunk: Buffer) => {
          bytesRead += chunk.length;
          if (bytesRead > limits.maxResponseBytes) {
            fail("Admin API response is too large.");
            return;
          }
          chunks.push(chunk);
        });
        response.on("aborted", () => fail("Admin API response ended before completion."));
        response.on("error", () => fail("Admin API response could not be read."));
        response.on("end", () => {
          const rawResponse = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode ?? 0;
          const success = statusCode >= 200 && statusCode < 300;
          const errorMessage = statusCode === 400 && rawResponse.includes("SSL certificate")
            ? "Внешний API требует client SSL certificate / mTLS. Проверьте ADMIN_MTLS_* настройки."
            : statusCode === 401 || statusCode === 403
              ? "Внешний API отклонил авторизацию. Проверьте логин/пароль/token/auth mode."
              : success ? undefined : `Admin API returned HTTP ${statusCode}.`;
          // Ошибочное тело внешнего сервиса может содержать секреты: в API и журнал уходит только контролируемый текст.
          finish({ rawResponse: success ? rawResponse : "", status: success ? rawResponse.trim() === "1" ? "success_like" : "success" : "failed", errorMessage });
        });
      });
      request.on("error", () => fail("Admin API connection failed."));
      // Абсолютный срок действует и при медленном непрерывном потоке, а не только при бездействии сокета.
      timeout = setTimeout(() => fail("Admin API request timed out."), limits.timeoutMs);
      request.end(body);
    } catch {
      fail("Admin API request could not be created.");
    }
  }).finally(() => {
    // mTLS-agent создаётся для одной отправки и не должен оставлять сокеты после завершения запроса.
    if (agent && typeof agent === "object") agent.destroy();
  });
}
