import {
  KhlBindingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  isKhlPlayerExtraCode,
  type KhlPlayerExtraCode,
} from "@backend/results/khl/playerExtras";

export type KhlPlayerExtraBindingErrorCode =
  | "INVALID_BINDING"
  | "PLAYER_NOT_FOUND"
  | "CONFIRMED_BINDING_IMMUTABLE"
  | "ADMIN_ID_COLLISION";

export class KhlPlayerExtraBindingError extends Error {
  constructor(
    public readonly code: KhlPlayerExtraBindingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "KhlPlayerExtraBindingError";
  }
}

export type ConfirmKhlPlayerExtraBindingInput = {
  khlPlayerId: string;
  extraCode: KhlPlayerExtraCode;
  adminExtraId: string;
  adminExtraName?: string | null;
  confirmedBy: string;
};

const MAX_TRANSACTION_ATTEMPTS = 3;

export async function confirmKhlPlayerExtraBinding(
  prisma: PrismaClient,
  input: ConfirmKhlPlayerExtraBindingInput
) {
  const values = validateInput(input);

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const player = await tx.khlPlayer.findUnique({
          where: { khlPlayerId: values.khlPlayerId },
          select: { id: true, khlPlayerId: true },
        });
        if (!player) {
          throw new KhlPlayerExtraBindingError(
            "PLAYER_NOT_FOUND",
            "Игрок КХЛ не найден в сохранённой базе."
          );
        }

        const [current, collision] = await Promise.all([
          tx.khlPlayerExtraBinding.findUnique({
            where: {
              playerId_extraCode: {
                playerId: player.id,
                extraCode: values.extraCode,
              },
            },
          }),
          tx.khlPlayerExtraBinding.findUnique({
            where: { adminExtraId: values.adminExtraId },
          }),
        ]);

        if (current?.adminBindingStatus === KhlBindingStatus.CONFIRMED) {
          const nameConflicts = Boolean(
            values.adminExtraName
            && current.adminExtraName
            && values.adminExtraName !== current.adminExtraName
          );
          if (current.adminExtraId !== values.adminExtraId || nameConflicts) {
            throw new KhlPlayerExtraBindingError(
              "CONFIRMED_BINDING_IMMUTABLE",
              "Для этого допа игрока уже подтверждена другая привязка."
            );
          }
          return { binding: current, reused: true };
        }

        if (collision && collision.id !== current?.id) {
          throw new KhlPlayerExtraBindingError(
            "ADMIN_ID_COLLISION",
            "Этот Admin ID уже назначен другому допу игрока."
          );
        }

        const binding = await tx.khlPlayerExtraBinding.upsert({
          where: {
            playerId_extraCode: {
              playerId: player.id,
              extraCode: values.extraCode,
            },
          },
          create: {
            playerId: player.id,
            extraCode: values.extraCode,
            adminExtraId: values.adminExtraId,
            adminExtraName: values.adminExtraName,
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            adminConfirmedAt: new Date(),
            adminConfirmedBy: values.confirmedBy,
          },
          update: {
            adminExtraId: values.adminExtraId,
            adminExtraName: values.adminExtraName,
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            adminConfirmedAt: new Date(),
            adminConfirmedBy: values.confirmedBy,
          },
        });
        return { binding, reused: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof KhlPlayerExtraBindingError) throw error;
      const code = String((error as { code?: string })?.code || "");
      if (code === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      if (code === "P2002") {
        const existing = await prisma.khlPlayerExtraBinding.findFirst({
          where: {
            player: { khlPlayerId: values.khlPlayerId },
            extraCode: values.extraCode,
          },
        });
        if (
          existing?.adminBindingStatus === KhlBindingStatus.CONFIRMED
          && existing.adminExtraId === values.adminExtraId
          && !(
            values.adminExtraName
            && existing.adminExtraName
            && values.adminExtraName !== existing.adminExtraName
          )
        ) {
          return { binding: existing, reused: true };
        }
        throw new KhlPlayerExtraBindingError(
          "ADMIN_ID_COLLISION",
          "Этот Admin ID уже назначен другому допу игрока."
        );
      }
      throw error;
    }
  }

  throw new Error("KHL player-extra binding retry limit was exhausted.");
}

function validateInput(input: ConfirmKhlPlayerExtraBindingInput) {
  const khlPlayerId = positiveDecimal(input.khlPlayerId, "KHL player ID");
  const extraCode = boundedString(input.extraCode, "Код допа", 64);
  if (!isKhlPlayerExtraCode(extraCode)) {
    throw new KhlPlayerExtraBindingError("INVALID_BINDING", "Неизвестный код допа игрока.");
  }
  return {
    khlPlayerId,
    extraCode,
    adminExtraId: boundedString(input.adminExtraId, "Admin ID допа", 128),
    adminExtraName: nullableBoundedString(input.adminExtraName, "Название допа", 300),
    confirmedBy: boundedString(input.confirmedBy, "Автор подтверждения", 128),
  };
}

function positiveDecimal(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,127}$/.test(value.trim())) {
    throw new KhlPlayerExtraBindingError(
      "INVALID_BINDING",
      `${label} должен быть положительной десятичной строкой.`
    );
  }
  return value.trim();
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new KhlPlayerExtraBindingError(
      "INVALID_BINDING",
      `${label}: допустима непустая строка длиной до ${maxLength} символов.`
    );
  }
  return value.trim();
}

function nullableBoundedString(value: unknown, label: string, maxLength: number) {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, label, maxLength);
}
