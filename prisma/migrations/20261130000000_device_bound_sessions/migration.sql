ALTER TABLE "RefreshSession" ADD COLUMN "sessionId" TEXT, ADD COLUMN "deviceId" TEXT;
UPDATE "RefreshSession" SET "sessionId" = "id";
ALTER TABLE "RefreshSession" ALTER COLUMN "sessionId" SET NOT NULL;
CREATE INDEX "RefreshSession_sessionId_idx" ON "RefreshSession"("sessionId");
CREATE INDEX "RefreshSession_deviceId_idx" ON "RefreshSession"("deviceId");
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
