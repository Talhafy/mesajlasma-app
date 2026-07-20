-- Track every uploaded R2 object with its owner, integrity metadata and lifecycle state.
CREATE TYPE "UploadedAssetStatus" AS ENUM ('READY', 'ATTACHED', 'REJECTED');

CREATE TABLE "UploadedAsset" (
  "id" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "status" "UploadedAssetStatus" NOT NULL DEFAULT 'READY',
  "expiresAt" TIMESTAMP(3),
  "attachedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadedAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadedAsset_fileKey_key" ON "UploadedAsset"("fileKey");
CREATE INDEX "UploadedAsset_ownerId_status_idx" ON "UploadedAsset"("ownerId", "status");
CREATE INDEX "UploadedAsset_status_expiresAt_idx" ON "UploadedAsset"("status", "expiresAt");

ALTER TABLE "UploadedAsset"
  ADD CONSTRAINT "UploadedAsset_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing objects so previously sent media and avatars remain accessible after ownership
-- enforcement starts. The owner is the message/scheduled-message sender, avatar owner, or group
-- administrator (falling back to the earliest group participant for legacy groups without one).
WITH sources AS (
  SELECT "fileKey", "senderId" AS "ownerId" FROM "Message" WHERE "fileKey" IS NOT NULL
  UNION ALL
  SELECT "fileKey", "senderId" AS "ownerId" FROM "ScheduledMessage" WHERE "fileKey" IS NOT NULL
  UNION ALL
  SELECT "avatarFileKey" AS "fileKey", "id" AS "ownerId" FROM "User" WHERE "avatarFileKey" IS NOT NULL
  UNION ALL
  SELECT c."avatarFileKey" AS "fileKey",
    COALESCE(c."adminId", (
      SELECT p."userId" FROM "Participant" p
      WHERE p."conversationId" = c."id"
      ORDER BY p."joinedAt" ASC
      LIMIT 1
    )) AS "ownerId"
  FROM "Conversation" c
  WHERE c."avatarFileKey" IS NOT NULL
), distinct_sources AS (
  SELECT DISTINCT ON ("fileKey") "fileKey", "ownerId"
  FROM sources
  WHERE "ownerId" IS NOT NULL
  ORDER BY "fileKey"
)
INSERT INTO "UploadedAsset" (
  "id", "fileKey", "ownerId", "mimeType", "sizeBytes", "checksum", "status", "attachedAt"
)
SELECT
  "fileKey", "fileKey", "ownerId", 'application/octet-stream', 0,
  'legacy:' || "fileKey", 'ATTACHED', CURRENT_TIMESTAMP
FROM distinct_sources
ON CONFLICT ("fileKey") DO NOTHING;
