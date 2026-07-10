-- Repair RefreshSession for databases that were created before the dual-token session refactor.
-- Some local/dev databases have a RefreshSession table without the `id` column even though
-- the current Prisma Client selects it. That mismatch causes:
--   P2022: The column `RefreshSession.id` does not exist in the current database.
--
-- Refresh sessions are disposable security state, not user content. We clear old rows before
-- changing the table shape so stale cookies cannot keep broken/partial sessions alive.

DELETE FROM "RefreshSession";

ALTER TABLE "RefreshSession"
ADD COLUMN IF NOT EXISTS "id" TEXT,
ADD COLUMN IF NOT EXISTS "userId" TEXT,
ADD COLUMN IF NOT EXISTS "tokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE
  existing_primary_key TEXT;
BEGIN
  SELECT conname
  INTO existing_primary_key
  FROM pg_constraint
  WHERE conrelid = '"RefreshSession"'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF existing_primary_key IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "RefreshSession" DROP CONSTRAINT %I', existing_primary_key);
  END IF;
END $$;

ALTER TABLE "RefreshSession"
ALTER COLUMN "id" SET NOT NULL,
ALTER COLUMN "userId" SET NOT NULL,
ALTER COLUMN "tokenHash" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "RefreshSession"
ADD CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "RefreshSession_userId_idx" ON "RefreshSession"("userId");
CREATE INDEX IF NOT EXISTS "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RefreshSession_userId_fkey'
  ) THEN
    ALTER TABLE "RefreshSession"
    ADD CONSTRAINT "RefreshSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
