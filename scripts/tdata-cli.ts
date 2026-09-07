import { PrismaClient } from "@prisma/client";

async function checkDb(prisma: PrismaClient) {
  console.log("Checking database connection...");
  const startedAt = Date.now();
  const disciplineCount = await prisma.discipline.count();
  const tournamentCount = await prisma.tournament.count();
  const matchCount = await prisma.tournamentMatch.count();
  const proxyCount = await prisma.proxyPool.count();

  console.log(`Database connected. Statistics collected in ${Date.now() - startedAt}ms.`);
  console.log(`  Disciplines: ${disciplineCount}`);
  console.log(`  Tournaments: ${tournamentCount}`);
  console.log(`  Tournament matches: ${matchCount}`);
  console.log(`  Proxies: ${proxyCount}`);
}

async function clearCache(prisma: PrismaClient) {
  console.log("Clearing all cached search requests and parser logs...");
  const searchDel = await prisma.searchRequest.deleteMany();
  const logDel = await prisma.parserRequestLog.deleteMany();
  console.log(`Deleted ${searchDel.count} search entries and ${logDel.count} parser logs.`);
}

async function summarizeProxies(prisma: PrismaClient) {
  // Это сохранённая статистика пула; функция не выполняет сетевую проверку каждого прокси.
  const proxies = await prisma.proxyPool.findMany({
    select: { isActive: true, successCount: true, failCount: true },
  });
  if (proxies.length === 0) {
    console.log("No proxies found in the database.");
    return;
  }

  console.log(`Stored proxy statistics (${proxies.length} entries):`);
  for (const [index, proxy] of proxies.entries()) {
    const status = proxy.isActive ? "ACTIVE" : "BLOCKED";
    console.log(`  [${status}] Proxy #${index + 1}: successes=${proxy.successCount}, failures=${proxy.failCount}`);
  }
  const active = proxies.filter((proxy) => proxy.isActive).length;
  console.log(`Active: ${active}; blocked/cooldown: ${proxies.length - active}.`);
}

function showDeploymentChecklist() {
  console.log(`Deployment checklist only; readiness is not verified.
No deployment or server checks were executed.
  1. Follow docs/DEPLOYMENT_PORTAINER.md for the target environment.
  2. Inventory the target containers, Compose projects, ports and disk space.
  3. Verify the backup, deployment configuration and required runtime settings.
  4. Run the documented validation and confirm the application's health afterward.
This CLI does not perform these steps or start a deployment.`);
  process.exitCode = 1;
}

function showHelp() {
  console.log(`TDATA DEVELOPER CLI
Usage: npx tsx scripts/tdata-cli.ts [command]

Available commands:
  db:check        Verify the database connection and count stored records.
  cache:clear     Delete all cached search requests and parser logs.
  proxy:check     View stored proxy status and success/failure counts.
  deploy          Print an unverified deployment checklist (exit code 1).
  help            Display this command list.`);
}

async function main() {
  const command = process.argv[2] || "help";
  if (["help", "--help", "-h"].includes(command)) {
    showHelp();
    return;
  }
  if (command === "deploy") {
    showDeploymentChecklist();
    return;
  }
  if (!["db:check", "cache:clear", "proxy:check"].includes(command)) {
    console.error("Unknown command. Run 'npx tsx scripts/tdata-cli.ts help' for usage.");
    process.exitCode = 1;
    return;
  }

  // Клиент нужен только командам БД. Отключаем сырой вывод Prisma: ошибки могут содержать данные подключения.
  const prisma = new PrismaClient({ log: [] });
  try {
    if (command === "db:check") await checkDb(prisma);
    else if (command === "cache:clear") await clearCache(prisma);
    else await summarizeProxies(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("CLI command failed. Check the local database configuration and availability; no success is confirmed.");
  process.exitCode = 1;
});
