-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientDocument" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "clientAddress" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Contrato de Prestação de Serviços',
    "serviceObject" TEXT,
    "monthlyValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentDay" INTEGER,
    "startDate" TIMESTAMP(3),
    "durationMonths" INTEGER,
    "bodyText" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "zapsignToken" TEXT,
    "signUrl" TEXT,
    "signedPdfUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZapSignConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "apiTokenEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZapSignConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");

-- CreateIndex
CREATE INDEX "Contract_zapsignToken_idx" ON "Contract"("zapsignToken");

-- CreateIndex
CREATE INDEX "Contract_createdAt_idx" ON "Contract"("createdAt");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
