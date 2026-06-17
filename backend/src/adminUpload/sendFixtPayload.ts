import https from 'https';
import http from 'http';
import { URL } from 'url';
import { getAdminHttpClientOptions } from './adminHttpClient';
import { validateOutboundUrl } from '@backend/http/outboundPolicy';

const ADMIN_REQUEST_TIMEOUT_MS = 15000;
const MAX_ADMIN_RESPONSE_BYTES = 1024 * 1024;

export interface SendResult {
  rawResponse: string;
  status: 'success' | 'success_like' | 'failed';
  errorMessage?: string;
}

export async function sendFixtPayload(
  apiUrl: string,
  serializedData: string,
  mode: string = 'legacy_raw',
  sslVerify: boolean = true
): Promise<SendResult> {
  let url: URL;
  try {
    url = new URL(apiUrl);
    await validateOutboundUrl(url, {
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
  } catch (error: any) {
    return {
      rawResponse: '',
      status: 'failed',
      errorMessage: error.message,
    };
  }

  return new Promise((resolve) => {
    try {
      const isHttps = url.protocol === 'https:';

      let body: Buffer | string;
      let headers: Record<string, string> = {};

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

      // Get backend-configured mTLS agent and Auth headers
      const { agent, headers: authHeaders } = getAdminHttpClientOptions();

      const options: https.RequestOptions = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        servername: url.hostname,
        headers: {
          ...headers,
          ...authHeaders,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': '*/*',
          'Content-Length': Buffer.byteLength(body),
        },
        agent: isHttps ? agent : undefined,
        rejectUnauthorized: sslVerify,
      };

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => {
          if (Buffer.byteLength(data) + Buffer.byteLength(chunk) > MAX_ADMIN_RESPONSE_BYTES) {
            req.destroy(new Error('Admin API response is too large'));
            return;
          }

          data += chunk;
        });
        res.on('end', () => {
          let status: 'success' | 'success_like' | 'failed' = 'failed';
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            status = data.trim() === '1' ? 'success_like' : 'success';
          }

          let errorMessage = undefined;
          if (res.statusCode === 400 && data.includes('SSL certificate')) {
            errorMessage = "Внешний API требует client SSL certificate / mTLS. Проверьте ADMIN_MTLS_* настройки.";
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            errorMessage = "Внешний API отклонил авторизацию. Проверьте логин/пароль/token/auth mode.";
          }

          resolve({
            rawResponse: data,
            status,
            errorMessage,
          });
        });
      });

      req.on('error', (err: any) => {
        resolve({
          rawResponse: '',
          status: 'failed',
          errorMessage: err.message,
        });
      });

      req.setTimeout(ADMIN_REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Admin API request timed out'));
      });

      req.write(body);
      req.end();
    } catch (error: any) {
      resolve({
        rawResponse: '',
        status: 'failed',
        errorMessage: error.message,
      });
    }
  });
}
