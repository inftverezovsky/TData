import type { PrismaClient } from "@prisma/client";

export const KHL_RESULTS_AUTO_SYNC_PAUSED_KEY = "khl_results_auto_sync_paused";

export type KhlResultsAutomationStatus = {
  configured: boolean;
  paused: boolean;
  enabled: boolean;
};

export async function getKhlResultsAutomationStatus(
  prisma: PrismaClient,
  configured: boolean
): Promise<KhlResultsAutomationStatus> {
  const setting = await prisma.globalSettings.findUnique({
    where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
    select: { value: true },
  });
  const paused = setting?.value === "1";
  return { configured, paused, enabled: configured && !paused };
}

export async function setKhlResultsAutoSyncPaused(
  prisma: PrismaClient,
  paused: boolean,
  configured: boolean
): Promise<KhlResultsAutomationStatus> {
  await prisma.globalSettings.upsert({
    where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
    create: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, value: paused ? "1" : "0" },
    update: { value: paused ? "1" : "0" },
  });
  return { configured, paused, enabled: configured && !paused };
}

export async function runKhlResultsAutoSync<Result>(input: {
  prisma: PrismaClient;
  configured: boolean;
  run: () => Promise<Result>;
}): Promise<
  | { executed: false; reason: "NOT_CONFIGURED" | "PAUSED"; automation: KhlResultsAutomationStatus }
  | { executed: true; automation: KhlResultsAutomationStatus; result: Result }
> {
  const automation = await getKhlResultsAutomationStatus(input.prisma, input.configured);
  if (!automation.configured) return { executed: false, reason: "NOT_CONFIGURED", automation };
  if (automation.paused) return { executed: false, reason: "PAUSED", automation };
  return { executed: true, automation, result: await input.run() };
}
