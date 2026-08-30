import { PrismaClient } from "@prisma/client";

import { bootstrapTLineVolleyballPilot } from "../backend/src/tline/pilot/bootstrap";

const prisma = new PrismaClient();

async function main() {
  const result = await bootstrapTLineVolleyballPilot(prisma);
  console.log(JSON.stringify({
    ok: true,
    disciplineId: result.disciplineId,
    sportConfigId: result.sportConfigId,
    championshipIds: result.championshipIds,
    existingOperationalStatePreserved: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("TLine volleyball pilot bootstrap failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
