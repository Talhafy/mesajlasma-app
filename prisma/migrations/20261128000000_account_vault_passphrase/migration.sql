ALTER TABLE "AccountHistoryKey" ADD COLUMN "vaultApproval" JSONB;
ALTER TABLE "UserDevice" ADD COLUMN "approvedByVault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MlsCommit" ADD COLUMN "groupInfo" TEXT;
