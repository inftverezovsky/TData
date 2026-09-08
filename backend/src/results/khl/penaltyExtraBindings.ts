import { Prisma, type PrismaClient } from "@prisma/client";
import { isKhlPenaltyExtraCode, KHL_PENALTY_EXTRA_DEFINITIONS } from "./penaltyExtras";

type ErrorCode = "INVALID_BINDING" | "CONFIRMED_BINDING_IMMUTABLE" | "ADMIN_ID_COLLISION";
export class KhlPenaltyExtraBindingError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "KhlPenaltyExtraBindingError";
  }
}

export async function getKhlPenaltyExtraBindings(prisma: PrismaClient) {
  const stored = await prisma.khlPenaltyExtraBinding.findMany();
  return KHL_PENALTY_EXTRA_DEFINITIONS.map((definition) => {
    const binding = stored.find((item) => item.extraCode === definition.code);
    return {
      extraCode: definition.code, label: definition.label, kind: definition.kind,
      adminExtraId: binding?.adminExtraId ?? null,
      adminBindingStatus: binding?.adminBindingStatus ?? "UNMAPPED",
    };
  });
}

export async function confirmKhlPenaltyExtraBinding(prisma: PrismaClient, input: {
  extraCode: string; adminExtraId: string; confirmedBy: string;
}) {
  const extraCode = identifier(input.extraCode);
  const adminExtraId = identifier(input.adminExtraId);
  const confirmedBy = identifier(input.confirmedBy);
  if (!isKhlPenaltyExtraCode(extraCode)) throw new KhlPenaltyExtraBindingError("INVALID_BINDING", "Неизвестный доп.");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.khlPenaltyExtraBinding.findUnique({ where: { extraCode } });
        if (current?.adminBindingStatus === "CONFIRMED") {
          if (current.adminExtraId !== adminExtraId) throw new KhlPenaltyExtraBindingError(
            "CONFIRMED_BINDING_IMMUTABLE", "У этого допа уже подтверждён другой Admin ID."
          );
          return { binding: current, reused: true };
        }
        const collision = await tx.khlPenaltyExtraBinding.findUnique({ where: { adminExtraId } });
        if (collision && collision.extraCode !== extraCode) throw new KhlPenaltyExtraBindingError(
          "ADMIN_ID_COLLISION", "Этот Admin ID уже назначен другому допу."
        );
        const binding = await tx.khlPenaltyExtraBinding.upsert({
          where: { extraCode },
          create: { extraCode, adminExtraId, adminConfirmedBy: confirmedBy },
          update: { adminExtraId, adminBindingStatus: "CONFIRMED", adminConfirmedAt: new Date(), adminConfirmedBy: confirmedBy },
        });
        return { binding, reused: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof KhlPenaltyExtraBindingError) throw error;
      const code = (error as { code?: string })?.code;
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue;
      if (code === "P2002") throw new KhlPenaltyExtraBindingError("ADMIN_ID_COLLISION", "Admin ID уже занят.");
      throw error;
    }
  }
  throw new Error("KHL penalty extra confirmation retries exhausted.");
}

function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[^\s\x00-\x1f\x7f]{1,128}$/u.test(value.trim())) {
    throw new KhlPenaltyExtraBindingError("INVALID_BINDING", "ID должен содержать от 1 до 128 символов без пробелов.");
  }
  return value.trim();
}
