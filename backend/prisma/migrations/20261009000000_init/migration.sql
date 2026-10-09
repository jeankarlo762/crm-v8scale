-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SELLER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "metric" TEXT NOT NULL,
    "target" DECIMAL(65,30) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "document" TEXT,
    "city" TEXT,
    "state" TEXT,
    "source" TEXT,
    "segment" TEXT,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lostReason" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "expectedCloseAt" TIMESTAMP(3),
    "stageId" TEXT NOT NULL,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "leadId" TEXT,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "document" TEXT,
    "mrrValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "churnedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nicho" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "termosBusca" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nicho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "placeId" TEXT,
    "nichoId" TEXT,
    "arenaName" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "addressComponents" JSONB,
    "contactName" TEXT,
    "whatsapp" TEXT,
    "phoneE164" TEXT,
    "phoneCountry" TEXT,
    "phoneMobile" BOOLEAN,
    "ownerGroupId" TEXT,
    "instagram" TEXT,
    "website" TEXT,
    "destinoReal" TEXT,
    "statusSite" TEXT NOT NULL DEFAULT 'sem_site',
    "siteUrl" TEXT,
    "linksEncontrados" JSONB,
    "fonte" TEXT,
    "verificadoEm" TIMESTAMP(3),
    "siteStatus" TEXT,
    "instagramHandle" TEXT,
    "foundWebsite" TEXT,
    "foundSiteStatus" TEXT,
    "instagramVerificar" BOOLEAN NOT NULL DEFAULT false,
    "foundWebsiteVerificar" BOOLEAN NOT NULL DEFAULT false,
    "foundWebsiteSource" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "enrichError" TEXT,
    "instagramFollowers" INTEGER,
    "instagramMediaCount" INTEGER,
    "businessDiscoveryCheckedAt" TIMESTAMP(3),
    "siteCheckReason" TEXT,
    "foundSiteCheckReason" TEXT,
    "instagramManual" BOOLEAN NOT NULL DEFAULT false,
    "siteManual" BOOLEAN NOT NULL DEFAULT false,
    "confirmedWebsite" TEXT,
    "websiteStatus" TEXT,
    "websiteConfidence" DOUBLE PRECISION,
    "websiteEvidence" JSONB,
    "websiteDecidedAt" TIMESTAMP(3),
    "websiteReason" TEXT,
    "websiteCoverage" JSONB,
    "websiteConfirmation" JSONB,
    "classifierVersion" TEXT,
    "websiteOutcome" TEXT,
    "websiteValidUntil" TIMESTAMP(3),
    "investigationState" TEXT,
    "investigationNextAction" TEXT,
    "investigationAttempts" INTEGER NOT NULL DEFAULT 0,
    "investigationNextRunAt" TIMESTAMP(3),
    "investigationWaitReason" TEXT,
    "investigationLastError" TEXT,
    "investigationLockedBy" TEXT,
    "investigationLockedUntil" TIMESTAMP(3),
    "investigationLockToken" TEXT,
    "investigationForceAt" TIMESTAMP(3),
    "investigationPriority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avaliacao" DOUBLE PRECISION,
    "numAvaliacoes" INTEGER,
    "googleMapsUrl" TEXT,
    "primaryType" TEXT,
    "sports" TEXT,
    "courtsInfo" TEXT,
    "currentSystem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'nao_contatado',
    "notes" TEXT,
    "responsavel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "convertedLeadId" TEXT,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buscas_log" (
    "id" TEXT NOT NULL,
    "nicho_id" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "num_chamadas" INTEGER NOT NULL DEFAULT 1,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buscas_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "targetStatus" TEXT NOT NULL,
    "nichoId" TEXT,
    "nichoNome" TEXT,
    "estado" TEXT,
    "cidade" TEXT,
    "limite" INTEGER,
    "publico" TEXT NOT NULL DEFAULT 'legacy_unverified',
    "selecionados" BOOLEAN NOT NULL DEFAULT false,
    "responsavelId" TEXT,
    "delayMinSec" INTEGER NOT NULL DEFAULT 5,
    "delayMaxSec" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "prospectId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageUsed" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "skipReason" TEXT,
    "repliedAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAuth" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "WhatsAppAuth_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "SystemAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "channel" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "recipient" TEXT,
    "message" TEXT,
    "error" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvidence" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "outcome" TEXT,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dependsOn" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "outcome" TEXT,
    "response" JSONB,
    "collectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "inFlightUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ApiQuotaConfig" (
    "provider" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuotaConfig_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ProviderState" (
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderState_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Goal_periodStart_periodEnd_idx" ON "Goal"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Goal_ownerId_idx" ON "Goal"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Stage_position_idx" ON "Stage"("position");

-- CreateIndex
CREATE INDEX "Lead_stageId_idx" ON "Lead"("stageId");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Activity_leadId_createdAt_idx" ON "Activity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_assigneeId_done_dueAt_idx" ON "Task"("assigneeId", "done", "dueAt");

-- CreateIndex
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_leadId_key" ON "Customer"("leadId");

-- CreateIndex
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Nicho_nome_key" ON "Nicho"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_placeId_key" ON "Prospect"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_convertedLeadId_key" ON "Prospect"("convertedLeadId");

-- CreateIndex
CREATE INDEX "Prospect_status_idx" ON "Prospect"("status");

-- CreateIndex
CREATE INDEX "Prospect_state_idx" ON "Prospect"("state");

-- CreateIndex
CREATE INDEX "Prospect_investigationState_investigationNextRunAt_idx" ON "Prospect"("investigationState", "investigationNextRunAt");

-- CreateIndex
CREATE INDEX "Prospect_nichoId_websiteStatus_idx" ON "Prospect"("nichoId", "websiteStatus");

-- CreateIndex
CREATE INDEX "Prospect_nichoId_statusSite_idx" ON "Prospect"("nichoId", "statusSite");

-- CreateIndex
CREATE INDEX "Prospect_ownerGroupId_idx" ON "Prospect"("ownerGroupId");

-- CreateIndex
CREATE INDEX "Prospect_nichoId_leadScore_idx" ON "Prospect"("nichoId", "leadScore");

-- CreateIndex
CREATE INDEX "buscas_log_nicho_id_cidade_criado_em_idx" ON "buscas_log"("nicho_id", "cidade", "criado_em");

-- CreateIndex
CREATE INDEX "buscas_log_criado_em_idx" ON "buscas_log"("criado_em");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_idx" ON "CampaignRecipient"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_sentAt_idx" ON "CampaignRecipient"("status", "sentAt");

-- CreateIndex
CREATE INDEX "SystemAlert_tenantId_idx" ON "SystemAlert"("tenantId");

-- CreateIndex
CREATE INDEX "SystemAlert_tenantId_resolved_idx" ON "SystemAlert"("tenantId", "resolved");

-- CreateIndex
CREATE INDEX "LeadEvidence_prospectId_idx" ON "LeadEvidence"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEvidence_prospectId_source_type_key_key" ON "LeadEvidence"("prospectId", "source", "type", "key");

-- CreateIndex
CREATE INDEX "ApiCache_provider_expiresAt_idx" ON "ApiCache"("provider", "expiresAt");

-- CreateIndex
CREATE INDEX "ApiUsage_provider_idx" ON "ApiUsage"("provider");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_nichoId_fkey" FOREIGN KEY ("nichoId") REFERENCES "Nicho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_convertedLeadId_fkey" FOREIGN KEY ("convertedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_nichoId_fkey" FOREIGN KEY ("nichoId") REFERENCES "Nicho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvidence" ADD CONSTRAINT "LeadEvidence_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

