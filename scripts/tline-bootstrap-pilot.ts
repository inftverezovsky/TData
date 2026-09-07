import { PrismaClient } from "@prisma/client";

import { bootstrapTLinePilots } from "../backend/src/tline/pilot/bootstrap";

const prisma = new PrismaClient();

async function main() {
  const result = await bootstrapTLinePilots(prisma);
  console.log(JSON.stringify({
    ok: true,
    sports: result.sports,
    existingOperationalStatePreserved: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("TLine pilot bootstrap failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
