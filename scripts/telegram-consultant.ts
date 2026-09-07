import { prisma } from "../backend/src/db/db";
import { readConsultantConfig } from "../backend/src/consultant/config";
import { runTelegramConsultant } from "../backend/src/consultant/runner";
import { sanitizeExternalText } from "../backend/src/consultant/consultant";
import { selectTelegramProxyUrls } from "../backend/src/monitoring/parserMonitorTelegram";

async function main() {
  const config = readConsultantConfig(process.env);
  const proxies = await selectTelegramProxyUrls();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runTelegramConsultant({ config, proxyUrls: proxies, signal: controller.signal });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error("Telegram consultant stopped:", sanitizeExternalText(message).slice(0, 300));
  process.exitCode = 1;
});
