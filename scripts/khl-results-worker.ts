import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { runKhlWorkerTick, safeKhlWorkerError } from "@backend/results/khl/syncWorker";

const prisma = new PrismaClient();
const owner = randomUUID();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

async function main() {
  while (!controller.signal.aborted) {
    try {
      const run = await runKhlWorkerTick({
        prisma, owner, signal: controller.signal,
        configured: process.env.KHL_RESULTS_AUTO_SYNC_ENABLED === "1",
      });
      if (run) console.log(JSON.stringify({ id: run.id, status: run.status, summary: run.summary, error: run.error }));
    } catch (cause) {
      console.error("[KHL worker]", safeKhlWorkerError(cause));
    }
    if (!controller.signal.aborted) await sleep(2_000);
  }
}

main().catch((cause) => {
  console.error("[KHL worker fatal]", safeKhlWorkerError(cause)); process.exitCode = 1;
}).finally(() => prisma.$disconnect());
