import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  portalCache?: Map<string, { data: any, timestamp: number }>;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

export function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, prop, value) {
    const client = getPrismaClient();
    return Reflect.set(client, prop, value, client);
  },
});

export const getPortalCache = () => {
  if (!globalForPrisma.portalCache) {
    globalForPrisma.portalCache = new Map();
  }
  return globalForPrisma.portalCache;
};

// Polyfill BigInt to allow JSON serialization
if (typeof BigInt !== "undefined") {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}
