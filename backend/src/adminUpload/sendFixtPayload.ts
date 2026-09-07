import type https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';
import { getAdminHttpClientOptions } from './adminHttpClient';
import { resolveOutboundTarget } from '@backend/http/outboundPolicy';
import { safeErrorMessage } from '@backend/http/apiResponse';
import { sendPinnedAdminRequest, type SendResult } from './pinnedTransport';

export type { SendResult } from './pinnedTransport';

/**
 * Проверить разрешённый адрес Admin → упаковать готовый fixt → выполнить один POST →
 * вернуть классификацию HTTP-ответа. Ограничения времени и размера удерживают сетевой запрос в пределах.
 * Подготовка матчей, проверка дублей и решение об отправке выполняются вызывающим слоем.
 */
export async function sendFixtPayload(
  apiUrl: string,
  serializedData: string,
  mode: string = 'legacy_raw',
  sslVerify: boolean = true
): Promise<SendResult> {
  let url: URL;
  let checkedAddress: string;
  try {
    const resolved = await resolveOutboundTarget(apiUrl, {
      policyName: 'Admin API',
      allowedHostsEnv: [
        process.env.ADMIN_UPLOAD_ALLOWED_HOSTS,
        process.env.EXTERNAL_PLATFORM_ALLOWED_HOSTS,
      ],
      allowInsecureHttpEnv: process.env.ADMIN_UPLOAD_ALLOW_INSECURE_HTTP,
      allowPrivateHostsEnv: process.env.ADMIN_UPLOAD_ALLOW_PRIVATE_HOSTS,
      allowAnyPublicHostEnv: process.env.ADMIN_UPLOAD_ALLOW_ANY_PUBLIC_HOST,
      requireAllowedHostsInProduction: true,
    });
    url = resolved.url;
    checkedAddress = resolved.address;
  } catch (error: unknown) {
    return {
      rawResponse: '',
      status: 'failed',
      errorMessage: safeErrorMessage(error, 'Admin API destination is unavailable.'),
    };
  }

  try {
    const isHttps = url.protocol === 'https:';

    let body: Buffer | string;
    const headers: Record<string, string> = {};

    if (mode === 'legacy_raw') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = `fixt=${encodeURIComponent(serializedData)}`;
    } else if (mode === 'urlencoded') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = `fixt=${encodeURIComponent(serializedData)}`;
    } else if (mode === 'multipart') {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      body = `--${boundary}\r\nContent-Disposition: form-data; name="fixt"\r\n\r\n${serializedData}\r\n--${boundary}--\r\n`;
    } else {
      body = `fixt=${serializedData}`;
    }

    // Авторизация берётся только из серверной конфигурации; сертификат нужен для HTTPS.
    const { agent, headers: authHeaders } = getAdminHttpClientOptions();
    if (!isHttps) agent?.destroy();

    const options: https.RequestOptions = {
      method: 'POST',
      // IP зафиксирован результатом policy. Исходное имя остаётся в Host и SNI для virtual host и TLS-проверки.
      hostname: checkedAddress,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
      headers: {
        ...headers,
        ...authHeaders,
        'Host': url.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Content-Length': Buffer.byteLength(body),
      },
      agent: isHttps ? agent : undefined,
      rejectUnauthorized: sslVerify,
    };

    return sendPinnedAdminRequest(isHttps ? 'https:' : 'http:', options, body);
  } catch (error: unknown) {
    return {
      rawResponse: '',
      status: 'failed',
      errorMessage: safeErrorMessage(error, 'Admin API configuration failed.'),
    };
  }
}
