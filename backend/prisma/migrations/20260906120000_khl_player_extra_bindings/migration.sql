-- CreateTable
CREATE TABLE "KhlPlayerExtraBinding" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "extraCode" TEXT NOT NULL,
    "adminExtraId" TEXT,
    "adminExtraName" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlPlayerExtraBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayerExtraBinding_adminExtraId_key"
ON "KhlPlayerExtraBinding"("adminExtraId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayerExtraBinding_playerId_extraCode_key"
ON "KhlPlayerExtraBinding"("playerId", "extraCode");

-- CreateIndex
CREATE INDEX "KhlPlayerExtraBinding_adminBindingStatus_idx"
ON "KhlPlayerExtraBinding"("adminBindingStatus");

-- AddForeignKey
ALTER TABLE "KhlPlayerExtraBinding"
ADD CONSTRAINT "KhlPlayerExtraBinding_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "KhlPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
