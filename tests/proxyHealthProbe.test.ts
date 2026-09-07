import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { probeProxyConnection } from "../backend/src/proxy/healthProbe";
import { createLocalTunnelProxy, listenLocally } from "./helpers/localHttpServer";

test("proxy health probe reaches the target through a real CONNECT tunnel", async (t) => {
  let targetRequests = 0;
  const targetPort = await listenLocally(t, http.createServer((_request, response) => {
    targetRequests += 1;
    response.end('{"origin":"127.0.0.1"}');
  }));
  const proxy = await createLocalTunnelProxy(t, targetPort);

  await probeProxyConnection(`http://127.0.0.1:${proxy.port}`, { targetUrl: `http://127.0.0.1:${targetPort}/ip` });

  assert.equal(proxy.tunnels.length, 1);
  assert.equal(targetRequests, 1);
});

test("a dead proxy fails even when the target itself is reachable", async (t) => {
  let directRequests = 0;
  const targetPort = await listenLocally(t, http.createServer((_request, response) => {
    directRequests += 1;
    response.end("alive");
  }));
  // Закрытый локальный порт: ошибка прокси проверяется без обращения к сторонней сети.
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = (closed.address() as { port: number }).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  await assert.rejects(probeProxyConnection(`http://127.0.0.1:${closedPort}`, {
    targetUrl: `http://127.0.0.1:${targetPort}/ip`, timeoutMs: 500,
  }));
  assert.equal(directRequests, 0);
});

test("proxy probe denies target redirects without opening another tunnel", async (t) => {
  const targetPort = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(302, { Location: "http://unvisited.invalid/" }).end();
  }));
  const proxy = await createLocalTunnelProxy(t, targetPort);

  await assert.rejects(probeProxyConnection(`http://127.0.0.1:${proxy.port}`, {
    targetUrl: `http://127.0.0.1:${targetPort}/ip`,
  }), /Proxy connection failed/);
  assert.equal(proxy.tunnels.length, 1);
});

test("proxy probe keeps its deadline until the response body completes", async (t) => {
  const targetPort = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(200);
    response.write("partial");
  }));
  const proxy = await createLocalTunnelProxy(t, targetPort);

  await assert.rejects(probeProxyConnection(`http://127.0.0.1:${proxy.port}`, {
    targetUrl: `http://127.0.0.1:${targetPort}/ip`, timeoutMs: 80,
  }), /timed out/);
});
