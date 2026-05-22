import assert from "node:assert/strict";
import test from "node:test";
import { maskProxyUrl, parseProxyList } from "../src/lib/proxy/proxyPoolService";

test("parseProxyList accepts common proxy formats through one parser", () => {
  const parsed = parseProxyList([
    "http://user:pass@example.com:8080",
    "example.org:9000:login:secret",
    "login2:secret2:example.net:1080",
    "plain.example:3128",
  ].join("\n"));

  assert.equal(parsed.length, 4);
  assert.deepEqual(
    parsed.map((proxy) => [proxy.host, proxy.port, proxy.username, proxy.password]),
    [
      ["example.com", 8080, "user", "pass"],
      ["example.org", 9000, "login", "secret"],
      ["example.net", 1080, "login2", "secret2"],
      ["plain.example", 3128, null, null],
    ]
  );
});

test("maskProxyUrl hides credentials without losing endpoint identity", () => {
  const masked = maskProxyUrl("http://verylonguser:verysecret@example.com:8080");
  assert.equal(masked, "http://ve***er:***@example.com:8080/");
});
