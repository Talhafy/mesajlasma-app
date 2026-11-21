-- AlterTable
ALTER TABLE "Conversation"
ADD COLUMN "mlsCurrentEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "mlsGroupId" TEXT;

-- AlterTable
ALTER TABLE "Message"
ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "epoch" INTEGER,
ADD COLUMN "senderDeviceId" TEXT,
ADD COLUMN "ciphertext" TEXT,
ADD COLUMN "encryptedFileMetadata" TEXT,
ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN "isDeletedForEveryone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScheduledMessage"
ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "epoch" INTEGER,
ADD COLUMN "senderDeviceId" TEXT,
ADD COLUMN "ciphertext" TEXT,
ADD COLUMN "encryptedFileMetadata" TEXT;

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL DEFAULT 'Web Browser',
    "signaturePublicKey" TEXT NOT NULL,
    "credential" TEXT NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlsKeyPackage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyPackage" TEXT NOT NULL,
    "keyPackageRef" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlsKeyPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlsCommit" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "commitData" TEXT NOT NULL,
    "ratchetTree" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlsCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlsWelcome" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "welcomeData" TEXT NOT NULL,
    "ratchetTree" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlsWelcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedHistoryBackup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "kdfSalt" TEXT NOT NULL,
    "kdfAlgorithm" TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
    "kdfParams" TEXT NOT NULL,
    "cipherNonce" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "backupVersion" INTEGER NOT NULL DEFAULT 1,
    "sizeBytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncryptedHistoryBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_mlsGroupId_key" ON "Conversation"("mlsGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_signaturePublicKey_key" ON "UserDevice"("userId", "signaturePublicKey");

-- CreateIndex
CREATE INDEX "UserDevice_userId_revokedAt_idx" ON "UserDevice"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MlsKeyPackage_keyPackageRef_key" ON "MlsKeyPackage"("keyPackageRef");

-- CreateIndex
CREATE INDEX "MlsKeyPackage_userId_consumedAt_idx" ON "MlsKeyPackage"("userId", "consumedAt");

-- CreateIndex
CREATE INDEX "MlsKeyPackage_deviceId_consumedAt_idx" ON "MlsKeyPackage"("deviceId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MlsCommit_conversationId_epoch_key" ON "MlsCommit"("conversationId", "epoch");

-- CreateIndex
CREATE INDEX "MlsCommit_conversationId_epoch_idx" ON "MlsCommit"("conversationId", "epoch");

-- CreateIndex
CREATE INDEX "MlsWelcome_recipientDeviceId_deliveredAt_idx" ON "MlsWelcome"("recipientDeviceId", "deliveredAt");

-- CreateIndex
CREATE INDEX "MlsWelcome_conversationId_epoch_idx" ON "MlsWelcome"("conversationId", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedHistoryBackup_userId_key" ON "EncryptedHistoryBackup"("userId");

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlsKeyPackage" ADD CONSTRAINT "MlsKeyPackage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlsCommit" ADD CONSTRAINT "MlsCommit_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlsWelcome" ADD CONSTRAINT "MlsWelcome_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlsWelcome" ADD CONSTRAINT "MlsWelcome_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedHistoryBackup" ADD CONSTRAINT "EncryptedHistoryBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
