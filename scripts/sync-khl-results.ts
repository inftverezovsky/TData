import { PrismaClient } from "@prisma/client";
import { enqueueKhlSync, khlSyncRunView } from "@backend/results/khl/syncQueue";
import { runKhlWorkerTick, safeKhlWorkerError } from "@backend/results/khl/syncWorker";

const prisma = new PrismaClient();
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run sync:khl-results -- [--manual] [--full]\nDefault: one shared-lease automatic worker tick. --manual queues collection even while automation is paused.");
    return;
  }
  if (args.some((arg) => !["--manual", "--full"].includes(arg))) {
    throw new Error("Supported KHL sync options: --manual, --full. Use per-match refresh for a historical protocol.");
  }
  if (args.includes("--manual") || args.includes("--full")) {
    const queued = await enqueueKhlSync(prisma, { full: args.includes("--full") });
    console.log(JSON.stringify({ queued: khlSyncRunView(queued.run), reused: queued.reused }));
  }
  const run = await runKhlWorkerTick({ prisma, configured: process.env.KHL_RESULTS_AUTO_SYNC_ENABLED === "1" });
  console.log(JSON.stringify(run ? { run: khlSyncRunView(run) } : { idle: true }));
  if (run && ["FAILED", "PARTIAL"].includes(run.status)) process.exitCode = 1;
}
main().catch((cause) => {
  console.error("[KHL sync]", safeKhlWorkerError(cause)); process.exitCode = 2;
}).finally(() => prisma.$disconnect());
