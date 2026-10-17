-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "aiActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiQualification" JSONB,
ADD COLUMN "aiMessageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiAssumedAt" TIMESTAMP(3),
ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "aiStageId" TEXT,
    "sellerStageId" TEXT,
    "storeName" TEXT,
    "instructions" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-haiku-5-5',
    "distribution" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "lastAssignedUserId" TEXT,
    "reviewLink" TEXT,
    "reviewMessage" TEXT,
    "reviewAutoSend" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" TEXT,
    "year" INTEGER,
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "km" INTEGER,
    "color" TEXT,
    "fuel" TEXT,
    "transmission" TEXT,
    "plate" TEXT,
    "description" TEXT,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE INDEX "AiMessage_leadId_createdAt_idx" ON "AiMessage"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
