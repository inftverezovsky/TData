import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const proxies = await prisma.proxyPool.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ proxies });
  } catch (error: any) {
    console.error("[Proxy List API Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function parseRawProxy(line: string) {
  let clean = line.trim();
  if (!clean) return null;

  // Skip headers or labels
  if (
    clean.toUpperCase().startsWith("HTTP") || 
    clean.toUpperCase().startsWith("SOCKS") || 
    clean.includes("Россия") || 
    clean.includes("Иностранные")
  ) {
    return null;
  }

  let protocol = "http";
  const protoMatch = clean.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    clean = clean.substring(protoMatch[0].length);
  }

  let host = "";
  let port = 0;
  let username = "";
  let password = "";

  if (clean.includes("@")) {
    const parts = clean.split("@");
    const firstPart = parts[0];
    const secondPart = parts[1];

    const firstPartIsHostPort = /^[a-zA-Z0-9.-]+:\d+$/.test(firstPart);

    if (firstPartIsHostPort) {
      const [h, p] = firstPart.split(":");
      host = h;
      port = parseInt(p);
      const [u, pass] = secondPart.split(":");
      username = u || "";
      password = pass || "";
    } else {
      const [u, pass] = firstPart.split(":");
      username = u || "";
      password = pass || "";
      const [h, p] = secondPart.split(":");
      host = h;
      port = parseInt(p);
    }
  } else {
    const parts = clean.split(":");
    if (parts.length === 4) {
      const secondIsPort = /^\d+$/.test(parts[1]);
      if (secondIsPort) {
        host = parts[0];
        port = parseInt(parts[1]);
        username = parts[2];
        password = parts[3];
      } else {
        username = parts[0];
        password = parts[1];
        host = parts[2];
        port = parseInt(parts[3]);
      }
    } else if (parts.length === 2) {
      host = parts[0];
      port = parseInt(parts[1]);
    } else {
      return null;
    }
  }

  if (!host || isNaN(port) || port <= 0 || port > 65535) {
    return null;
  }

  let url = `${protocol}://`;
  if (username && password) {
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (username) {
    url += `${encodeURIComponent(username)}@`;
  }
  url += `${host}:${port}`;

  return {
    url,
    protocol,
    host,
    port,
    username: username || null,
    password: password || null,
  };
}

export async function POST(request: Request) {
  try {
    const { proxiesText } = await request.json();

    if (!proxiesText || typeof proxiesText !== "string") {
      return NextResponse.json({ error: "Необходим параметр proxiesText" }, { status: 400 });
    }

    const lines = proxiesText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const parsedProxies: Array<{
      url: string;
      protocol: string;
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    }> = [];

    for (const line of lines) {
      const parsed = parseRawProxy(line);
      if (parsed) {
        parsedProxies.push(parsed);
      }
    }

    if (parsedProxies.length === 0) {
      return NextResponse.json({ error: "Не удалось распарсить ни одного прокси" }, { status: 400 });
    }

    let inserted = 0;
    for (const proxy of parsedProxies) {
      try {
        await prisma.proxyPool.upsert({
          where: { url: proxy.url },
          update: { isActive: true, failCount: 0, cooldownUntil: null, lastError: null },
          create: {
            url: proxy.url,
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
            isActive: true,
          },
        });
        inserted++;
      } catch (err) {
        // Skip duplicate unique URL errors
        continue;
      }
    }

    return NextResponse.json({ success: true, inserted });
  } catch (error: any) {
    console.error("[Proxy Bulk Upload Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { action } = await request.json().catch(() => ({}));
    if (action === "clear-blocked") {
      const deleted = await prisma.proxyPool.deleteMany({
        where: { isActive: false },
      });
      return NextResponse.json({ success: true, count: deleted.count });
    }

    if (action === "clear-all") {
      const deleted = await prisma.proxyPool.deleteMany();
      return NextResponse.json({ success: true, count: deleted.count });
    }

    return NextResponse.json({ error: "Неверный параметр action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
