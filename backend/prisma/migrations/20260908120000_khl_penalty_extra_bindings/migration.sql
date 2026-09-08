CREATE TABLE "KhlPenaltyExtraBinding" (
    "extraCode" TEXT NOT NULL,
    "adminExtraId" TEXT NOT NULL,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "adminConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminConfirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KhlPenaltyExtraBinding_pkey" PRIMARY KEY ("extraCode")
);
CREATE UNIQUE INDEX "KhlPenaltyExtraBinding_adminExtraId_key" ON "KhlPenaltyExtraBinding"("adminExtraId");
