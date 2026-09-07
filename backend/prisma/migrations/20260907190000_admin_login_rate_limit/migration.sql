-- Shared login throttling across application processes. Keys are digests, never raw addresses.
CREATE TABLE "AdminLoginRateLimit" (
    "key" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminLoginRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AdminLoginRateLimit_expiresAt_idx" ON "AdminLoginRateLimit"("expiresAt");
