import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import fetch from "node-fetch";

export class ProxyProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyProbeError";
  }
}

/** Проверка обязана пройти через proxy-agent; native fetch игнорирует Node-параметр agent. */
export async function probeProxyConnection(proxyUrl: string, options: { targetUrl?: string; timeoutMs?: number } = {}) {
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    const protocol = new URL(proxyUrl).protocol;
    if (!["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(protocol)) {
      throw new ProxyProbeError("Unsupported proxy protocol.");
    }
    agent = protocol.startsWith("socks") ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    const response = await fetch(options.targetUrl ?? "https://httpbin.org/ip", {
      agent,
      signal: controller.signal,
      redirect: "error",
      size: 64 * 1024,
      headers: { "User-Agent": "TData-Proxy-Health-Check" },
    });
    if (!response.ok) throw new ProxyProbeError(`Proxy target HTTP ${response.status}`);
    // Проверка завершается после тела ответа: зависший stream тоже ограничен timeout и лимитом размера.
    await response.arrayBuffer();
    return { latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof ProxyProbeError) throw error;
    throw new ProxyProbeError(controller.signal.aborted ? "Proxy check timed out." : "Proxy connection failed.");
  } finally {
    clearTimeout(timeout);
    agent?.destroy();
  }
}
