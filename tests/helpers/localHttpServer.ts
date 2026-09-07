import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { TestContext } from "node:test";

export async function listenLocally(t: TestContext, server: net.Server) {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    for (const socket of sockets) socket.destroy();
    server.close((error) => error ? reject(error) : resolve());
  }));
  return (server.address() as net.AddressInfo).port;
}

export async function createLocalTunnelProxy(t: TestContext, targetPort: number) {
  const tunnels: string[] = [];
  const sockets = new Set<Duplex>();
  const server = http.createServer((_request, response) => response.writeHead(502).end());
  server.on("connect", (request, incoming, head) => {
    if (request.url !== `127.0.0.1:${targetPort}`) {
      incoming.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    tunnels.push(request.url);
    const outgoing = net.connect(targetPort, "127.0.0.1", () => {
      incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) outgoing.write(head);
      incoming.pipe(outgoing).pipe(incoming);
    });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => { incoming.destroy(); outgoing.destroy(); });
    }
  });
  const port = await listenLocally(t, server);
  t.after(() => { for (const socket of sockets) socket.destroy(); });
  return { port, tunnels };
}

/** Одноразовый сертификат создаётся только в памяти; ключи не сохраняются в файлы и не выводятся. */
export function createEphemeralCertificate() {
  const windowsOpenSsl = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  const executable = process.platform === "win32" && existsSync(windowsOpenSsl) ? windowsOpenSsl : "openssl";
  const result = spawnSync(executable, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", "-", "-out", "-", "-subj", "/CN=admin.test",
    "-addext", "subjectAltName=DNS:admin.test",
  ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (result.status !== 0) throw new Error("Could not generate an ephemeral TLS certificate for the local transport test.");
  const key = result.stdout.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0];
  const cert = result.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  if (!key || !cert) throw new Error("Ephemeral TLS fixture generation returned no key/certificate.");
  return { key, cert };
}
